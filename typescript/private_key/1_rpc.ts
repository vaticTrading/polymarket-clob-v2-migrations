// npm run 1:rpc
import "dotenv/config";
import { createPublicClient, http, erc20Abi, formatUnits, formatEther } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const RPC_URL     = process.env.POLYGON_RPC_URL  ?? "https://polygon-bor-rpc.publicnode.com";
const CLOB_HOST   = process.env.CLOB_BASE_URL    ?? "https://clob-v2.polymarket.com";

const PUSD   = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;

const account      = privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`);
const publicClient = createPublicClient({ chain: polygon, transport: http(RPC_URL) });

console.log("EOA  :", account.address);
console.log("CLOB :", CLOB_HOST, "\n");

const [matic, pusd, usdc] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
]);

console.log(`MATIC  : ${formatEther(matic)}  ${matic === 0n ? "⚠ no gas" : "✓"}`);
console.log(`USDC.e : ${formatUnits(usdc, 6)}  ${usdc === 0n ? "(fund for wrap)" : "✓"}`);
console.log(`pUSD   : ${formatUnits(pusd, 6)}  ${pusd === 0n ? "(run wrap first)" : "✓"}`);

const chainId = await publicClient.getChainId();
console.log(`Chain ID : ${chainId}  ${chainId === 137 ? "(Polygon ✓)" : "⚠ expected 137"}`);
console.log("\n✓ RPC smoke test complete");
