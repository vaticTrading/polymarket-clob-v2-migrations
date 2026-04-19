// npm run 7:split  — pUSD → YES + NO via CtfCollateralAdapter
import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits, decodeAbiParameters, maxUint256 } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient } from "@polymarket/clob-client-v2";

const PUSD           = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const CTF            = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
const CTF_ADAPTER    = "0xADa100874d00e3331D00F2007a9c336a65009718" as `0x${string}`;  // binary
const NR_CTF_ADAPTER = "0xAdA200001000ef00D07553cEE7006808F895c6F1" as `0x${string}`;  // neg-risk
const TRANSFER_BATCH = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb" as `0x${string}`;
const CLOB_HOST      = process.env.CLOB_BASE_URL ?? "https://clob-v2.polymarket.com";
const EVENT_ID       = "73106";

const ADAPTER_ABI = [{
  name: "splitPosition", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "collateralToken",    type: "address"   },
    { name: "parentCollectionId", type: "bytes32"   },
    { name: "conditionId",        type: "bytes32"   },
    { name: "partition",          type: "uint256[]" },
    { name: "amount",             type: "uint256"   },
  ],
  outputs: [],
}] as const;

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const publicClient = createPublicClient({ chain: polygon, transport: http() });
const EOA          = account.address;

// Get market info
const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();
const client     = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0, creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase } });

const event       = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const conditionId = event.markets?.[0]?.conditionId as string;
const info        = await (client as any).getClobMarketInfo(conditionId);
const negRisk     = info?.nr ?? false;
const ADAPTER     = negRisk ? NR_CTF_ADAPTER : CTF_ADAPTER;

// Approve pUSD → adapter (if needed)
const allowance = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "allowance", args: [EOA, ADAPTER] });
if (allowance < maxUint256 / 2n) {
  const h = await walletClient.writeContract({ address: PUSD, abi: erc20Abi, functionName: "approve", args: [ADAPTER, maxUint256] });
  await publicClient.waitForTransactionReceipt({ hash: h });
}

// Split: pUSD → YES + NO (keep $1 buffer)
const rawBal     = await publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA] });
const splitUnits = rawBal - 1_000_000n;

const txHash = await walletClient.writeContract({
  address: ADAPTER, abi: ADAPTER_ABI, functionName: "splitPosition",
  args: [PUSD, ("0x" + "00".repeat(32)) as `0x${string}`, conditionId as `0x${string}`, [1n, 2n], splitUnits],
});
await publicClient.waitForTransactionReceipt({ hash: txHash });

// Parse minted IDs from TransferBatch log
const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
for (const log of receipt.logs) {
  if (log.address.toLowerCase() === CTF.toLowerCase() && log.topics[0] === TRANSFER_BATCH) {
    const [ids] = decodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], log.data);
    console.log(`YES token : ${ids[0]}`);
    console.log(`NO  token : ${ids[1]}`);
  }
}
console.log(`\n✓ Split tx: ${txHash}`);
