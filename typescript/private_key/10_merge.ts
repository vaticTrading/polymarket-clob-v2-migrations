/**
 * 8_merge.ts — Merge YES + NO tokens back to pUSD via CtfCollateralAdapter (EOA).
 *
 * Reverses 7_split.ts. Reads YES/NO token IDs from getClobMarketInfo, checks
 * EOA balances, and merges the minimum of the two back to pUSD.
 *
 * EOA-based: calls adapter directly (no Safe, no relay). MATIC pays gas.
 *
 * Run:
 *   npm run 8:merge
 */

import "dotenv/config";
import {
  createWalletClient, createPublicClient, http,
  erc20Abi, formatUnits,
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

// ── ABIs ──────────────────────────────────────────────────────────────────────

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

const CTF_BAL_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs:  [{ name: "account", type: "address" }, { name: "id", type: "uint256" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

const ERC1155_ABI = [{
  name: "isApprovedForAll", type: "function", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }],
  outputs: [{ name: "", type: "bool" }],
}, {
  name: "setApprovalForAll", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
  outputs: [],
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

// ── Step 1: conditionId + token IDs from CLOB ────────────────────────────────

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
const tokens      = (marketInfo?.t ?? []) as { t: string; o: string }[];
const yesId       = BigInt(tokens.find(x => x.o === "Yes")?.t ?? "0");
const noId        = BigInt(tokens.find(x => x.o === "No")?.t  ?? "0");

console.log(`conditionId : ${conditionId}`);
console.log(`negRisk     : ${negRisk}  →  ${adapterName}`);
console.log(`YES ID      : ${yesId}`);
console.log(`NO  ID      : ${noId}`);

// ── Step 2: Balances BEFORE ───────────────────────────────────────────────────

const pUSD0   = await getPUSD();
const yesRaw0 = await getCTFBalance(yesId);
const noRaw0  = await getCTFBalance(noId);

console.log(`\nBalances BEFORE merge:`);
console.log(`  pUSD : $${pUSD0.toFixed(6)}`);
console.log(`  YES  : ${formatUnits(yesRaw0, 6)} tokens  (${yesRaw0} raw)`);
console.log(`  NO   : ${formatUnits(noRaw0, 6)} tokens  (${noRaw0} raw)`);

if (yesRaw0 === 0n && noRaw0 === 0n) {
  console.log("\nNo tokens to merge. Run 7_split.ts first.");
  process.exit(0);
}

const mergeAmount = yesRaw0 < noRaw0 ? yesRaw0 : noRaw0;
if (mergeAmount === 0n) {
  console.log("\nOne side is zero — cannot merge asymmetric positions.");
  process.exit(1);
}

// ── Step 3: Ensure CTF → adapter setApprovalForAll (needed for merge) ─────────

const isApproved = await publicClient.readContract({
  address: CTF, abi: ERC1155_ABI, functionName: "isApprovedForAll", args: [EOA, ADAPTER],
});

if (!isApproved) {
  console.log(`\nSetting CTF → ${adapterName} approval...`);
  const hash = await walletClient.writeContract({
    address: CTF, abi: ERC1155_ABI, functionName: "setApprovalForAll", args: [ADAPTER, true],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ ${hash}`);
} else {
  console.log(`CTF → ${adapterName}: ✓ already approved`);
}

// ── Step 4: mergePositions via adapter ───────────────────────────────────────

console.log(`\nMerging ${formatUnits(mergeAmount, 6)} tokens ($${formatUnits(mergeAmount, 6)}) → pUSD…`);

const txHash = await walletClient.writeContract({
  address: ADAPTER,
  abi: ADAPTER_ABI,
  functionName: "mergePositions",
  args: [
    PUSD,
    ("0x" + "00".repeat(32)) as `0x${string}`,
    conditionId as `0x${string}`,
    [1n, 2n],
    mergeAmount,
  ],
});
await publicClient.waitForTransactionReceipt({ hash: txHash });
console.log(`\n✓ Merge tx: ${txHash}`);

// ── Step 5: Balances AFTER ────────────────────────────────────────────────────

const pUSD1   = await getPUSD();
const yesRaw1 = await getCTFBalance(yesId);
const noRaw1  = await getCTFBalance(noId);

console.log(`\nBalances AFTER merge:`);
console.log(`  pUSD : $${pUSD1.toFixed(6)}  (Δ +${(pUSD1 - pUSD0).toFixed(6)})`);
console.log(`  YES  : ${formatUnits(yesRaw1, 6)} tokens`);
console.log(`  NO   : ${formatUnits(noRaw1, 6)} tokens`);
console.log(`\nPolygonscan: https://polygonscan.com/tx/${txHash}`);
