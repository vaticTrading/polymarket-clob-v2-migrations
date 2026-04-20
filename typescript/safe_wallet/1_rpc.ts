/**
 * 1_rpc.ts — Verify EOA + Safe + Polygon RPC connection for CLOB V2 (Safe wallet).
 *
 * Checks:
 *   - EOA address + MATIC balance (EOA pays gas for Safe txs)
 *   - Safe USDC.e balance (source for wrap step)
 *   - Safe pUSD balance   (V2 collateral — held by Safe, not EOA)
 *
 * Run:
 *   npm run 1:rpc
 */

import "dotenv/config";
import { createPublicClient, http, erc20Abi, formatUnits, formatEther } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY    = process.env.PRIVATE_KEY!;
const SAFE_ADDRESS   = process.env.SAFE_ADDRESS!   as `0x${string}`;
const RPC_URL        = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";
const CLOB_HOST      = process.env.CLOB_V2_BASE_URL ?? "https://clob-v2.polymarket.com";

const PUSD   = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });

console.log("EOA  :", account.address);
console.log("Safe :", SAFE_ADDRESS);
console.log("CLOB :", CLOB_HOST, "\n");

// ── EOA: MATIC (pays gas for Safe execTransaction) ────────────────────────────

const matic = await publicClient.getBalance({ address: account.address });
console.log(`MATIC (EOA)   : ${formatEther(matic)}  ${matic === 0n ? "⚠ no gas — EOA needs MATIC" : "✓"}`);

// ── Safe: USDC.e + pUSD ───────────────────────────────────────────────────────

const [usdce, pusd] = await Promise.all([
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [SAFE_ADDRESS] }),
]);

console.log(`USDC.e (Safe) : ${formatUnits(usdce, 6)}  ${usdce === 0n ? "(fund for 3_wrap)" : "✓"}`);
console.log(`pUSD   (Safe) : ${formatUnits(pusd, 6)}  ${pusd === 0n ? "(run 3_wrap first)" : "✓"}`);

// ── Chain check ───────────────────────────────────────────────────────────────

const chainId = await publicClient.getChainId();
console.log(`\nChain ID : ${chainId}  ${chainId === 137 ? "(Polygon ✓)" : "⚠ expected 137"}`);

console.log("\nRPC smoke test complete ✓");
