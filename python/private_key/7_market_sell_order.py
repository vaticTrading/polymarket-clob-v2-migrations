"""
7_market_sell_order.py — FOK market SELL of full YES token balance.

EOA-based: reads YES token balance from CTF (ERC-1155), sells full amount at best bid.
Run 6_market_buy_order.py first to have YES tokens.

Run:
    python 7_market_sell_order.py

Requires: PRIVATE_KEY, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
"""

import os
import time
import requests
from dotenv import load_dotenv
from web3 import Web3
from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import MarketOrderArgsV2, PartialCreateOrderOptions, OrderType, BalanceAllowanceParams, AssetType

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
CLOB_HOST   = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL     = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID    = "73106"
PUSD        = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
CTF         = Web3.to_checksum_address("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")

ERC20_ABI = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
              "inputs": [{"name": "account", "type": "address"}],
              "outputs": [{"name": "", "type": "uint256"}]}]

CTF_ABI = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
            "inputs": [{"name": "account", "type": "address"}, {"name": "id", "type": "uint256"}],
            "outputs": [{"name": "", "type": "uint256"}]}]

w3  = Web3(Web3.HTTPProvider(RPC_URL))
eoa = w3.eth.account.from_key("0x" + PRIVATE_KEY).address
pusd_contract = w3.eth.contract(address=PUSD, abi=ERC20_ABI)
ctf_contract  = w3.eth.contract(address=CTF,  abi=CTF_ABI)

# ── Init client ───────────────────────────────────────────────────────────────
temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds       = temp_client.create_or_derive_api_key()
client      = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)
print(f"EOA     : {eoa}")
print(f"API key : {creds.api_key} ✓\n")

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

# ── Sync YES token balance/allowance to CLOB server ──────────────────────────
client.update_balance_allowance(BalanceAllowanceParams(asset_type=AssetType.CONDITIONAL, token_id=token_id))
print("Conditional balance synced ✓\n")

# ── YES token balance (ERC-1155) ──────────────────────────────────────────────
raw_yes    = ctf_contract.functions.balanceOf(eoa, int(token_id)).call()
yes_shares = int(raw_yes / 1e6 * 100) / 100  # floor to 2 decimal places
raw_pusd   = pusd_contract.functions.balanceOf(eoa).call()
pusd_before = raw_pusd / 1e6

print(f"YES balance  : {yes_shares:.6f} shares")
print(f"pUSD before  : ${pusd_before:.6f}")

if yes_shares < 0.01:
    print("⚠ No YES tokens — run 6_market_buy_order.py first."); exit(1)

# ── Order book — best bid ─────────────────────────────────────────────────────
book = client.get_order_book(token_id)
bids = sorted(book["bids"], key=lambda b: float(b["price"]), reverse=True)
if not bids:
    print("⚠ No bids — can't market sell."); exit(1)

best_bid = float(bids[0]["price"])
print(f"Best bid : ${best_bid}  Selling: {yes_shares:.6f} shares\n")

# ── FOK market SELL (amount = shares to sell) ────────────────────────────────
print(f"Placing FOK SELL: {yes_shares:.6f} shares @ ${best_bid}…")
sell_resp = client.create_and_post_market_order(
    MarketOrderArgsV2(token_id=token_id, amount=yes_shares, side="SELL", price=best_bid),
    options, OrderType.FOK,
)
sell_id = sell_resp.get("orderID") if isinstance(sell_resp, dict) else sell_resp.orderID
status  = sell_resp.get("status")  if isinstance(sell_resp, dict) else sell_resp.status
print(f"  Order ID : {sell_id}  status: {status}")
if not sell_id:
    print(f"  Rejected : {sell_resp.get('errorMsg') if isinstance(sell_resp, dict) else sell_resp}"); exit(1)

# ── Poll fill ─────────────────────────────────────────────────────────────────
print("\nPolling for fill (up to 30 s)…")
filled = False
for i in range(30):
    time.sleep(1)
    open_orders = client.get_open_orders() or []
    ids = [o.get("id", o.get("orderID", "")) for o in open_orders]
    if sell_id not in ids:
        filled = True
        break
    print(".", end="", flush=True)
print(f"\n{'✓ Filled' if filled else '⚠ Still open after 30 s'}")

# ── Poll balance until settlement (10 × 3 s) ─────────────────────────────────
expected_pusd = pusd_before + yes_shares * best_bid
print(f"\nExpected pUSD (optimistic): ${expected_pusd:.6f}")
print("Polling for settlement (10 × 3 s)…")

yes_after = yes_shares
pusd_after = pusd_before
for i in range(10):
    time.sleep(3)
    raw_yes_after  = ctf_contract.functions.balanceOf(eoa, int(token_id)).call()
    raw_pusd_after = pusd_contract.functions.balanceOf(eoa).call()
    yes_after  = raw_yes_after  / 1e6
    pusd_after = raw_pusd_after / 1e6
    print(f"  [{i + 1}/10] YES: {yes_after:.4f}  pUSD: ${pusd_after:.4f}")
    if pusd_after >= expected_pusd * 0.95:
        print("✓ Settlement confirmed")
        break

print(f"\nYES after   : {yes_after:.6f} shares")
print(f"pUSD before : ${pusd_before:.6f}")
print(f"pUSD after  : ${pusd_after:.6f}")
print(f"Net PnL     : ${pusd_after - pusd_before:.6f}")
