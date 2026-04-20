/**
 * 5_limit_order.ts — GTC limit BUY 2 ticks below best bid → confirm → cancel.
 *
 * EOA-based: signatureType=0, pUSD held by EOA (not Safe).
 *
 * Run:
 *   npm run 5:limit
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client-v2";

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CLOB_HOST   = process.env.CLOB_V2_BASE_URL ?? "https://clob-v2.polymarket.com";
const RPC_URL     = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";
const EVENT_ID    = "73106";
const PUSD        = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;

// ── Clients ───────────────────────────────────────────────────────────────────

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });
const EOA          = account.address;

console.log("EOA  :", EOA);
console.log("CLOB :", CLOB_HOST, "\n");

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Step 1: Init ClobClient V2 (EOA) ─────────────────────────────────────────

const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();
console.log("API key :", creds.key, "✓");

const client = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});
console.log("ClobClient V2 initialized ✓");

// ── Step 2: Market info ───────────────────────────────────────────────────────

const event   = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const condId  = event.markets?.[0]?.conditionId as string;
const info    = await (client as any).getClobMarketInfo(condId);
const tokens  = (info?.t ?? []) as { t: string; o: string }[];
const tokenId = tokens.find(t => t.o === "Yes")?.t ?? "";
const tickSize = (info?.mts?.toString() ?? "0.01") as "0.1" | "0.01" | "0.001" | "0.0001";
const negRisk = info?.nr ?? false;

console.log(`Market: tick=${tickSize}  negRisk=${negRisk}  token=${tokenId.slice(0, 16)}…`);

// ── Step 3: Book BEFORE ───────────────────────────────────────────────────────

const { bids } = await printBook("BEFORE order", tokenId);

if (bids.length < 3) { console.error("Not enough bid levels"); process.exit(1); }

const price = parseFloat((bids[2] as any).price);
console.log(`\nTarget price (bid-3): $${price}`);

// ── Step 4: pUSD balance ──────────────────────────────────────────────────────

const rawBal  = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA] });
const balance = parseFloat(formatUnits(rawBal, 6));
console.log(`pUSD balance: $${balance.toFixed(6)}`);

if (balance < 1) { console.error("⚠ Not enough pUSD — run 3_wrap.ts first."); process.exit(1); }

const BUFFER = 1;
const size   = Math.floor(((balance - BUFFER) / price) * 100) / 100;
console.log(`Order size : ${size} shares  ($${(balance - BUFFER).toFixed(2)} ÷ $${price})`);

// ── Step 5: Place GTC limit BUY ───────────────────────────────────────────────

console.log(`\nPlacing GTC BUY: ${size} shares @ $${price}...`);
const resp = await client.createAndPostOrder(
  { tokenID: tokenId, price, size, side: Side.BUY },
  { tickSize, negRisk },
  OrderType.GTC,
);
console.log(`  Order ID : ${resp.orderID}`);
console.log(`  Status   : ${resp.status}`);
if (!resp.orderID) { console.error("Order rejected:", (resp as any).errorMsg); process.exit(1); }

// ── Step 6: Book WHILE live ───────────────────────────────────────────────────

await printBook("WHILE order is live", tokenId, price);

// ── Step 7: Cancel ────────────────────────────────────────────────────────────

console.log(`\nCancelling ${resp.orderID!.slice(0, 18)}…`);
const cancel = await client.cancelOrder({ orderID: resp.orderID! });
console.log(cancel?.canceled?.includes(resp.orderID!) ? "✓ Cancelled" : `Cancel resp: ${JSON.stringify(cancel)}`);

// ── Step 8: Book AFTER cancel ─────────────────────────────────────────────────

await printBook("AFTER cancel", tokenId);
