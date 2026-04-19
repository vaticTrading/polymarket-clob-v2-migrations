// npm run 4:init
import "dotenv/config";
import { createWalletClient, http } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient } from "@polymarket/clob-client-v2";

const CLOB_HOST = process.env.CLOB_BASE_URL ?? "https://clob-v2.polymarket.com";
const EVENT_ID  = "73106";  // replace with your event

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });

// Step 1: derive API key (signatureType=0 = plain EOA, no Safe)
const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();

// Step 2: authenticated client
const client = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});
console.log("API key :", creds.key, "✓");

// Step 3: market info
const event  = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const condId = event.markets?.[0]?.conditionId as string;
const info   = await (client as any).getClobMarketInfo(condId);
const tokens = (info?.t ?? []) as { t: string; o: string }[];
const yesId  = tokens.find(t => t.o === "Yes")?.t ?? "";

console.log(`conditionId : ${condId}`);
console.log(`tick size   : ${info?.mts}`);
console.log(`neg risk    : ${info?.nr ?? false}`);
console.log(`YES token   : ${yesId.slice(0, 20)}…`);

// Step 4: order book
const book = await (client as any).getOrderBook(yesId);
const bids = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
const asks = [...(book?.asks ?? [])].sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));

console.log(`\nBook — ${bids.length} bids / ${asks.length} asks`);
asks.slice(0, 3).reverse().forEach((a: any) => console.log(`  ask $${parseFloat(a.price).toFixed(4)}  sz:${a.size}`));
bids.slice(0, 3).forEach((b: any)           => console.log(`  bid $${parseFloat(b.price).toFixed(4)}  sz:${b.size}`));
