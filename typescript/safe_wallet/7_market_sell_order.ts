/**
 * 7_market_sell_order.ts — FOK market SELL of full YES token balance (Iran market).
 *
 * Reads the Safe's actual YES token balance from the CTF contract,
 * then places a FOK SELL for the full amount at best bid.
 *
 * Safe wallet: signatureType=2, funderAddress=SAFE.
 * Run 6_market_buy_order.ts first to have YES tokens in the Safe.
 *
 * Run:
 *   npm run 7:sell
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
const CTF          = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;

const CTF_BALANCE_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });

console.log("EOA  :", account.address);
console.log("Safe :", SAFE_ADDRESS);
console.log("CLOB :", CLOB_HOST, "\n");

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
const yesToken = tokens.find(t => t.o === "Yes")!;
const tokenId  = yesToken.t;
const tickSize = (info?.mts?.toString() ?? "0.01") as "0.1" | "0.01" | "0.001" | "0.0001";
const negRisk  = info?.nr ?? false;

console.log(`Market: tick=${tickSize}  negRisk=${negRisk}  token=${tokenId.slice(0, 16)}…`);

// ── Read YES token balance from Safe (ERC-1155) ───────────────────────────────

const rawYes   = await publicClient.readContract({
  address: CTF, abi: CTF_BALANCE_ABI, functionName: "balanceOf",
  args: [SAFE_ADDRESS, BigInt(tokenId)],
});
const yesShares = Number(rawYes) / 1e6;

const rawPusd   = await publicClient.readContract({
  address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS],
});
const pusdBefore = parseFloat(formatUnits(rawPusd, 6));

console.log(`YES balance (Safe) : ${yesShares.toFixed(6)} shares`);
console.log(`pUSD before  (Safe): $${pusdBefore.toFixed(6)}`);

if (yesShares < 0.01) {
  console.error("⚠ No YES tokens in Safe — run 6_market_buy_order.ts first.");
  process.exit(1);
}

// ── Book snapshot ─────────────────────────────────────────────────────────────

const book = await (client as any).getOrderBook(tokenId);
const bids  = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
if (bids.length === 0) { console.error("⚠ No bids — can't market sell."); process.exit(1); }
const bestBid = parseFloat(bids[0].price);
console.log(`Best bid : $${bestBid}  Selling: ${yesShares.toFixed(6)} shares`);

// ── FOK market SELL (full YES balance) ───────────────────────────────────────

console.log(`\nPlacing FOK SELL: ${yesShares.toFixed(6)} shares @ $${bestBid}…`);
const sellOrder: UserMarketOrderV2 = {
  tokenID: tokenId,
  price:   bestBid,
  amount:  yesShares,   // SELL: amount = shares
  side:    Side.SELL,
};
const sellResp = await client.createAndPostMarketOrder(sellOrder, { tickSize, negRisk }, OrderType.FOK);
console.log(`  Order ID : ${sellResp.orderID}  status: ${sellResp.status}`);
if (!sellResp.orderID) { console.error("Sell rejected:", (sellResp as any).errorMsg); process.exit(1); }

// ── Poll until filled ─────────────────────────────────────────────────────────

console.log("\nPolling for fill (up to 30 s)…");
let filled = false;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const open: any[] = await (client as any).getOpenOrders() ?? [];
  if (!open.find((o: any) => o.id === sellResp.orderID)) { filled = true; break; }
  process.stdout.write(".");
}
console.log(filled ? "\n✓ Filled" : "\n⚠ Still open after 30 s");

// ── Poll balances until settlement (optimistic: pusdBefore + yesShares * bestBid) ──

const expectedPusd = pusdBefore + yesShares * bestBid;
console.log(`\nExpected pUSD (optimistic): $${expectedPusd.toFixed(6)}`);
console.log("Polling for settlement (10 × 3 s)…");

let yesAfter  = yesShares;
let pusdAfter = pusdBefore;

for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const [rawYesAfter, rawPusdAfter] = await Promise.all([
    publicClient.readContract({ address: CTF, abi: CTF_BALANCE_ABI, functionName: "balanceOf", args: [SAFE_ADDRESS, BigInt(tokenId)] }),
    publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
  ]);
  yesAfter  = Number(rawYesAfter) / 1e6;
  pusdAfter = parseFloat(formatUnits(rawPusdAfter, 6));
  console.log(`  [${i + 1}/10] YES: ${yesAfter.toFixed(4)}  pUSD: $${pusdAfter.toFixed(4)}`);
  if (pusdAfter >= expectedPusd * 0.95) {   // within 5% of expected = settled
    console.log("✓ Settlement confirmed");
    break;
  }
}

console.log(`\nYES after   : ${yesAfter.toFixed(6)} shares`);
console.log(`pUSD before : $${pusdBefore.toFixed(6)}`);
console.log(`pUSD after  : $${pusdAfter.toFixed(6)}`);
console.log(`Net PnL     : $${(pusdAfter - pusdBefore).toFixed(6)}`);
