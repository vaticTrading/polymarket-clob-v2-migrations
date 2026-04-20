/**
 * 4_init_clob.ts — Init ClobClient V2 with EOA (signatureType=0), derive API
 *                  key, fetch getClobMarketInfo + getOrderBook.
 *
 * Run:
 *   npm run 4:init
 */

import "dotenv/config";
import { createWalletClient, http } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient } from "@polymarket/clob-client-v2";

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CLOB_HOST   = process.env.CLOB_V2_BASE_URL ?? "https://clob-v2.polymarket.com";
const RPC_URL     = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";
const EVENT_ID    = "73106";

// ── Clients ───────────────────────────────────────────────────────────────────

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });

console.log("EOA  :", account.address);
console.log("CLOB :", CLOB_HOST, "\n");

// ── Step 1: Derive API key (signatureType=0 — plain EOA) ─────────────────────

const tempClient = new ClobClient({
  host:          CLOB_HOST,
  chain:         137,
  signer:        walletClient as never,
  signatureType: 0,   // EOA — no Safe, no funderAddress
});

const creds = await (tempClient as any).createOrDeriveApiKey();
console.log("API key :", creds.key, "✓");

// ── Step 2: Authenticated client ──────────────────────────────────────────────

const client = new ClobClient({
  host:          CLOB_HOST,
  chain:         137,
  signer:        walletClient as never,
  signatureType: 0,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});

console.log("ClobClient V2 initialized ✓\n");

// ── Step 3: getClobMarketInfo ─────────────────────────────────────────────────

const event   = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const condId  = event.markets?.[0]?.conditionId as string;
const info    = await (client as any).getClobMarketInfo(condId);
const tokens  = (info?.t ?? []) as { t: string; o: string }[];
const yesId   = tokens.find(t => t.o === "Yes")?.t ?? "";

console.log(`Condition ID : ${condId}`);
console.log(`Tick size    : ${info?.mts ?? "?"}`);
console.log(`Neg risk     : ${info?.nr ?? false}`);
console.log(`YES token    : ${yesId}`);

// ── Step 4: getOrderBook ──────────────────────────────────────────────────────

const book = await (client as any).getOrderBook(yesId);
const bids = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
const asks = [...(book?.asks ?? [])].sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));
const mid  = bids[0] && asks[0] ? (parseFloat(bids[0].price) + parseFloat(asks[0].price)) / 2 : null;

console.log(`\nOrder book — ${bids.length} bids / ${asks.length} asks`);
asks.slice(0, 3).reverse().forEach((a: any) => console.log(`  ask  $${parseFloat(a.price).toFixed(4)}  sz: ${a.size}`));
if (mid) console.log(`  ── mid ──  $${mid.toFixed(4)}`);
bids.slice(0, 3).forEach((b: any) => console.log(`  bid  $${parseFloat(b.price).toFixed(4)}  sz: ${b.size}`));

console.log("\n✓ Done");
