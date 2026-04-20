"""
8_split.py — Split Safe's pUSD → YES + NO tokens via CtfCollateralAdapter.

Run:
    python 8_split.py

Requires: PRIVATE_KEY, SAFE_ADDRESS, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
All on-chain calls go through Safe.execTransaction. Run 10_merge.py to recover pUSD.
"""

import os
import sys
import requests
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
from web3 import Web3
from eth_abi import decode as abi_decode
from py_clob_client_v2.client import ClobClient
from _safe import safe_execute

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY  = os.environ["PRIVATE_KEY"]
SAFE_ADDRESS = os.environ["SAFE_ADDRESS"]
CLOB_HOST    = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL      = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID     = "73106"

PUSD           = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
CTF            = Web3.to_checksum_address("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")
CTF_ADAPTER    = Web3.to_checksum_address("0xADa100874d00e3331D00F2007a9c336a65009718")
NR_CTF_ADAPTER = Web3.to_checksum_address("0xAdA200001000ef00D07553cEE7006808F895c6F1")
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
SAFE    = Web3.to_checksum_address(SAFE_ADDRESS)

pusd_contract = w3.eth.contract(address=PUSD, abi=ERC20_ABI)

# ── Market info ───────────────────────────────────────────────────────────────
temp_client  = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=2, funder=SAFE_ADDRESS)
creds        = temp_client.create_or_derive_api_key()
client       = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=2, funder=SAFE_ADDRESS)

event        = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
condition_id = event["markets"][0]["conditionId"]
info         = client.get_clob_market_info(condition_id)
neg_risk     = info.get("nr", False)
ADAPTER      = NR_CTF_ADAPTER if neg_risk else CTF_ADAPTER
adapter      = w3.eth.contract(address=ADAPTER, abi=ADAPTER_ABI)

print(f"Safe         : {SAFE}")
print(f"Condition ID : {condition_id}")
print(f"Neg risk     : {neg_risk}  →  adapter: {ADAPTER}")

# ── Approve pUSD → adapter via Safe (if needed) ───────────────────────────────
allowance = pusd_contract.functions.allowance(SAFE, ADAPTER).call()
if allowance < MAX_UINT256 // 2:
    data = pusd_contract.encode_abi("approve", args=[ADAPTER, MAX_UINT256])
    h    = safe_execute(w3, account, SAFE, PUSD, bytes.fromhex(data[2:]))
    print(f"pUSD approval set ✓  {h}")

# ── Split all pUSD minus $1 buffer ────────────────────────────────────────────
raw_bal     = pusd_contract.functions.balanceOf(SAFE).call()
split_units = raw_bal - 1_000_000 if raw_bal > 1_000_000 else 0
if split_units == 0:
    print("⚠ Not enough pUSD in Safe"); exit(1)

cond_bytes = bytes.fromhex(condition_id.lstrip("0x"))
print(f"\nSplitting {split_units / 1e6:.6f} pUSD → YES + NO via Safe…")

split_data = adapter.encode_abi("splitPosition", args=[PUSD, BYTES32_ZERO, cond_bytes, [1, 2], split_units])
tx_hash = safe_execute(w3, account, SAFE, ADAPTER, bytes.fromhex(split_data[2:]))
print(f"\n✓ Split tx: {tx_hash}")

# ── Parse minted token IDs from TransferBatch log ─────────────────────────────
receipt = w3.eth.get_transaction_receipt(tx_hash)
for log in receipt["logs"]:
    if (log["address"].lower() == CTF.lower()
            and log["topics"][0].hex() == TRANSFER_BATCH):
        ids, _ = abi_decode(["uint256[]", "uint256[]"], bytes.fromhex(log["data"].hex()[2:]))
        print(f"YES (indexSet=1): {ids[0]}")
        print(f"NO  (indexSet=2): {ids[1]}")
