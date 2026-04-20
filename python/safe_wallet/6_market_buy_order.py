"""
6_market_buy_order.py — FOK market BUY at best ask (Safe pUSD) → poll until filled.

Safe-based: pUSD collateral locked in the Safe. signatureType=2.
Run 7_market_sell_order.py next to sell the YES tokens back.

Run:
    python 6_market_buy_order.py

Requires: PRIVATE_KEY, SAFE_ADDRESS, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
"""

import os
import time
import requests
from dotenv import load_dotenv
from web3 import Web3
from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import MarketOrderArgsV2, PartialCreateOrderOptions, OrderType, BalanceAllowanceParams, AssetType

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY  = os.environ["PRIVATE_KEY"]
SAFE_ADDRESS = os.environ["SAFE_ADDRESS"]
CLOB_HOST    = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL      = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID     = "73106"
PUSD         = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
BUY_SPEND    = 2.0   # dollars

ERC20_ABI = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
              "inputs": [{"name": "account", "type": "address"}],
              "outputs": [{"name": "", "type": "uint256"}]}]

w3   = Web3(Web3.HTTPProvider(RPC_URL))
SAFE = Web3.to_checksum_address(SAFE_ADDRESS)
pusd_contract = w3.eth.contract(address=PUSD, abi=ERC20_ABI)

def get_safe_pusd() -> float:
    return pusd_contract.functions.balanceOf(SAFE).call() / 1e6

# ── Init client ───────────────────────────────────────────────────────────────
temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=2, funder=SAFE_ADDRESS)
creds       = temp_client.create_or_derive_api_key()
client      = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=2, funder=SAFE_ADDRESS)
print(f"Safe    : {SAFE}")
print(f"API key : {creds.api_key} ✓\n")

# ── Sync on-chain balances/allowances to CLOB server ─────────────────────────
client.update_balance_allowance(BalanceAllowanceParams(asset_type=AssetType.COLLATERAL))
print("Balance/allowance synced ✓\n")

# ── Market info ───────────────────────────────────────────────────────────────
event    = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
cond_id  = event["markets"][0]["conditionId"]
info     = client.get_clob_market_info(cond_id)
tokens   = info.get("t", [])
token_id = next((t["t"] for t in tokens if t["o"] == "Yes"), "")
tick_size = str(info.get("mts", "0.01"))
neg_risk  = info.get("nr", False)
options  = PartialCreateOrderOptions(tick_size=tick_size, neg_risk=neg_risk)

print(f"Market: tick={tick_size}  negRisk={neg_risk}  token={token_id[:16]}…")

# ── Order book — best ask ─────────────────────────────────────────────────────
book = client.get_order_book(token_id)
asks = sorted(book["asks"], key=lambda a: float(a["price"]))
if not asks:
    print("No asks — can't market buy"); exit(1)

best_ask   = float(asks[0]["price"])
bal_before = get_safe_pusd()

print(f"Best ask  : ${best_ask}  pUSD (Safe): ${bal_before:.4f}")
print(f"Buy spend : ${BUY_SPEND}\n")

if bal_before < BUY_SPEND + 0.5:
    print("⚠ Not enough pUSD in Safe."); exit(1)

# ── FOK market BUY (amount = dollars to spend) ───────────────────────────────
buy_resp = client.create_and_post_market_order(
    MarketOrderArgsV2(token_id=token_id, amount=BUY_SPEND, side="BUY", price=best_ask),
    options, OrderType.FOK,
)
buy_id = buy_resp.get("orderID") if isinstance(buy_resp, dict) else buy_resp.orderID
status = buy_resp.get("status")  if isinstance(buy_resp, dict) else buy_resp.status
print(f"Buy order : {buy_id}  status: {status}")
if not buy_id:
    print(f"Rejected  : {buy_resp.get('errorMsg') if isinstance(buy_resp, dict) else buy_resp}"); exit(1)

# ── Poll until filled (up to 30 s) ────────────────────────────────────────────
print("Polling for fill…")
for i in range(30):
    time.sleep(1)
    open_orders = client.get_open_orders() or []
    ids = [o.get("id", o.get("orderID", "")) for o in open_orders]
    if buy_id not in ids:
        print("✓ Filled")
        break
    print(".", end="", flush=True)
else:
    print("\n⚠ Still open after 30 s")
