# python 6_market_order.py  — FOK BUY at best ask → poll fill → FOK SELL back
import os, time, requests
from dotenv import load_dotenv
from web3 import Web3
from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import (
    OrderArgsV2, PartialCreateOrderOptions, OrderType,
    BalanceAllowanceParams, AssetType,
)

load_dotenv()

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
CLOB_HOST   = os.environ.get("CLOB_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL     = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID    = "73106"
PUSD        = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
ERC20_ABI   = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
                "inputs": [{"name": "account", "type": "address"}],
                "outputs": [{"name": "", "type": "uint256"}]}]
MIN_SIZE    = 5
BUY_SPEND   = 2.0

w3            = Web3(Web3.HTTPProvider(RPC_URL))
eoa           = w3.eth.account.from_key("0x" + PRIVATE_KEY).address
pusd_contract = w3.eth.contract(address=PUSD, abi=ERC20_ABI)

temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds       = temp_client.create_or_derive_api_key()
client      = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)
client.update_balance_allowance(BalanceAllowanceParams(asset_type=AssetType.COLLATERAL))

event    = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
cond_id  = event["markets"][0]["conditionId"]
info     = client.get_clob_market_info(cond_id)
token_id  = next((t["t"] for t in info.get("t", []) if t["o"] == "Yes"), "")
tick_size = str(info.get("mts", "0.01"))
neg_risk  = info.get("nr", False)

book     = client.get_order_book(token_id)
asks     = sorted(book["asks"], key=lambda a: float(a["price"]))
if not asks: print("No asks — can't FOK buy"); exit(1)

best_ask = float(asks[0]["price"])
balance  = pusd_contract.functions.balanceOf(eoa).call() / 1e6
buy_size = max(MIN_SIZE, round(BUY_SPEND / best_ask, 2))
print(f"Best ask: ${best_ask}  pUSD: ${balance:.4f}  size: {buy_size}")

options  = PartialCreateOrderOptions(tick_size=tick_size, neg_risk=neg_risk)
buy_resp = client.create_and_post_order(
    OrderArgsV2(token_id=token_id, price=best_ask, size=buy_size, side="BUY"),
    options, OrderType.FOK,
)
buy_id = buy_resp.get("orderID") if isinstance(buy_resp, dict) else buy_resp.orderID
print(f"Buy: {buy_id}")

# Poll until filled (FOK should fill instantly or fail)
for _ in range(30):
    time.sleep(1)
    ids = [o.get("id", o.get("orderID", "")) for o in (client.get_open_orders() or [])]
    if buy_id not in ids: print("✓ Filled"); break

bids_now = sorted(client.get_order_book(token_id)["bids"], key=lambda b: float(b["price"]), reverse=True)
if not bids_now: print("No bids — skipping sell"); exit(0)

sell_resp = client.create_and_post_order(
    OrderArgsV2(token_id=token_id, price=float(bids_now[0]["price"]), size=buy_size, side="SELL"),
    options, OrderType.FOK,
)
sell_id = sell_resp.get("orderID") if isinstance(sell_resp, dict) else sell_resp.orderID
print(f"Sell: {sell_id}  status: {sell_resp.get('status') if isinstance(sell_resp, dict) else sell_resp.status}")
