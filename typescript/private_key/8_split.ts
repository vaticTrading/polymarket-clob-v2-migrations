/**
 * 7_split.ts — Split pUSD → YES + NO tokens via CtfCollateralAdapter (EOA).
 *
 * $1 pUSD → 1 YES + 1 NO (fully collateralized, 1:1)
 *
 * Uses CtfCollateralAdapter (binary) or NegRiskCtfCollateralAdapter (neg-risk).
 * Calling CTF.splitPosition(pUSD) directly gives orphaned pUSD-based IDs with
 * no CLOB order book — this adapter produces the correct tradeable token IDs.
 *
 * EOA-based: calls adapter directly (no Safe, no relay). MATIC pays gas.
 *
 * Run:
 *   npm run 7:split
 */

import "dotenv/config";
import {
  createWalletClient, createPublicClient, http,
  erc20Abi, encodeFunctionData, formatUnits, decodeAbiParameters, maxUint256,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ClobClient } from "@polymarket/clob-client-v2";

// ── Addresses ─────────────────────────────────────────────────────────────────

const PUSD           = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const CTF            = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
const CTF_ADAPTER    = "0xADa100874d00e3331D00F2007a9c336a65009718" as `0x${string}`; // binary
const NR_CTF_ADAPTER = "0xAdA200001000ef00D07553cEE7006808F895c6F1" as `0x${string}`; // neg risk
const EVENT_ID       = "73106";

const TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb" as `0x${string}`;

// ── ABIs ──────────────────────────────────────────────────────────────────────

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

const CTF_BAL_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs:  [{ name: "account", type: "address" }, { name: "id", type: "uint256" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

// ── Env + Clients ─────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const CLOB_HOST   = process.env.CLOB_V2_BASE_URL ?? "https://clob-v2.polymarket.com";
const RPC_URL     = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });
const EOA          = account.address;

console.log("EOA  :", EOA);
console.log("CLOB :", CLOB_HOST, "\n");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPUSD(): Promise<number> {
  const raw = await publicClient.readContract({
    address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA],
  });
  return parseFloat(formatUnits(raw, 6));
}

async function getCTFBalance(id: bigint): Promise<bigint> {
  return publicClient.readContract({
    address: CTF, abi: CTF_BAL_ABI, functionName: "balanceOf", args: [EOA, id],
  });
}

async function getMintedIds(txHash: `0x${string}`): Promise<{ yes: bigint; no: bigint }> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CTF.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_BATCH_TOPIC) continue;
    const [ids] = decodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], log.data);
    return { yes: ids[0], no: ids[1] };
  }
  throw new Error("TransferBatch not found in receipt");
}

// ── Step 1: conditionId + negRisk from CLOB ───────────────────────────────────

const tempClient = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0 });
const creds      = await (tempClient as any).createOrDeriveApiKey();
const client     = new ClobClient({
  host: CLOB_HOST, chain: 137, signer: walletClient as never, signatureType: 0,
  creds: { key: creds.key, secret: creds.secret, passphrase: creds.passphrase },
});

const event = await fetch(`https://gamma-api.polymarket.com/events/${EVENT_ID}`).then(r => r.json()) as any;
const conditionId = event.markets?.[0]?.conditionId as string;

const marketInfo  = await (client as any).getClobMarketInfo(conditionId);
const negRisk     = marketInfo?.nr ?? false;
const ADAPTER     = negRisk ? NR_CTF_ADAPTER : CTF_ADAPTER;
const adapterName = negRisk ? "NegRiskCtfCollateralAdapter" : "CtfCollateralAdapter";

console.log(`conditionId : ${conditionId}`);
console.log(`negRisk     : ${negRisk}  →  ${adapterName}`);

// ── Step 2: Approve pUSD → adapter (if needed) ───────────────────────────────

const allowance = await publicClient.readContract({
  address: PUSD, abi: erc20Abi, functionName: "allowance", args: [EOA, ADAPTER],
});

if (allowance < maxUint256 / 2n) {
  console.log(`\nApproving pUSD → ${adapterName}...`);
  const hash = await walletClient.writeContract({
    address: PUSD, abi: erc20Abi, functionName: "approve", args: [ADAPTER, maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ ${hash}`);
} else {
  console.log(`pUSD → ${adapterName}: ✓ already approved`);
}

// ── Step 3: splitPosition via adapter ────────────────────────────────────────

const pUSD0      = await getPUSD();
const BUFFER     = 1;
const splitUSD   = Math.floor((pUSD0 - BUFFER) * 1e6) / 1e6;
const splitUnits = BigInt(Math.round(splitUSD * 1e6));

if (splitUSD <= 0) {
  console.error(`\nNot enough pUSD ($${pUSD0.toFixed(2)}, buffer $${BUFFER}). Run 3_wrap.ts first.`);
  process.exit(1);
}

console.log(`\npUSD BEFORE : $${pUSD0.toFixed(6)}`);
console.log(`Splitting $${splitUSD} → ${splitUSD} YES + ${splitUSD} NO…`);

const txHash = await walletClient.writeContract({
  address: ADAPTER,
  abi: ADAPTER_ABI,
  functionName: "splitPosition",
  args: [
    PUSD,
    ("0x" + "00".repeat(32)) as `0x${string}`,
    conditionId as `0x${string}`,
    [1n, 2n],
    splitUnits,
  ],
});
await publicClient.waitForTransactionReceipt({ hash: txHash });
console.log(`\n✓ Split tx: ${txHash}`);

// ── Step 4: Parse minted IDs from TransferBatch ───────────────────────────────

const { yes: yesId, no: noId } = await getMintedIds(txHash);

console.log(`\nMinted token IDs:`);
console.log(`  YES (indexSet=1): ${yesId}`);
console.log(`  NO  (indexSet=2): ${noId}`);

// ── Step 5: Balances AFTER ────────────────────────────────────────────────────

const pUSD1  = await getPUSD();
const yesRaw = await getCTFBalance(yesId);
const noRaw  = await getCTFBalance(noId);

console.log(`\nBalances AFTER:`);
console.log(`  pUSD : $${pUSD1.toFixed(6)}  (Δ ${(pUSD1 - pUSD0).toFixed(6)})`);
console.log(`  YES  : ${formatUnits(yesRaw, 6)} tokens`);
console.log(`  NO   : ${formatUnits(noRaw, 6)} tokens`);
console.log(`\nPolygonscan: https://polygonscan.com/tx/${txHash}`);
console.log(`\nNext: npm run 8:merge  (recover pUSD)  |  npm run 5:limit  (sell YES)`);
