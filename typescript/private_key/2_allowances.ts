// npm run 2:allow
import "dotenv/config";
import { createWalletClient, createPublicClient, http, erc20Abi, maxUint256 } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PUSD        = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as `0x${string}`;
const CTF         = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as `0x${string}`;
const CTF_EX      = "0xE111180000d2663C0091e4f400237545B87B996B" as `0x${string}`;
const NR_EX       = "0xe2222d279d744050d28e00520010520000310F59" as `0x${string}`;
const NR_ADPT     = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as `0x${string}`;
const CTF_ADPT    = "0xADa100874d00e3331D00F2007a9c336a65009718" as `0x${string}`;
const NR_CTF_ADPT = "0xAdA200001000ef00D07553cEE7006808F895c6F1" as `0x${string}`;

const ERC1155_ABI = [{
  name: "isApprovedForAll", type: "function", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }],
  outputs: [{ name: "", type: "bool" }],
}, {
  name: "setApprovalForAll", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }],
  outputs: [],
}] as const;

const account      = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}` as `0x${string}`);
const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
const publicClient = createPublicClient({ chain: polygon, transport: http() });
const EOA          = account.address;

// pUSD ERC-20 approvals → 6 V2 contract targets
const erc20Targets: `0x${string}`[] = [CTF, CTF_EX, NR_EX, NR_ADPT, CTF_ADPT, NR_CTF_ADPT];
for (const addr of erc20Targets) {
  const val = await publicClient.readContract({
    address: PUSD, abi: erc20Abi, functionName: "allowance", args: [EOA, addr],
  });
  if (val < maxUint256 / 2n) {
    const hash = await walletClient.writeContract({
      address: PUSD, abi: erc20Abi, functionName: "approve", args: [addr, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`pUSD → ${addr}: ✓`);
  } else {
    console.log(`pUSD → ${addr}: already set ✓`);
  }
}

// CTF ERC-1155 setApprovalForAll → 5 targets
const erc1155Targets: `0x${string}`[] = [CTF_EX, NR_EX, NR_ADPT, CTF_ADPT, NR_CTF_ADPT];
for (const addr of erc1155Targets) {
  const ok = await publicClient.readContract({
    address: CTF, abi: ERC1155_ABI, functionName: "isApprovedForAll", args: [EOA, addr],
  });
  if (!ok) {
    const hash = await walletClient.writeContract({
      address: CTF, abi: ERC1155_ABI, functionName: "setApprovalForAll", args: [addr, true],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`CTF → ${addr}: ✓`);
  } else {
    console.log(`CTF → ${addr}: already set ✓`);
  }
}
console.log("\n✓ All allowances set");
