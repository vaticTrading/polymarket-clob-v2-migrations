"""
10_merge.py — Merge EOA's YES + NO tokens → pUSD via CtfCollateralAdapter.

Run:
    python 10_merge.py

Requires: PRIVATE_KEY, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
Merges min(YES, NO) back to pUSD. Reverses 8_split.py.
"""

import os
import requests
from dotenv import load_dotenv
from web3 import Web3
from py_clob_client_v2.client import ClobClient

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
CLOB_HOST   = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL     = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID    = "73106"

PUSD           = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
CTF            = Web3.to_checksum_address("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")
CTF_ADAPTER    = Web3.to_checksum_address("0xADa100874d00e3331D00F2007a9c336a65009718")
NR_CTF_ADAPTER = Web3.to_checksum_address("0xAdA200001000ef00D07553cEE7006808F895c6F1")
BYTES32_ZERO   = b"\x00" * 32

ADAPTER_ABI = [
    {"name": "mergePositions", "type": "function", "stateMutability": "nonpayable",
     "inputs": [
         {"name": "collateralToken",    "type": "address"},
         {"name": "parentCollectionId", "type": "bytes32"},
         {"name": "conditionId",        "type": "bytes32"},
         {"name": "partition",          "type": "uint256[]"},
         {"name": "amount",             "type": "uint256"},
     ], "outputs": []},
]

CTF_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}, {"name": "id", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "isApprovedForAll", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}, {"name": "operator", "type": "address"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "setApprovalForAll", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "operator", "type": "address"}, {"name": "approved", "type": "bool"}],
     "outputs": []},
]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
EOA     = account.address
ctf     = w3.eth.contract(address=CTF, abi=CTF_ABI)

def send_tx(tx_data, gas=300_000):
    tx = tx_data.build_transaction({
        "from": EOA,
        "nonce": w3.eth.get_transaction_count(EOA),
        "gas": gas,
        "gasPrice": int(w3.eth.gas_price * 1.5),
        "chainId": 137,
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_hash)
    return tx_hash

# ── Market info → conditionId + token IDs ────────────────────────────────────
temp_client  = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds        = temp_client.create_or_derive_api_key()
client       = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)

event        = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
condition_id = event["markets"][0]["conditionId"]
info         = client.get_clob_market_info(condition_id)
neg_risk     = info.get("nr", False)
ADAPTER      = NR_CTF_ADAPTER if neg_risk else CTF_ADAPTER
adapter      = w3.eth.contract(address=ADAPTER, abi=ADAPTER_ABI)
tokens       = info.get("t", [])
yes_id       = int(next(t["t"] for t in tokens if t["o"] == "Yes"))
no_id        = int(next(t["t"] for t in tokens if t["o"] == "No"))

# ── Check balances ────────────────────────────────────────────────────────────
yes_raw = ctf.functions.balanceOf(EOA, yes_id).call()
no_raw  = ctf.functions.balanceOf(EOA, no_id).call()

print(f"YES balance : {yes_raw / 1e6:.6f}")
print(f"NO  balance : {no_raw  / 1e6:.6f}")

if yes_raw == 0 and no_raw == 0:
    print("No tokens to merge — run 8_split.py first"); exit(0)

merge_amount = min(yes_raw, no_raw)
print(f"\nMerging {merge_amount / 1e6:.6f} tokens → pUSD…")

# ── Ensure CTF → adapter approved (adapter pulls tokens during merge) ─────────
is_approved = ctf.functions.isApprovedForAll(EOA, ADAPTER).call()
if not is_approved:
    h = send_tx(ctf.functions.setApprovalForAll(ADAPTER, True))
    print(f"CTF approval set ✓  {h.hex()}")

# ── Merge ─────────────────────────────────────────────────────────────────────
cond_bytes = bytes.fromhex(condition_id.lstrip("0x"))
tx_hash = send_tx(
    adapter.functions.mergePositions(PUSD, BYTES32_ZERO, cond_bytes, [1, 2], merge_amount),
    gas=400_000,
)
print(f"\n✓ Merge tx: {tx_hash.hex()}")
print(f"Polygonscan: https://polygonscan.com/tx/{tx_hash.hex()}")
