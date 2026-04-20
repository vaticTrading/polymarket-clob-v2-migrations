/**
 * 7_market_sell_order.ts — FOK market SELL of full YES token balance (Iran market).
 *
 * EOA-based: reads YES token balance from CTF contract, sells full amount at best bid.
 * Run 6_market_buy_order.ts first to have YES tokens.
 *
 * Run:
 *   npm run 7:msell
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient, Side, OrderType, type UserMarketOrderV2 } from "@polymarket/clob-client-v2";

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CLOB_HOST   = process.env.CLOB_V2_BASE_URL ?? "https://clob-v2.polymarket.com";
const RPC_URL     = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";
const EVENT_ID    = "73106";
const PUSD        = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
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

// ── YES token balance (ERC-1155) ──────────────────────────────────────────────

const rawYes    = await publicClient.readContract({ address: CTF, abi: CTF_BALANCE_ABI, functionName: "balanceOf", args: [EOA, BigInt(tokenId)] });
const yesShares = Number(rawYes) / 1e6;
const rawPusd   = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA] });
const pusdBefore = parseFloat(formatUnits(rawPusd, 6));

console.log(`YES balance : ${yesShares.toFixed(6)} shares`);
console.log(`pUSD before : $${pusdBefore.toFixed(6)}`);

if (yesShares < 0.01) { console.error("⚠ No YES tokens — run 6_market_buy_order.ts first."); process.exit(1); }

// ── Book snapshot ─────────────────────────────────────────────────────────────

const book  = await (client as any).getOrderBook(tokenId);
const bids  = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
if (bids.length === 0) { console.error("⚠ No bids — can't market sell."); process.exit(1); }
const bestBid = parseFloat(bids[0].price);
console.log(`Best bid : $${bestBid}  Selling: ${yesShares.toFixed(6)} shares`);

// ── FOK market SELL (full YES balance) ───────────────────────────────────────

console.log(`\nPlacing FOK SELL: ${yesShares.toFixed(6)} shares @ $${bestBid}…`);
const sellOrder: UserMarketOrderV2 = { tokenID: tokenId, price: bestBid, amount: yesShares, side: Side.SELL };
const sellResp = await client.createAndPostMarketOrder(sellOrder, { tickSize, negRisk }, OrderType.FOK);
console.log(`  Order ID : ${sellResp.orderID}  status: ${sellResp.status}`);
if (!sellResp.orderID) { console.error("Sell rejected:", (sellResp as any).errorMsg); process.exit(1); }

// ── Poll fill ─────────────────────────────────────────────────────────────────

console.log("\nPolling for fill (up to 30 s)…");
let filled = false;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const open: any[] = await (client as any).getOpenOrders() ?? [];
  if (!open.find((o: any) => o.id === sellResp.orderID)) { filled = true; break; }
  process.stdout.write(".");
}
console.log(filled ? "\n✓ Filled" : "\n⚠ Still open after 30 s");

// ── Poll balance until settlement (10 × 3 s) ─────────────────────────────────

const expectedPusd = pusdBefore + yesShares * bestBid;
console.log(`\nExpected pUSD (optimistic): $${expectedPusd.toFixed(6)}`);
console.log("Polling for settlement (10 × 3 s)…");

let yesAfter = yesShares, pusdAfter = pusdBefore;
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const [rawYesAfter, rawPusdAfter] = await Promise.all([
    publicClient.readContract({ address: CTF, abi: CTF_BALANCE_ABI, functionName: "balanceOf", args: [EOA, BigInt(tokenId)] }),
    publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
  ]);
  yesAfter  = Number(rawYesAfter) / 1e6;
  pusdAfter = parseFloat(formatUnits(rawPusdAfter, 6));
  console.log(`  [${i + 1}/10] YES: ${yesAfter.toFixed(4)}  pUSD: $${pusdAfter.toFixed(4)}`);
  if (pusdAfter >= expectedPusd * 0.95) { console.log("✓ Settlement confirmed"); break; }
}

console.log(`\nYES after   : ${yesAfter.toFixed(6)} shares`);
console.log(`pUSD before : $${pusdBefore.toFixed(6)}`);
console.log(`pUSD after  : $${pusdAfter.toFixed(6)}`);
console.log(`Net PnL     : $${(pusdAfter - pusdBefore).toFixed(6)}`);
