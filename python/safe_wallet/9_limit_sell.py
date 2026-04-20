"""
9_limit_sell.py — GTC limit SELL YES tokens 2 ticks above best ask → confirm → cancel.

Safe-based: YES tokens held by the Safe. Run 8_split.py first to obtain YES tokens.
signatureType=2.

Run:
    python 9_limit_sell.py

Requires: PRIVATE_KEY, SAFE_ADDRESS, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
"""

import os
import requests
from dotenv import load_dotenv
from web3 import Web3
from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import OrderArgsV2, PartialCreateOrderOptions, OrderType, OrderPayload, BalanceAllowanceParams, AssetType

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY  = os.environ["PRIVATE_KEY"]
SAFE_ADDRESS = os.environ["SAFE_ADDRESS"]
CLOB_HOST    = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL      = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID     = "73106"
CTF          = Web3.to_checksum_address("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")

CTF_ABI = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
            "inputs": [{"name": "account", "type": "address"}, {"name": "id", "type": "uint256"}],
            "outputs": [{"name": "", "type": "uint256"}]}]

w3   = Web3(Web3.HTTPProvider(RPC_URL))
SAFE = Web3.to_checksum_address(SAFE_ADDRESS)
ctf_contract = w3.eth.contract(address=CTF, abi=CTF_ABI)

# ── Init client ───────────────────────────────────────────────────────────────
temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=2, funder=SAFE_ADDRESS)
creds       = temp_client.create_or_derive_api_key()
client      = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=2, funder=SAFE_ADDRESS)
print(f"Safe    : {SAFE}")
print(f"API key : {creds.api_key} ✓\n")

# ── Market info ───────────────────────────────────────────────────────────────
event    = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
cond_id  = event["markets"][0]["conditionId"]
info     = client.get_clob_market_info(cond_id)
tokens   = info.get("t", [])
token_id = next((t["t"] for t in tokens if t["o"] == "Yes"), "")
tick_size = str(info.get("mts", "0.01"))
neg_risk  = info.get("nr", False)
tick      = float(tick_size)

print(f"Market: tick={tick_size}  negRisk={neg_risk}  token={token_id[:16]}…")

# ── Sync YES token balance to CLOB server (server tracks its own ledger) ─────
client.update_balance_allowance(BalanceAllowanceParams(asset_type=AssetType.CONDITIONAL, token_id=token_id))
print("Conditional balance synced ✓\n")

# ── YES token balance (held by Safe) ─────────────────────────────────────────
raw_yes    = ctf_contract.functions.balanceOf(SAFE, int(token_id)).call()
yes_shares = int(raw_yes / 1e6 * 100) / 100  # floor to 2 decimal places
print(f"YES balance : {yes_shares:.6f} shares (Safe)")
if yes_shares < 0.01:
    print("⚠ No YES tokens — run 8_split.py first."); exit(1)

# ── Order book — 2 ticks above best ask ──────────────────────────────────────
book = client.get_order_book(token_id)
asks = sorted(book["asks"], key=lambda a: float(a["price"]))

base_price = float(asks[0]["price"]) if asks else 0.96
price      = round(min(base_price + 2 * tick, 0.99), 4)
size       = round(yes_shares, 2)

print(f"\nTarget price (ask+2 ticks): ${price}  size: {size} shares")

# ── Place GTC limit SELL ──────────────────────────────────────────────────────
print(f"\nPlacing GTC SELL: {size} shares @ ${price}…")
resp = client.create_and_post_order(
    OrderArgsV2(token_id=token_id, price=price, size=size, side="SELL"),
    PartialCreateOrderOptions(tick_size=tick_size, neg_risk=neg_risk),
    OrderType.GTC,
)
order_id = resp.get("orderID") if isinstance(resp, dict) else resp.orderID
status   = resp.get("status")  if isinstance(resp, dict) else resp.status
print(f"  Order ID : {order_id}")
print(f"  Status   : {status}")
if not order_id:
    print(f"  Rejected : {resp.get('errorMsg') if isinstance(resp, dict) else resp}"); exit(1)

# ── Cancel ────────────────────────────────────────────────────────────────────
print(f"\nCancelling {order_id[:18] if order_id else ''}…")
cancel   = client.cancel_order(OrderPayload(orderID=order_id))
canceled = cancel.get("canceled", []) if isinstance(cancel, dict) else []
if order_id in canceled:
    print("✓ Cancelled")
else:
    print(f"Cancel response: {cancel}")
