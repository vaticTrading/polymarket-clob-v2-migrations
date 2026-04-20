/**
 * 9_offramp.ts — Unwrap Safe's pUSD → USDC.e via CollateralOfframp.
 *
 * All calls go through Safe.execTransaction (EOA signs, Safe executes).
 * The recipient of USDC.e is the Safe address.
 * Prerequisite: pUSD allowance for COLLATERAL_OFFRAMP is set in 2_allowances.ts
 * NOTE: CollateralOfframp is live from April 28, 2026 (CLOB V2 go-live).
 *
 * Run:
 *   npm run 9:offramp
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, encodeFunctionData, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { safeExecute } from "./_safe.js";

const PRIVATE_KEY  = process.env.PRIVATE_KEY!;
const SAFE_ADDRESS = process.env.SAFE_ADDRESS! as `0x${string}`;
const RPC_URL      = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";

const USDC_E             = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const PUSD               = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const COLLATERAL_OFFRAMP = "0x2957922Eb93258b93368531d39fAcCA3B4dC5854" as `0x${string}`;

// unwrap(address _asset, address _to, uint256 _amount)
// _asset = USDC_E (the output token), mirroring wrap(USDC_E, ...) on the onramp
const OFFRAMP_ABI = [{
  name: "unwrap", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "_asset", type: "address" }, { name: "_to", type: "address" }, { name: "_amount", type: "uint256" }],
  outputs: [],
}] as const;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });

console.log("EOA  :", account.address);
console.log("Safe :", SAFE_ADDRESS, "\n");

// ── Step 1: Check Safe balances ───────────────────────────────────────────────

const [pusdBal, usdcBefore] = await Promise.all([
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
]);

console.log(`pUSD   (Safe) : ${formatUnits(pusdBal, 6)}`);
console.log(`USDC.e (Safe) : ${formatUnits(usdcBefore, 6)}`);

if (pusdBal === 0n) {
  console.log("\n⚠ No pUSD in Safe — nothing to unwrap.");
  process.exit(0);
}

console.log(`\nUnwrapping ${formatUnits(pusdBal, 6)} pUSD → USDC.e…`);

// ── Step 2: Unwrap — _asset = USDC_E, recipient = Safe ────────────────────────

const unwrapData = encodeFunctionData({
  abi: OFFRAMP_ABI, functionName: "unwrap",
  args: [USDC_E, SAFE_ADDRESS, pusdBal],  // ← SAFE_ADDRESS as recipient
});
const unwrapHash = await safeExecute(publicClient, walletClient, SAFE_ADDRESS, COLLATERAL_OFFRAMP, unwrapData);
console.log(`tx hash : ${unwrapHash} ✓`);

// ── Step 3: Confirm balances ──────────────────────────────────────────────────

const [pusdAfter, usdcAfter] = await Promise.all([
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
]);

console.log(`\npUSD after   : ${formatUnits(pusdAfter, 6)}`);
console.log(`USDC.e after : ${formatUnits(usdcAfter, 6)} (+${formatUnits(usdcAfter - usdcBefore, 6)}) ✓`);
