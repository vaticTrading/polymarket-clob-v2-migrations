/**
 * 6_market_order.ts — Market BUY (FOK) → poll fill → market SELL back.
 *
 * Safe wallet: signatureType=2, funderAddress=SAFE. pUSD held by Safe.
 *
 * Run:
 *   npm run 6:market
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient, Side, OrderType, type UserMarketOrderV2 } from "@polymarket/clob-client-v2";

const PRIVATE_KEY  = process.env.PRIVATE_KEY!;
const SAFE_ADDRESS = process.env.SAFE_ADDRESS! as `0x${string}`;
const CLOB_HOST    = process.env.CLOB_V2_BASE_URL ?? "https://clob-v2.polymarket.com";
const RPC_URL      = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";
const EVENT_ID     = "73106";
const PUSD         = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const MIN_SIZE     = 5;
const BUY_SPEND    = 2;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });

console.log("EOA  :", account.address);
console.log("Safe :", SAFE_ADDRESS);
console.log("CLOB :", CLOB_HOST, "\n");

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getPusd(): Promise<number> {
  const raw = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] });
  return parseFloat(formatUnits(raw, 6));
}

// ── Init ClobClient V2 (Safe) ─────────────────────────────────────────────────

const tempClient = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never,
  signatureType: 2, funderAddress: SAFE_ADDRESS,
});
const creds = await (tempClient as any).createOrDeriveApiKey();
const client = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never,
  signatureType: 2, funderAddress: SAFE_ADDRESS,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});
console.log("API key :", creds.key, "✓");

// ── Market info ───────────────────────────────────────────────────────────────

const event    = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const condId   = event.markets?.[0]?.conditionId as string;
const info     = await (client as any).getClobMarketInfo(condId);
const tokens   = (info?.t ?? []) as { t: string; o: string }[];
const tokenId  = tokens.find(t => t.o === "Yes")?.t ?? "";
const tickSize = (info?.mts?.toString() ?? "0.01") as "0.1" | "0.01" | "0.001" | "0.0001";
const negRisk  = info?.nr ?? false;

// ── Book snapshot ─────────────────────────────────────────────────────────────

const book    = await (client as any).getOrderBook(tokenId);
const asks    = [...(book?.asks ?? [])].sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));
if (asks.length === 0) { console.error("No asks — can't market buy"); process.exit(1); }
const bestAsk = parseFloat(asks[0].price);

// ── pUSD balance (from Safe) ──────────────────────────────────────────────────

const balBefore = await getPusd();
console.log(`pUSD (Safe): $${balBefore.toFixed(6)}`);
if (balBefore < BUY_SPEND + 0.5) { console.error("⚠ Not enough pUSD in Safe."); process.exit(1); }

console.log(`Best ask: $${bestAsk}  Spending: $${BUY_SPEND}`);

// ── FOK market BUY ────────────────────────────────────────────────────────────

console.log(`\nPlacing FOK BUY: $${BUY_SPEND} @ $${bestAsk}…`);
const buyOrder: UserMarketOrderV2 = { tokenID: tokenId, price: bestAsk, amount: BUY_SPEND, side: Side.BUY };
const buyResp = await client.createAndPostMarketOrder(buyOrder, { tickSize, negRisk }, OrderType.FOK);
console.log(`  Order ID : ${buyResp.orderID}  status: ${buyResp.status}`);
if (!buyResp.orderID) { console.error("Buy rejected:", (buyResp as any).errorMsg); process.exit(1); }

// ── Poll until filled ─────────────────────────────────────────────────────────

console.log("\nPolling for fill (up to 30 s)…");
let filled = false;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const open: any[] = await (client as any).getOpenOrders() ?? [];
  if (!open.find((o: any) => o.id === buyResp.orderID)) { filled = true; break; }
  process.stdout.write(".");
}
console.log(filled ? "\n✓ Filled" : "\n⚠ Still open after 30 s");

const balAfterBuy = await getPusd();
const spent       = balBefore - balAfterBuy;
console.log(`pUSD spent: $${spent.toFixed(6)}`);
if (spent < 0.01) { console.log("⚠ FOK may not have filled (thin book). Exiting."); process.exit(0); }

// ── FOK market SELL back ──────────────────────────────────────────────────────

const bookNow  = await (client as any).getOrderBook(tokenId);
const bidsNow  = [...(bookNow?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
if (bidsNow.length === 0) { console.log("⚠ No bids — skipping sell."); process.exit(0); }
const bestBid  = parseFloat(bidsNow[0].price);
const sellSize = Math.max(MIN_SIZE, Math.floor((spent / bestAsk) * 100) / 100);

console.log(`\nPlacing FOK SELL: ${sellSize} shares @ $${bestBid}…`);
const sellOrder: UserMarketOrderV2 = { tokenID: tokenId, price: bestBid, amount: sellSize, side: Side.SELL };
const sellResp = await client.createAndPostMarketOrder(sellOrder, { tickSize, negRisk }, OrderType.FOK);
console.log(`  Order ID : ${sellResp.orderID}  status: ${sellResp.status}`);

// ── Final balances ────────────────────────────────────────────────────────────

let sellFilled = false;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  const open: any[] = await (client as any).getOpenOrders() ?? [];
  if (!open.find((o: any) => o.id === sellResp.orderID)) { sellFilled = true; break; }
  process.stdout.write(".");
}
console.log(sellFilled ? "\n✓ Sell filled" : "\n⚠ Sell still open");

const balFinal = await getPusd();
console.log(`\npUSD start  : $${balBefore.toFixed(6)}`);
console.log(`pUSD final  : $${balFinal.toFixed(6)}`);
console.log(`Net PnL     : $${(balFinal - balBefore).toFixed(6)}`);
