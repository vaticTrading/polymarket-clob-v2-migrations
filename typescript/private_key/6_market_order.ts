// npm run 6:market  — FOK BUY at best ask → poll fill → FOK SELL back
import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client-v2";

const CLOB_HOST = process.env.CLOB_BASE_URL ?? "https://clob-v2.polymarket.com";
const PUSD      = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const EVENT_ID  = "73106";
const MIN_SIZE  = 5;

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const publicClient = createPublicClient({ chain: polygon, transport: http() });

const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();
const client     = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});

const event    = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const condId   = event.markets?.[0]?.conditionId as string;
const info     = await (client as any).getClobMarketInfo(condId);
const tokens   = (info?.t ?? []) as { t: string; o: string }[];
const tokenId  = tokens.find(t => t.o === "Yes")?.t ?? "";
const tickSize = (info?.mts?.toString() ?? "0.01") as "0.1" | "0.01" | "0.001" | "0.0001";
const negRisk  = info?.nr ?? false;

// Best ask + pUSD balance
const book    = await (client as any).getOrderBook(tokenId);
const asks    = [...(book?.asks ?? [])].sort((a: any, b: any) => parseFloat(a.price) - parseFloat(b.price));
const bestAsk = parseFloat(asks[0].price);
const rawBal  = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
const buySize = Math.max(MIN_SIZE, Math.floor((2 / bestAsk) * 100) / 100);

// FOK market BUY
const buyResp = await client.createAndPostOrder(
  { tokenID: tokenId, price: bestAsk, size: buySize, side: Side.BUY },
  { tickSize, negRisk }, OrderType.FOK,
);
console.log(`Buy: ${buyResp.orderID}  status: ${buyResp.status}`);

// Poll until filled
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const open: any[] = await (client as any).getOpenOrders() ?? [];
  if (!open.find((o: any) => o.id === buyResp.orderID)) { console.log("✓ Filled"); break; }
}

// FOK market SELL back
const bids    = [...(book?.bids ?? [])].sort((a: any, b: any) => parseFloat(b.price) - parseFloat(a.price));
const bestBid = parseFloat(bids[0].price);
const sellResp = await client.createAndPostOrder(
  { tokenID: tokenId, price: bestBid, size: buySize, side: Side.SELL },
  { tickSize, negRisk }, OrderType.FOK,
);
console.log(`Sell: ${sellResp.orderID}  status: ${sellResp.status}`);
