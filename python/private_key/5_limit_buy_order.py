"""
5_limit_buy_order.py — GTC BUY 2 ticks below best bid → confirm in book → cancel.

Run:
    python 5_limit_buy_order.py

Requires: PRIVATE_KEY, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
pUSD held by EOA (not a Safe). Min order size = 5 shares.
"""

import os
import requests
from dotenv import load_dotenv
from web3 import Web3
from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import OrderArgsV2, PartialCreateOrderOptions, OrderType, BalanceAllowanceParams, AssetType, OrderPayload

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
CLOB_HOST   = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL     = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID    = "73106"
PUSD        = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")

ERC20_ABI = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
              "inputs": [{"name": "account", "type": "address"}],
              "outputs": [{"name": "", "type": "uint256"}]}]

w3  = Web3(Web3.HTTPProvider(RPC_URL))
eoa = w3.eth.account.from_key("0x" + PRIVATE_KEY).address

# ── Init client ───────────────────────────────────────────────────────────────
temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds       = temp_client.create_or_derive_api_key()
client      = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)
print(f"EOA     : {eoa}")
print(f"API key : {creds.api_key} ✓\n")

# ── Sync on-chain balances/allowances to CLOB server ─────────────────────────
client.update_balance_allowance(BalanceAllowanceParams(asset_type=AssetType.COLLATERAL))
print("Balance/allowance synced ✓\n")

# ── Market info ───────────────────────────────────────────────────────────────
event     = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
cond_id   = event["markets"][0]["conditionId"]
info      = client.get_clob_market_info(cond_id)
tokens    = info.get("t", [])
token_id  = next((t["t"] for t in tokens if t["o"] == "Yes"), "")
tick_size = str(info.get("mts", "0.01"))
neg_risk  = info.get("nr", False)
print(f"Market: tick={tick_size}  negRisk={neg_risk}  token={token_id[:16]}…")

# ── Order book — 2 ticks below best bid ───────────────────────────────────────
book = client.get_order_book(token_id)
bids = sorted(book["bids"], key=lambda b: float(b["price"]), reverse=True)
if len(bids) < 3:
    print("Not enough bid levels"); exit(1)

price = float(bids[2]["price"])

# ── pUSD balance ──────────────────────────────────────────────────────────────
raw_bal = w3.eth.contract(address=PUSD, abi=ERC20_ABI).functions.balanceOf(eoa).call()
balance = raw_bal / 1e6
size    = round((balance - 1) / price, 2)
size    = max(size, 0)

print(f"Balance : ${balance:.4f} pUSD")
print(f"Placing GTC BUY: {size} shares @ ${price}")

if size <= 0:
    print("⚠ Insufficient pUSD balance"); exit(1)

# ── Place GTC limit BUY ───────────────────────────────────────────────────────
resp = client.create_and_post_order(
    OrderArgsV2(token_id=token_id, price=price, size=size, side="BUY"),
    PartialCreateOrderOptions(tick_size=tick_size, neg_risk=neg_risk),
    OrderType.GTC,
)
order_id = resp.get("orderID") if isinstance(resp, dict) else resp.orderID
status   = resp.get("status")  if isinstance(resp, dict) else resp.status
print(f"\n✓ Order placed : {order_id}  status: {status}")

# ── Cancel (cleanup) ──────────────────────────────────────────────────────────
cancel = client.cancel_order(OrderPayload(orderID=order_id))
canceled = cancel.get("canceled", []) if isinstance(cancel, dict) else []
if order_id in canceled:
    print(f"✓ Cancelled    : {order_id}")
else:
    print(f"Cancel response: {cancel}")
