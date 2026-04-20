/**
 * _safe.ts — Minimal Gnosis Safe execution helper (threshold=1, EOA signer).
 *
 * Executes a single call through the Safe without the builder relay.
 * The EOA signs the SafeTxHash directly (raw ECDSA, v=27/28).
 *
 * safeExecute  — single call
 * safeBatch    — multiple calls via MultiSend (delegatecall)
 */

import { type PublicClient, type WalletClient, type Address, type Hex, encodePacked, encodeFunctionData } from "viem";

// ── Safe ABI ──────────────────────────────────────────────────────────────────

export const SAFE_ABI = [
  { name: "nonce", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "getTransactionHash", type: "function", stateMutability: "view",
    inputs: [
      { name: "to",             type: "address" },
      { name: "value",          type: "uint256" },
      { name: "data",           type: "bytes"   },
      { name: "operation",      type: "uint8"   },
      { name: "safeTxGas",      type: "uint256" },
      { name: "baseGas",        type: "uint256" },
      { name: "gasPrice",       type: "uint256" },
      { name: "gasToken",       type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "_nonce",         type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }] },
  { name: "execTransaction", type: "function", stateMutability: "payable",
    inputs: [
      { name: "to",             type: "address" },
      { name: "value",          type: "uint256" },
      { name: "data",           type: "bytes"   },
      { name: "operation",      type: "uint8"   },
      { name: "safeTxGas",      type: "uint256" },
      { name: "baseGas",        type: "uint256" },
      { name: "gasPrice",       type: "uint256" },
      { name: "gasToken",       type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures",     type: "bytes"   },
    ],
    outputs: [{ name: "success", type: "bool" }] },
] as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
const MULTISEND = "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761" as Address;

const MULTISEND_ABI = [{
  name: "multiSend", type: "function", stateMutability: "payable",
  inputs: [{ name: "transactions", type: "bytes" }],
  outputs: [],
}] as const;

// ── safeExecute ───────────────────────────────────────────────────────────────

export async function safeExecute(
  publicClient: PublicClient,
  walletClient: WalletClient,
  safeAddress: Address,
  to: Address,
  data: Hex,
  value = 0n,
  operation = 0,   // 0 = Call, 1 = DelegateCall
): Promise<Hex> {
  const nonce = await publicClient.readContract({
    address: safeAddress, abi: SAFE_ABI, functionName: "nonce",
  });

  const safeTxHash = await publicClient.readContract({
    address: safeAddress, abi: SAFE_ABI, functionName: "getTransactionHash",
    args: [to, value, data, operation, 0n, 0n, 0n, ZERO_ADDR, ZERO_ADDR, nonce],
  }) as Hex;

  // Sign SafeTxHash directly — raw ECDSA (v=27/28), no EIP-191 prefix
  const sig = await (walletClient.account as any).sign({ hash: safeTxHash });

  const txHash = await (walletClient as any).writeContract({
    address: safeAddress, abi: SAFE_ABI, functionName: "execTransaction",
    args: [to, value, data, operation, 0n, 0n, 0n, ZERO_ADDR, ZERO_ADDR, sig],
  }) as Hex;

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

// ── safeBatch — pack multiple calls via MultiSend ─────────────────────────────

export type SafeCall = { to: Address; data: Hex; value?: bigint };

export async function safeBatch(
  publicClient: PublicClient,
  walletClient: WalletClient,
  safeAddress: Address,
  calls: SafeCall[],
): Promise<Hex> {
  // Pack each call: operation(1) + to(20) + value(32) + dataLength(32) + data
  let packed = "0x" as Hex;
  for (const call of calls) {
    const d = call.data;
    const dataLen = (d.length - 2) / 2;  // bytes, not hex chars
    packed = (packed +
      "00" +
      (call.to as string).slice(2).padStart(40, "0") +
      (call.value ?? 0n).toString(16).padStart(64, "0") +
      dataLen.toString(16).padStart(64, "0") +
      d.slice(2)
    ) as Hex;
  }

  const multiSendData = encodeFunctionData({
    abi: MULTISEND_ABI,
    functionName: "multiSend",
    args: [packed],
  });

  // MultiSend requires DelegateCall (operation=1)
  return safeExecute(publicClient, walletClient, safeAddress, MULTISEND, multiSendData, 0n, 1);
}
