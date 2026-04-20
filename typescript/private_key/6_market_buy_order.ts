/**
 * 6_market_order.ts — Market BUY (FOK) on CLOB V2, poll for fill, market SELL back.
 *
 * EOA-based: signatureType=0, pUSD held by EOA (not Safe).
 *
 * Flow:
 *   1. Init ClobClient V2 (EOA)
 *   2. Fetch market info + YES token
 *   3. Book snapshot (best ask price)
 *   4. Check pUSD balance
 *   5. Place FOK market BUY (size = ~$1 worth at best ask, min 5 shares)
 *   6. Poll open orders until filled (or timeout)
 *   7. Check pUSD + trades to confirm fill
 *   8. Market SELL back (FOK)
 *
 * Run:
 *   npm run 6:market
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

const MIN_SIZE    = 5;   // CLOB V2 minimum shares per order
const BUY_SPEND   = 2;   // target USD to spend (before size floor)

// ── Clients ───────────────────────────────────────────────────────────────────

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });
const EOA          = account.address;

console.log("EOA  :", EOA);
console.log("CLOB :", CLOB_HOST, "\n");

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function printBook(label: string, tokenId: string) {
  const book = await (client as any).getOrderBook(tokenId);
  const bids = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
  const asks = [...(book?.asks ?? [])].sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));
  const mid  = bids[0] && asks[0] ? (parseFloat(bids[0].price) + parseFloat(asks[0].price)) / 2 : null;

  console.log(`\n──── ${label} ${"─".repeat(Math.max(0, 38 - label.length))}`);
  [...asks.slice(0, 3)].reverse().forEach((a: any, i, arr) => {
    console.log(`  ask ${arr.length - i}  $${parseFloat(a.price).toFixed(4)}  sz: ${a.size}`);
  });
  console.log(mid ? `  ── mid ──  $${mid.toFixed(4)}` : "  ── mid ──  (one side empty)");
  bids.slice(0, 3).forEach((b: any, i: number) => {
    console.log(`  bid ${i + 1}  $${parseFloat(b.price).toFixed(4)}  sz: ${b.size}`);
  });
  console.log(`${"─".repeat(44)}  asks: ${asks.length}  bids: ${bids.length}`);
  return { bids, asks };
}

async function getPusd(): Promise<number> {
  const raw = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA] });
  return parseFloat(formatUnits(raw, 6));
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

// ── Step 3: Book snapshot ─────────────────────────────────────────────────────

const { asks } = await printBook("BEFORE buy", tokenId);
if (asks.length === 0) { console.error("No asks — can't market buy"); process.exit(1); }

const bestAsk = parseFloat(asks[0].price);
console.log(`\nBest ask: $${bestAsk}`);

// ── Step 4: pUSD balance ──────────────────────────────────────────────────────

const balBefore = await getPusd();
console.log(`pUSD balance: $${balBefore.toFixed(6)}`);
if (balBefore < BUY_SPEND + 0.5) { console.error("⚠ Not enough pUSD — run 3_wrap.ts first."); process.exit(1); }

// Size: how many shares for BUY_SPEND USD at best ask, floor to MIN_SIZE
console.log(`Spending $${BUY_SPEND} @ $${bestAsk}`);

// ── Step 5: Market BUY (FOK) ──────────────────────────────────────────────────

console.log(`\nPlacing FOK market BUY: $${BUY_SPEND}…`);
const buyOrder: UserMarketOrderV2 = { tokenID: tokenId, price: bestAsk, amount: BUY_SPEND, side: Side.BUY };
const buyResp = await client.createAndPostMarketOrder(buyOrder, { tickSize, negRisk }, OrderType.FOK);
console.log(`  Order ID : ${buyResp.orderID}`);
console.log(`  Status   : ${buyResp.status}`);
if (!buyResp.orderID) { console.error("Buy rejected:", (buyResp as any).errorMsg); process.exit(1); }

// ── Step 6: Poll until filled ─────────────────────────────────────────────────

console.log("\nPolling for fill (up to 30 s)…");
let filled = false;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const open: any[] = await (client as any).getOpenOrders() ?? [];
  const still = open.find((o: any) => o.id === buyResp.orderID);
  if (!still) { filled = true; break; }
  process.stdout.write(".");
}
console.log(filled ? "\n✓ Order no longer in open orders (filled or expired)" : "\n⚠ Order still open after 30 s");

// ── Step 7: Confirm via pUSD delta ────────────────────────────────────────────

const balAfterBuy = await getPusd();
const spent       = balBefore - balAfterBuy;
console.log(`pUSD before buy : $${balBefore.toFixed(6)}`);
console.log(`pUSD after  buy : $${balAfterBuy.toFixed(6)}`);
console.log(`pUSD spent      : $${spent.toFixed(6)}`);

if (spent < 0.01) {
  console.log("⚠ No pUSD was spent — FOK may not have filled (thin book). Exiting.");
  process.exit(0);
}

// ── Step 8: Book snapshot after buy ──────────────────────────────────────────

await printBook("AFTER buy", tokenId);

// ── Step 9: Market SELL (FOK) back ───────────────────────────────────────────

// Estimate shares received: spent / avg_price (rough; use buySize as upper bound)
const sellShares = Math.max(MIN_SIZE, Math.floor((spent / bestAsk) * 100) / 100);

const bk   = await (client as any).getOrderBook(tokenId);
const bids  = [...(bk?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
if (bids.length === 0) { console.log("⚠ No bids to sell into — skipping sell."); process.exit(0); }
const bestBid = parseFloat(bids[0].price);

console.log(`\nPlacing FOK market SELL: ${sellShares} shares @ best bid $${bestBid}…`);
const sellOrder: UserMarketOrderV2 = { tokenID: tokenId, price: bestBid, amount: sellShares, side: Side.SELL };
const sellResp = await client.createAndPostMarketOrder(sellOrder, { tickSize, negRisk }, OrderType.FOK);
console.log(`  Order ID : ${sellResp.orderID}`);
console.log(`  Status   : ${sellResp.status}`);
if (!sellResp.orderID) { console.error("Sell rejected:", (sellResp as any).errorMsg); }

// Poll sell fill
console.log("\nPolling sell fill (up to 30 s)…");
let sellFilled = false;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const open: any[] = await (client as any).getOpenOrders() ?? [];
  if (!open.find((o: any) => o.id === sellResp.orderID)) { sellFilled = true; break; }
  process.stdout.write(".");
}
console.log(sellFilled ? "\n✓ Sell filled" : "\n⚠ Sell still open after 30 s");

// ── Step 10: Final balances ───────────────────────────────────────────────────

const balFinal = await getPusd();
console.log(`\npUSD start  : $${balBefore.toFixed(6)}`);
console.log(`pUSD final  : $${balFinal.toFixed(6)}`);
console.log(`Net PnL     : $${(balFinal - balBefore).toFixed(6)}`);

await printBook("FINAL book", tokenId);
console.log("\n✓ Done");
