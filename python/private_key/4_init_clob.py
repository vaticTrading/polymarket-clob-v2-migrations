# python 4_init_clob.py
import os
import requests
from dotenv import load_dotenv
from py_clob_client_v2.client import ClobClient

# pip install py-clob-client-v2 requests python-dotenv web3

load_dotenv()

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
CLOB_HOST   = os.environ.get("CLOB_BASE_URL", "https://clob-v2.polymarket.com")
EVENT_ID    = "73106"  # replace with your market event ID

print(f"CLOB : {CLOB_HOST}")

# Step 1: derive API key (signatureType=0, EOA)
temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds       = temp_client.create_or_derive_api_key()
print(f"API key : {creds.api_key} ✓")

# Step 2: authenticated client
client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)
print("ClobClient V2 (EOA) initialized ✓")

# Step 3: fetch market info
event   = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
cond_id = event["markets"][0]["conditionId"]
info    = client.get_clob_market_info(cond_id)
tokens  = info.get("t", [])
yes_id  = next((t["t"] for t in tokens if t["o"] == "Yes"), "")

print(f"Condition ID : {cond_id}")
print(f"Tick size    : {info.get('mts', '?')}")
print(f"Neg risk     : {info.get('nr', False)}")
print(f"YES token    : {yes_id}")

# Step 4: order book
book = client.get_order_book(yes_id)  # returns dict
bids = sorted(book["bids"], key=lambda b: float(b["price"]), reverse=True)
asks = sorted(book["asks"], key=lambda a: float(a["price"]))
mid  = (float(bids[0]["price"]) + float(asks[0]["price"])) / 2 if bids and asks else None

print(f"Order book — {len(bids)} bids / {len(asks)} asks  ✓")
for a in reversed(asks[:3]):
    print(f"  ask  ${float(a['price']):.4f}  sz:{a['size']}")
if mid:
    print(f"  ── mid ──  ${mid:.4f}")
for b in bids[:3]:
    print(f"  bid  ${float(b['price']):.4f}  sz:{b['size']}")
