/**
 * 2_allowances.ts — Set pUSD + CTF allowances on the EOA for V2 contracts.
 *
 * EOA-based: approvals are sent directly from the EOA (no Safe execTransaction).
 *
 * Required approvals:
 *   ERC-20  pUSD → approve MAX to: CTF, CTF Exchange V2, NR Exchange V2, NR Adapter,
 *                                   CtfCollateralAdapter, NegRiskCtfCollateralAdapter,
 *                                   CollateralOfframp (for unwrapping pUSD → USDC.e)
 *   ERC-1155 CTF → setApprovalForAll to: CTF Exchange V2, NR Exchange V2, NR Adapter,
 *                                         CtfCollateralAdapter, NegRiskCtfCollateralAdapter
 *
 * Run:
 *   npm run 2:allow
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, encodeFunctionData, maxUint256 } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const RPC_URL     = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";

// ── V2 Contract addresses ─────────────────────────────────────────────────────

const PUSD        = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const CTF         = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
const CTF_EX      = "0xE111180000d2663C0091e4f400237545B87B996B" as `0x${string}`;
const NR_EX       = "0xe2222d279d744050d28e00520010520000310F59" as `0x${string}`;
const NR_ADPT     = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as `0x${string}`;
const CTF_ADPT    = "0xADa100874d00e3331D00F2007a9c336a65009718" as `0x${string}`;
const NR_CTF_ADPT = "0xAdA200001000ef00D07553cEE7006808F895c6F1" as `0x${string}`;
const OFFRAMP     = "0x2957922Eb93258b93368531d39fAcCA3B4dC5854" as `0x${string}`;

const ERC1155_ABI = [
  { name: "isApprovedForAll",  type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }],
    outputs: [{ name: "", type: "bool" }] },
  { name: "setApprovalForAll", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
    outputs: [] },
] as const;

// ── Clients ───────────────────────────────────────────────────────────────────

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });
const EOA          = account.address;

console.log("EOA :", EOA, "\n");

// ── Step 1: Check current state ───────────────────────────────────────────────

const erc20Targets: [string, `0x${string}`][] = [
  ["CTF",                       CTF],
  ["CTF Exchange V2",           CTF_EX],
  ["NR Exchange V2",            NR_EX],
  ["NR Adapter",                NR_ADPT],
  ["CtfCollateralAdapter",      CTF_ADPT],
  ["NegRiskCtfCollateralAdapt", NR_CTF_ADPT],
  ["CollateralOfframp",         OFFRAMP],
];
const erc1155Targets: [string, `0x${string}`][] = [
  ["CTF Exchange V2",           CTF_EX],
  ["NR Exchange V2",            NR_EX],
  ["NR Adapter",                NR_ADPT],
  ["CtfCollateralAdapter",      CTF_ADPT],
  ["NegRiskCtfCollateralAdapt", NR_CTF_ADPT],
];

const [pusdVals, ctfVals] = await Promise.all([
  Promise.all(erc20Targets.map(([, addr]) =>
    publicClient.readContract({ address: PUSD, abi: erc20Abi, functionName: "allowance", args: [EOA, addr] })
  )),
  Promise.all(erc1155Targets.map(([, addr]) =>
    publicClient.readContract({ address: CTF, abi: ERC1155_ABI, functionName: "isApprovedForAll", args: [EOA, addr] })
  )),
]);

erc20Targets.forEach(([label], i)   => console.log(`  pUSD → ${label.padEnd(28)}: ${pusdVals[i]! >= maxUint256 ? "✓" : "✗"}`));
erc1155Targets.forEach(([label], i) => console.log(`  CTF  → ${label.padEnd(28)}: ${ctfVals[i] ? "✓" : "✗"}`));

// ── Step 2: Send missing approvals directly from EOA ─────────────────────────

const txHashes: string[] = [];

for (const [[, addr], val] of erc20Targets.map((t, i) => [t, pusdVals[i]] as const)) {
  if (val < maxUint256) {
    console.log(`\nApproving pUSD → ${addr}...`);
    const hash = await walletClient.writeContract({
      address: PUSD, abi: erc20Abi, functionName: "approve", args: [addr, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ✓ ${hash}`);
    txHashes.push(hash);
  }
}

for (const [[, addr], val] of erc1155Targets.map((t, i) => [t, ctfVals[i]] as const)) {
  if (!val) {
    console.log(`\nApproving CTF → ${addr}...`);
    const hash = await walletClient.writeContract({
      address: CTF, abi: ERC1155_ABI, functionName: "setApprovalForAll", args: [addr, true],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ✓ ${hash}`);
    txHashes.push(hash);
  }
}

if (txHashes.length === 0) {
  console.log("\nAll allowances already set ✓");
} else {
  console.log(`\n✓ ${txHashes.length} approval(s) confirmed`);
}
