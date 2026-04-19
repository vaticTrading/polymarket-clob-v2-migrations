// npm run 8:merge  — YES + NO tokens → pUSD via CtfCollateralAdapter
import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient } from "@polymarket/clob-client-v2";

const PUSD           = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const CTF            = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
const CTF_ADAPTER    = "0xADa100874d00e3331D00F2007a9c336a65009718" as `0x${string}`;
const NR_CTF_ADAPTER = "0xAdA200001000ef00D07553cEE7006808F895c6F1" as `0x${string}`;
const CLOB_HOST      = process.env.CLOB_BASE_URL ?? "https://clob-v2.polymarket.com";
const EVENT_ID       = "73106";

const ADAPTER_ABI = [{
  name: "mergePositions", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "collateralToken",    type: "address"   },
    { name: "parentCollectionId", type: "bytes32"   },
    { name: "conditionId",        type: "bytes32"   },
    { name: "partition",          type: "uint256[]" },
    { name: "amount",             type: "uint256"   },
  ],
  outputs: [],
}] as const;
const CTF_BAL_ABI = [{ name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] }] as const;
const ERC1155_ABI = [
  { name: "isApprovedForAll", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { name: "setApprovalForAll", type: "function", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
] as const;

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const publicClient = createPublicClient({ chain: polygon, transport: http() });
const EOA          = account.address;

// Market info → conditionId + token IDs
const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();
const client     = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0, creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase } });

const event       = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const conditionId = event.markets?.[0]?.conditionId as string;
const info        = await (client as any).getClobMarketInfo(conditionId);
const negRisk     = info?.nr ?? false;
const ADAPTER     = negRisk ? NR_CTF_ADAPTER : CTF_ADAPTER;
const tokens      = (info?.t ?? []) as { t: string; o: string }[];
const yesId       = BigInt(tokens.find(x => x.o === "Yes")?.t ?? "0");
const noId        = BigInt(tokens.find(x => x.o === "No")?.t  ?? "0");

// Check balances
const yesRaw      = await publicClient.readContract({ address: CTF, abi: CTF_BAL_ABI, functionName: "balanceOf", args: [EOA, yesId] });
const noRaw       = await publicClient.readContract({ address: CTF, abi: CTF_BAL_ABI, functionName: "balanceOf", args: [EOA, noId]  });
const mergeAmount = yesRaw < noRaw ? yesRaw : noRaw;
if (mergeAmount === 0n) { console.log("No tokens to merge — run 7:split first"); process.exit(0); }
console.log(`Merging ${formatUnits(mergeAmount, 6)} tokens → pUSD…`);

// Ensure CTF → adapter approved
const isApproved = await publicClient.readContract({ address: CTF, abi: ERC1155_ABI, functionName: "isApprovedForAll", args: [EOA, ADAPTER] });
if (!isApproved) {
  const h = await walletClient.writeContract({ address: CTF, abi: ERC1155_ABI, functionName: "setApprovalForAll", args: [ADAPTER, true] });
  await publicClient.waitForTransactionReceipt({ hash: h });
}

// Merge
const txHash = await walletClient.writeContract({
  address: ADAPTER, abi: ADAPTER_ABI, functionName: "mergePositions",
  args: [PUSD, ("0x" + "00".repeat(32)) as `0x${string}`, conditionId as `0x${string}`, [1n, 2n], mergeAmount],
});
await publicClient.waitForTransactionReceipt({ hash: txHash });
console.log(`✓ Merge tx: ${txHash}`);
