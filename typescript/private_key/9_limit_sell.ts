/**
 * 9_limit_sell.ts — GTC limit SELL YES tokens (from split) 2 ticks above best ask → confirm → cancel.
 *
 * EOA-based: signatureType=0, YES tokens held by EOA.
 * Run 8_split.ts first to obtain YES tokens.
 *
 * Run:
 *   npm run 9:sell
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client-v2";

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CLOB_HOST   = process.env.CLOB_V2_BASE_URL ?? "https://clob-v2.polymarket.com";
const RPC_URL     = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";
const EVENT_ID    = "73106";
const CTF         = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;

const CTF_BALANCE_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });
const EOA          = account.address;

console.log("EOA  :", EOA);
console.log("CLOB :", CLOB_HOST, "\n");

async function printBook(label: string, tokenId: string, highlightPrice?: number) {
  const book = await (client as any).getOrderBook(tokenId);
  const bids = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
  const asks = [...(book?.asks ?? [])].sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));
  const mid  = bids[0] && asks[0] ? (parseFloat(bids[0].price) + parseFloat(asks[0].price)) / 2 : null;
  const mark = (p: string) => highlightPrice !== undefined && parseFloat(p) === highlightPrice ? " ◄ our order" : "";

  console.log(`\n──── ${label} ${"─".repeat(Math.max(0, 38 - label.length))}`);
  [...asks.slice(0, 5)].reverse().forEach((a: any, i, arr) => {
    console.log(`  ask ${arr.length - i}  $${parseFloat(a.price).toFixed(4)}  sz: ${a.size}${mark(a.price)}`);
  });
  console.log(mid ? `  ── mid ──  $${mid.toFixed(4)}` : "  ── mid ──  (one side empty)");
  bids.slice(0, 5).forEach((b: any, i: number) => {
    console.log(`  bid ${i + 1}  $${parseFloat(b.price).toFixed(4)}  sz: ${b.size}${mark(b.price)}`);
  });
  console.log(`${"─".repeat(44)}  asks: ${asks.length}  bids: ${bids.length}`);
  return { bids, asks };
}

// ── Init ClobClient V2 (EOA) ──────────────────────────────────────────────────

const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();
const client     = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});
console.log("API key :", creds.key, "✓");

// ── Market info ───────────────────────────────────────────────────────────────

const event    = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const condId   = event.markets?.[0]?.conditionId as string;
const info     = await (client as any).getClobMarketInfo(condId);
const tokens   = (info?.t ?? []) as { t: string; o: string }[];
const tokenId  = tokens.find(t => t.o === "Yes")!.t;
const tickSize = (info?.mts?.toString() ?? "0.01") as "0.1" | "0.01" | "0.001" | "0.0001";
const negRisk  = info?.nr ?? false;

console.log(`Market: tick=${tickSize}  negRisk=${negRisk}  token=${tokenId.slice(0, 16)}…`);

// ── YES token balance ─────────────────────────────────────────────────────────

const rawYes    = await publicClient.readContract({ address: CTF, abi: CTF_BALANCE_ABI, functionName: "balanceOf", args: [EOA, BigInt(tokenId)] });
const yesShares = Number(rawYes) / 1e6;
console.log(`YES balance : ${yesShares.toFixed(6)} shares`);
if (yesShares < 0.01) { console.error("⚠ No YES tokens — run 8_split.ts first."); process.exit(1); }

// ── Book BEFORE ───────────────────────────────────────────────────────────────

const { asks } = await printBook("BEFORE order", tokenId);
const tick      = parseFloat(tickSize);
const basePrice = asks.length > 0 ? parseFloat((asks[0] as any).price) : 0.96;
const price     = Math.min(parseFloat((basePrice + 2 * tick).toFixed(4)), 0.99);
const size      = Math.floor(yesShares * 100) / 100;

console.log(`\nTarget price (ask+2 ticks): $${price}  size: ${size} shares`);

// ── Place GTC limit SELL ──────────────────────────────────────────────────────

console.log(`\nPlacing GTC SELL: ${size} shares @ $${price}…`);
const resp = await client.createAndPostOrder(
  { tokenID: tokenId, price, size, side: Side.SELL },
  { tickSize, negRisk },
  OrderType.GTC,
);
console.log(`  Order ID : ${resp.orderID}`);
console.log(`  Status   : ${resp.status}`);
if (!resp.orderID) { console.error("Order rejected:", (resp as any).errorMsg); process.exit(1); }

await printBook("WHILE order is live", tokenId, price);

// ── Cancel ────────────────────────────────────────────────────────────────────

console.log(`\nCancelling ${resp.orderID!.slice(0, 18)}…`);
const cancel = await client.cancelOrder({ orderID: resp.orderID! });
console.log(cancel?.canceled?.includes(resp.orderID!) ? "✓ Cancelled" : `Cancel resp: ${JSON.stringify(cancel)}`);

await printBook("AFTER cancel", tokenId);
