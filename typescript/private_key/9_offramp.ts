// npm run 9:offramp  — unwrap all pUSD → USDC.e via CollateralOfframp (1:1)
// Prerequisite: pUSD allowance for COLLATERAL_OFFRAMP is set in 2_allowances.ts
// NOTE: CollateralOfframp is live from April 28, 2026 (CLOB V2 go-live).
import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

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

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const publicClient = createPublicClient({ chain: polygon, transport: http() });
const EOA          = account.address;

const [pusdBal, usdcBefore] = await Promise.all([
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
]);

console.log(`pUSD   : ${formatUnits(pusdBal, 6)}`);
console.log(`USDC.e : ${formatUnits(usdcBefore, 6)}`);

if (pusdBal === 0n) { console.log("⚠ No pUSD — nothing to unwrap"); process.exit(0); }

const unwrapHash = await walletClient.writeContract({
  address: COLLATERAL_OFFRAMP, abi: OFFRAMP_ABI, functionName: "unwrap",
  args: [USDC_E, EOA, pusdBal],
});
await publicClient.waitForTransactionReceipt({ hash: unwrapHash });

const [pusdAfter, usdcAfter] = await Promise.all([
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
]);
console.log(`pUSD after   : ${formatUnits(pusdAfter, 6)}`);
console.log(`USDC.e after : ${formatUnits(usdcAfter, 6)} (+${formatUnits(usdcAfter - usdcBefore, 6)}) ✓`);
console.log(`Unwrap tx    : ${unwrapHash}`);
