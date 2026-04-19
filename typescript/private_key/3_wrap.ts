// npm run 3:wrap
import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const USDC_E            = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as `0x${string}`;
const PUSD              = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const COLLATERAL_ONRAMP = "0x93070a847efEf7F70739046A929D47a521F5B8ee" as `0x${string}`;

// wrap(address _asset, address _to, uint256 _amount)
const ONRAMP_ABI = [{
  name: "wrap", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "_asset", type: "address" }, { name: "_to", type: "address" }, { name: "_amount", type: "uint256" }],
  outputs: [],
}] as const;

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const publicClient = createPublicClient({ chain: polygon, transport: http() });
const EOA          = account.address;

const [usdcBal, pusdBefore] = await Promise.all([
  publicClient.readContract({ address: USDC_E, abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
  publicClient.readContract({ address: PUSD,   abi: erc20Abi, functionName: "balanceOf", args: [EOA] }),
]);

console.log(`USDC.e : ${formatUnits(usdcBal, 6)}`);
console.log(`pUSD   : ${formatUnits(pusdBefore, 6)}`);

if (usdcBal === 0n) { console.log("⚠ No USDC.e — fund the EOA first"); process.exit(0); }

// Approve USDC.e → CollateralOnramp if needed
const approval = await publicClient.readContract({
  address: USDC_E, abi: erc20Abi, functionName: "allowance", args: [EOA, COLLATERAL_ONRAMP],
});
if (approval < usdcBal) {
  const hash = await walletClient.writeContract({
    address: USDC_E, abi: erc20Abi, functionName: "approve", args: [COLLATERAL_ONRAMP, usdcBal],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Approved USDC.e → CollateralOnramp: ${hash}`);
}

// Wrap USDC.e → pUSD (1:1, recipient = EOA)
const wrapHash = await walletClient.writeContract({
  address: COLLATERAL_ONRAMP, abi: ONRAMP_ABI, functionName: "wrap",
  args: [USDC_E, EOA, usdcBal],
});
await publicClient.waitForTransactionReceipt({ hash: wrapHash });

const pusdAfter = await publicClient.readContract({
  address: PUSD, abi: erc20Abi, functionName: "balanceOf", args: [EOA],
});
console.log(`pUSD after : ${formatUnits(pusdAfter, 6)} (+${formatUnits(pusdAfter - pusdBefore, 6)}) ✓`);
