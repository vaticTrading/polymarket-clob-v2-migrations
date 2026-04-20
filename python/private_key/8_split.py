"""
8_split.py — Split EOA's pUSD → YES + NO tokens via CtfCollateralAdapter.

Run:
    python 8_split.py

Requires: PRIVATE_KEY, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
Use the adapter — NOT CTF.splitPosition directly (produces different token IDs).
"""

import os
import requests
from dotenv import load_dotenv
from web3 import Web3
from eth_abi import decode as abi_decode
from py_clob_client_v2.client import ClobClient

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
CLOB_HOST   = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL     = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID    = "73106"

PUSD           = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
CTF            = Web3.to_checksum_address("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")
CTF_ADAPTER    = Web3.to_checksum_address("0xADa100874d00e3331D00F2007a9c336a65009718")  # binary
NR_CTF_ADAPTER = Web3.to_checksum_address("0xAdA200001000ef00D07553cEE7006808F895c6F1")  # neg-risk
TRANSFER_BATCH = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb"
MAX_UINT256    = 2**256 - 1
BYTES32_ZERO   = b"\x00" * 32

ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
]

ADAPTER_ABI = [
    {"name": "splitPosition", "type": "function", "stateMutability": "nonpayable",
     "inputs": [
         {"name": "collateralToken",    "type": "address"},
         {"name": "parentCollectionId", "type": "bytes32"},
         {"name": "conditionId",        "type": "bytes32"},
         {"name": "partition",          "type": "uint256[]"},
         {"name": "amount",             "type": "uint256"},
     ], "outputs": []},
]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
EOA     = account.address

pusd_contract = w3.eth.contract(address=PUSD, abi=ERC20_ABI)

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

# ── Market info ───────────────────────────────────────────────────────────────
temp_client  = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds        = temp_client.create_or_derive_api_key()
client       = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)

event        = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
condition_id = event["markets"][0]["conditionId"]
info         = client.get_clob_market_info(condition_id)
neg_risk     = info.get("nr", False)
ADAPTER      = NR_CTF_ADAPTER if neg_risk else CTF_ADAPTER
adapter      = w3.eth.contract(address=ADAPTER, abi=ADAPTER_ABI)

print(f"EOA          : {EOA}")
print(f"Condition ID : {condition_id}")
print(f"Neg risk     : {neg_risk}  →  adapter: {ADAPTER}")

# ── Approve pUSD → adapter (if needed) ───────────────────────────────────────
allowance = pusd_contract.functions.allowance(EOA, ADAPTER).call()
if allowance < MAX_UINT256 // 2:
    h = send_tx(pusd_contract.functions.approve(ADAPTER, MAX_UINT256))
    print(f"pUSD approval set ✓  {h.hex()}")

# ── Split: pUSD → YES + NO (keep $1 buffer) ───────────────────────────────────
raw_bal     = pusd_contract.functions.balanceOf(EOA).call()
split_units = raw_bal - 1_000_000  # leave $1 buffer
if split_units <= 0:
    print("⚠ Need > $1 pUSD to split"); exit(1)

cond_bytes = bytes.fromhex(condition_id.lstrip("0x"))
print(f"\nSplitting {split_units / 1e6:.6f} pUSD → YES + NO…")

tx_hash = send_tx(
    adapter.functions.splitPosition(PUSD, BYTES32_ZERO, cond_bytes, [1, 2], split_units),
    gas=400_000,
)

# ── Parse minted IDs from TransferBatch log ────────────────────────────────────
receipt = w3.eth.get_transaction_receipt(tx_hash)
for log in receipt["logs"]:
    if (log["address"].lower() == CTF.lower()
            and log["topics"][0].hex() == TRANSFER_BATCH):
        ids, _ = abi_decode(["uint256[]", "uint256[]"], bytes.fromhex(log["data"].hex()[2:]))
        print(f"YES token : {ids[0]}")
        print(f"NO  token : {ids[1]}")

print(f"\n✓ Split tx: {tx_hash.hex()}")
