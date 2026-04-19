# python 5_limit_order.py  — GTC BUY 2 ticks below best bid → cancel
import os
import requests
from dotenv import load_dotenv
from web3 import Web3
from py_clob_client_v2.client import ClobClient
from py_clob_client_v2.clob_types import (
    OrderArgsV2, PartialCreateOrderOptions, OrderType,
    BalanceAllowanceParams, AssetType, OrderPayload,
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

w3  = Web3(Web3.HTTPProvider(RPC_URL))
eoa = w3.eth.account.from_key("0x" + PRIVATE_KEY).address

temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds       = temp_client.create_or_derive_api_key()
client      = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)
print(f"EOA     : {eoa}")
print(f"API key : {creds.api_key} ✓")

# Sync on-chain balance/allowance to CLOB server cache
client.update_balance_allowance(BalanceAllowanceParams(asset_type=AssetType.COLLATERAL))

event     = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
cond_id   = event["markets"][0]["conditionId"]
info      = client.get_clob_market_info(cond_id)
token_id  = next((t["t"] for t in info.get("t", []) if t["o"] == "Yes"), "")
tick_size = str(info.get("mts", "0.01"))
neg_risk  = info.get("nr", False)

book  = client.get_order_book(token_id)
bids  = sorted(book["bids"], key=lambda b: float(b["price"]), reverse=True)
price = float(bids[2]["price"])  # 2 ticks below best bid

balance = w3.eth.contract(address=PUSD, abi=ERC20_ABI).functions.balanceOf(eoa).call() / 1e6
size    = max(round((balance - 1) / price, 2), 0)
print(f"Balance : ${balance:.4f} pUSD")
print(f"Placing GTC BUY: {size} shares @ ${price}")

resp     = client.create_and_post_order(
    OrderArgsV2(token_id=token_id, price=price, size=size, side="BUY"),
    PartialCreateOrderOptions(tick_size=tick_size, neg_risk=neg_risk),
    OrderType.GTC,
)
order_id = resp.get("orderID") if isinstance(resp, dict) else resp.orderID
print(f"✓ Order placed : {order_id}  status: {resp.get('status') if isinstance(resp, dict) else resp.status}")

cancel   = client.cancel_order(OrderPayload(orderID=order_id))
canceled = cancel.get("canceled", []) if isinstance(cancel, dict) else []
print(f"✓ Cancelled" if order_id in canceled else f"Cancel resp: {cancel}")
