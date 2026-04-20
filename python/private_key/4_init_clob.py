"""
4_init_clob.py — Init ClobClient V2 (EOA, signatureType=0), derive API key,
                 fetch getClobMarketInfo + getOrderBook.

Run:
    python 4_init_clob.py

Requires: PRIVATE_KEY, CLOB_V2_BASE_URL, POLYGON_RPC_URL in .env
"""

import os
import requests
from dotenv import load_dotenv
from py_clob_client_v2.client import ClobClient

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
CLOB_HOST   = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")
EVENT_ID    = "73106"  # replace with your event
# EVENT_ID = "256854"

print(f"CLOB : {CLOB_HOST}\n")

# ── Step 1: Derive API key (signatureType=0 = plain EOA, no Safe) ─────────────
temp_client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds       = temp_client.create_or_derive_api_key()
print(f"API key : {creds.api_key} ✓")

# ── Step 2: Authenticated client ──────────────────────────────────────────────
client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)
print("ClobClient V2 initialized ✓\n")

# ── Step 3: getClobMarketInfo ─────────────────────────────────────────────────
event    = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
cond_id  = event["markets"][0]["conditionId"]
info     = client.get_clob_market_info(cond_id)
tokens   = info.get("t", [])
yes_id   = next((t["t"] for t in tokens if t["o"] == "Yes"), "")

print(f"Condition ID : {cond_id}")
print(f"Tick size    : {info.get('mts', '?')}")
print(f"Neg risk     : {info.get('nr', False)}")
print(f"YES token    : {yes_id[:20]}…")

# ── Step 4: getOrderBook ──────────────────────────────────────────────────────
book = client.get_order_book(yes_id)
bids = sorted(book["bids"], key=lambda b: float(b["price"]), reverse=True)
asks = sorted(book["asks"], key=lambda a: float(a["price"]))
mid  = (float(bids[0]["price"]) + float(asks[0]["price"])) / 2 if bids and asks else None

print(f"\nBook — {len(bids)} bids / {len(asks)} asks")
for a in reversed(asks[:3]):
    print(f"  ask  ${float(a['price']):.4f}  sz:{a['size']}")
if mid:
    print(f"  ── mid ──  ${mid:.4f}")
for b in bids[:3]:
    print(f"  bid  ${float(b['price']):.4f}  sz:{b['size']}")

print("\n✓ Done")
