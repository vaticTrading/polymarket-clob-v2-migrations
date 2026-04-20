"""
_safe.py — Minimal Gnosis Safe execution helper (threshold=1, EOA signer).

Import and use:
    from _safe import safe_execute

The PRIVATE_KEY in .env must correspond to an owner of SAFE_ADDRESS.
EOA must be a signer on the Safe (threshold=1 assumed).
"""

from web3 import Web3
from eth_account import Account

SAFE_ABI = [
    {"name": "nonce", "type": "function", "stateMutability": "view",
     "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "getTransactionHash", "type": "function", "stateMutability": "view",
     "inputs": [
         {"name": "to",             "type": "address"}, {"name": "value",          "type": "uint256"},
         {"name": "data",           "type": "bytes"},   {"name": "operation",      "type": "uint8"},
         {"name": "safeTxGas",      "type": "uint256"}, {"name": "baseGas",        "type": "uint256"},
         {"name": "gasPrice",       "type": "uint256"}, {"name": "gasToken",       "type": "address"},
         {"name": "refundReceiver", "type": "address"}, {"name": "_nonce",         "type": "uint256"},
     ], "outputs": [{"name": "", "type": "bytes32"}]},
    {"name": "execTransaction", "type": "function", "stateMutability": "payable",
     "inputs": [
         {"name": "to",             "type": "address"}, {"name": "value",          "type": "uint256"},
         {"name": "data",           "type": "bytes"},   {"name": "operation",      "type": "uint8"},
         {"name": "safeTxGas",      "type": "uint256"}, {"name": "baseGas",        "type": "uint256"},
         {"name": "gasPrice",       "type": "uint256"}, {"name": "gasToken",       "type": "address"},
         {"name": "refundReceiver", "type": "address"}, {"name": "signatures",     "type": "bytes"},
     ], "outputs": [{"name": "success", "type": "bool"}]},
]

ZERO_ADDR = "0x0000000000000000000000000000000000000000"


def safe_execute(
    w3: Web3,
    account,           # LocalAccount (from w3.eth.account.from_key)
    safe_address: str,
    to: str,
    data: bytes,
    value: int = 0,
    operation: int = 0,  # 0 = Call, 1 = DelegateCall
) -> str:
    """
    Execute a transaction from a Gnosis Safe (single-owner, threshold=1).

    Signs the safeTxHash with raw ECDSA (no Ethereum prefix) — same as
    viem's walletClient.account.sign({ hash }). Returns the on-chain tx hash.
    """
    safe      = w3.eth.contract(address=Web3.to_checksum_address(safe_address), abi=SAFE_ABI)
    nonce     = safe.functions.nonce().call()
    safe_addr = Web3.to_checksum_address(safe_address)
    to_addr   = Web3.to_checksum_address(to)

    safe_tx_hash = safe.functions.getTransactionHash(
        to_addr, value, data, operation,
        0, 0, 0, ZERO_ADDR, ZERO_ADDR, nonce,
    ).call()

    # Raw sign (no Ethereum prefix) — v is 27 or 28
    signed    = Account.unsafe_sign_hash(safe_tx_hash, private_key=account.key)
    signature = signed.signature

    tx = safe.functions.execTransaction(
        to_addr, value, data, operation,
        0, 0, 0, ZERO_ADDR, ZERO_ADDR, signature,
    ).build_transaction({
        "from":     account.address,
        "nonce":    w3.eth.get_transaction_count(account.address),
        "gas":      500_000,
        "gasPrice": int(w3.eth.gas_price * 1.5),
        "chainId":  137,
    })
    signed_tx = account.sign_transaction(tx)
    tx_hash   = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_hash)
    return tx_hash.hex()
