// npm run 5:limit  — GTC BUY 2 ticks below best bid → cancel
import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client-v2";

const CLOB_HOST = process.env.CLOB_BASE_URL ?? "https://clob-v2.polymarket.com";
const PUSD      = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const EVENT_ID  = "73106";

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const publicClient = createPublicClient({ chain: polygon, transport: http() });

// Init client
const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();
const client     = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});

// Market info
const event    = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const condId   = event.markets?.[0]?.conditionId as string;
const info     = await (client as any).getClobMarketInfo(condId);
const tokens   = (info?.t ?? []) as { t: string; o: string }[];
const tokenId  = tokens.find(t => t.o === "Yes")?.t ?? "";
const tickSize = (info?.mts?.toString() ?? "0.01") as "0.1" | "0.01" | "0.001" | "0.0001";
const negRisk  = info?.nr ?? false;

// Order book — pick 2 ticks below best bid
const book  = await (client as any).getOrderBook(tokenId);
const bids  = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
const price = parseFloat(bids[2].price);

// pUSD balance
const rawBal  = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
const balance = parseFloat(formatUnits(rawBal, 6));
const size    = Math.floor(((balance - 1) / price) * 100) / 100;

console.log(`Placing GTC BUY: ${size} shares @ $${price}`);

const resp = await client.createAndPostOrder(
  { tokenID: tokenId, price, size, side: Side.BUY },
  { tickSize, negRisk },
  OrderType.GTC,
);
console.log(`Order ID : ${resp.orderID}  status: ${resp.status}`);

// Cancel (cleanup)
const cancel = await client.cancelOrder({ orderID: resp.orderID! });
console.log(cancel?.canceled?.includes(resp.orderID!) ? "✓ Cancelled" : JSON.stringify(cancel));
