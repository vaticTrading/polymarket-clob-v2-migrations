/**
 * 3_wrap.ts — Wrap USDC.e → pUSD via CollateralOnramp (EOA-based).
 *
 * Steps:
 *   1. Check EOA USDC.e balance
 *   2. Approve USDC.e → CollateralOnramp (if needed)
 *   3. CollateralOnramp.wrap(USDC_E, EOA, amount) — mints pUSD 1:1
 *   4. Confirm pUSD balance increased
 *
 * Run:
 *   npm run 3:wrap
 */

import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const RPC_URL     = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";

const USDC_E            = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const PUSD              = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const COLLATERAL_ONRAMP = "0x93070a847efEf7F70739046A929D47a521F5B8ee" as `0x${string}`;

// wrap(address _asset, address _to, uint256 _amount) — selector 0x62355638
const ONRAMP_ABI = [{
  name: "wrap", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "_asset", type: "address" }, { name: "_to", type: "address" }, { name: "_amount", type: "uint256" }],
  outputs: [],
}] as const;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });
const EOA          = account.address;

console.log("EOA :", EOA, "\n");

// ── Step 1: Check balances ────────────────────────────────────────────────────

const [usdcBal, pusdBefore] = await Promise.all([
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
]);

console.log(`USDC.e balance : ${formatUnits(usdcBal, 6)} USDC.e`);
console.log(`pUSD balance   : ${formatUnits(pusdBefore, 6)} pUSD`);

if (usdcBal === 0n) {
  console.log("\n⚠ No USDC.e on EOA — send USDC.e to the EOA first.");
  process.exit(0);
}

const wrapAmount = usdcBal;
console.log(`\nWrapping ${formatUnits(wrapAmount, 6)} USDC.e → pUSD...`);

// ── Step 2: Approve USDC.e → CollateralOnramp (if needed) ────────────────────

const currentApproval = await publicClient.readContract({
  address: USDC_E, abi: erc20Abi, functionName: "allowance", args: [EOA, COLLATERAL_ONRAMP],
});

if (currentApproval < wrapAmount) {
  console.log("Approving USDC.e → CollateralOnramp...");
  const hash = await walletClient.writeContract({
    address: USDC_E, abi: erc20Abi, functionName: "approve", args: [COLLATERAL_ONRAMP, wrapAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ✓ ${hash}`);
} else {
  console.log("USDC.e approval already sufficient ✓");
}

// ── Step 3: Wrap ──────────────────────────────────────────────────────────────

console.log("Calling CollateralOnramp.wrap...");
const hash = await walletClient.writeContract({
  address: COLLATERAL_ONRAMP, abi: ONRAMP_ABI, functionName: "wrap",
  args: [USDC_E, EOA, wrapAmount],
});
await publicClient.waitForTransactionReceipt({ hash });
console.log(`tx hash : ${hash} ✓`);

// ── Step 4: Confirm pUSD balance ──────────────────────────────────────────────

const pusdAfter = await publicClient.readContract({
  address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA],
});

console.log(`\npUSD before : ${formatUnits(pusdBefore, 6)}`);
console.log(`pUSD after  : ${formatUnits(pusdAfter, 6)}`);
console.log(`Gained      : ${formatUnits(pusdAfter - pusdBefore, 6)} pUSD ✓`);
