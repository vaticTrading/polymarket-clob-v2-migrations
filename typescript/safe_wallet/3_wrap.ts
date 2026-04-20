/**
 * 3_wrap.ts — Wrap Safe's USDC.e → pUSD via CollateralOnramp.
 *
 * All calls go through Safe.execTransaction (EOA signs, Safe executes).
 * The recipient of pUSD is the Safe address.
 *
 * Run:
 *   npm run 3:wrap
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, encodeFunctionData, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { safeExecute } from "./_safe.js";

const PRIVATE_KEY  = process.env.PRIVATE_KEY!;
const SAFE_ADDRESS = process.env.SAFE_ADDRESS! as `0x${string}`;
const RPC_URL      = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";

const USDC_E            = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const PUSD              = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const COLLATERAL_ONRAMP = "0x93070a847efEf7F70739046A929D47a521F5B8ee" as `0x${string}`;

// wrap(address _asset, address _to, uint256 _amount)
const ONRAMP_ABI = [{
  name: "wrap", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "_asset", type: "address" }, { name: "_to", type: "address" }, { name: "_amount", type: "uint256" }],
  outputs: [],
}] as const;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });

console.log("EOA  :", account.address);
console.log("Safe :", SAFE_ADDRESS, "\n");

// ── Step 1: Check Safe balances ───────────────────────────────────────────────

const [usdcBal, pusdBefore] = await Promise.all([
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
]);

console.log(`USDC.e (Safe) : ${formatUnits(usdcBal, 6)}`);
console.log(`pUSD   (Safe) : ${formatUnits(pusdBefore, 6)}`);

if (usdcBal === 0n) {
  console.log("\n⚠ No USDC.e in Safe — send USDC.e to the Safe address first.");
  process.exit(0);
}

const wrapAmount = usdcBal;
console.log(`\nWrapping ${formatUnits(wrapAmount, 6)} USDC.e → pUSD…`);

// ── Step 2: Approve USDC.e → CollateralOnramp (Safe → contract) ──────────────

const currentApproval = await publicClient.readContract({
  address: USDC_E, abi: erc20Abi, functionName: "allowance", args: [SAFE_ADDRESS, COLLATERAL_ONRAMP],
});

if (currentApproval < wrapAmount) {
  console.log("Approving USDC.e → CollateralOnramp via Safe…");
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [COLLATERAL_ONRAMP, wrapAmount] });
  const hash = await safeExecute(publicClient, walletClient, SAFE_ADDRESS, USDC_E, data);
  console.log(`  ✓ ${hash}`);
} else {
  console.log("USDC.e approval sufficient ✓");
}

// ── Step 3: Wrap — recipient = Safe (not EOA) ─────────────────────────────────

console.log("Calling CollateralOnramp.wrap via Safe…");
const wrapData = encodeFunctionData({
  abi: ONRAMP_ABI, functionName: "wrap",
  args: [USDC_E, SAFE_ADDRESS, wrapAmount],  // ← SAFE_ADDRESS as recipient
});
const wrapHash = await safeExecute(publicClient, walletClient, SAFE_ADDRESS, COLLATERAL_ONRAMP, wrapData);
console.log(`tx hash : ${wrapHash} ✓`);

// ── Step 4: Confirm pUSD balance in Safe ──────────────────────────────────────

const pusdAfter = await publicClient.readContract({
  address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS],
});

console.log(`\npUSD before : ${formatUnits(pusdBefore, 6)}`);
console.log(`pUSD after  : ${formatUnits(pusdAfter, 6)}`);
console.log(`Gained      : ${formatUnits(pusdAfter - pusdBefore, 6)} pUSD ✓`);
