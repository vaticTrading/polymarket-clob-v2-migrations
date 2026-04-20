"""
3_wrap.py — Wrap Safe's USDC.e → pUSD via CollateralOnramp (1:1).

Run:
    python 3_wrap.py

Requires: PRIVATE_KEY, SAFE_ADDRESS, POLYGON_RPC_URL in .env
The wrap recipient is SAFE_ADDRESS — pUSD is minted into the Safe, not the EOA.
Send USDC.e to the Safe before running.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
from web3 import Web3
from _safe import safe_execute

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY  = os.environ["PRIVATE_KEY"]
SAFE_ADDRESS = os.environ["SAFE_ADDRESS"]
RPC_URL      = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")

USDC_E            = Web3.to_checksum_address("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")
PUSD              = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
COLLATERAL_ONRAMP = Web3.to_checksum_address("0x93070a847efEf7F70739046A929D47a521F5B8ee")

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

# wrap(address _asset, address _to, uint256 _amount)
ONRAMP_ABI = [
    {"name": "wrap", "type": "function", "stateMutability": "nonpayable",
     "inputs": [
         {"name": "_asset",  "type": "address"},
         {"name": "_to",     "type": "address"},
         {"name": "_amount", "type": "uint256"},
     ], "outputs": []},
]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
SAFE    = Web3.to_checksum_address(SAFE_ADDRESS)

usdc_contract   = w3.eth.contract(address=USDC_E,            abi=ERC20_ABI)
pusd_contract   = w3.eth.contract(address=PUSD,              abi=ERC20_ABI)
onramp_contract = w3.eth.contract(address=COLLATERAL_ONRAMP, abi=ONRAMP_ABI)

usdc_bal    = usdc_contract.functions.balanceOf(SAFE).call()
pusd_before = pusd_contract.functions.balanceOf(SAFE).call()

print(f"USDC.e (Safe) : {usdc_bal    / 1e6:.6f}")
print(f"pUSD   (Safe) : {pusd_before / 1e6:.6f}")

if usdc_bal == 0:
    print("\n⚠ No USDC.e in Safe — send USDC.e to Safe first.")
    exit(0)

# Step 1: Approve USDC.e → CollateralOnramp via Safe
current_approval = usdc_contract.functions.allowance(SAFE, COLLATERAL_ONRAMP).call()
if current_approval < usdc_bal:
    data = usdc_contract.encode_abi("approve", args=[COLLATERAL_ONRAMP, usdc_bal])
    h    = safe_execute(w3, account, SAFE, USDC_E, bytes.fromhex(data[2:]))
    print(f"  ✓ Approval: {h}")

# Step 2: Wrap — recipient = Safe (not EOA)
wrap_data = onramp_contract.encode_abi("wrap", args=[USDC_E, SAFE, usdc_bal])
wrap_hash = safe_execute(w3, account, SAFE, COLLATERAL_ONRAMP, bytes.fromhex(wrap_data[2:]))
print(f"\n✓ Wrap tx: {wrap_hash}")

pusd_after = pusd_contract.functions.balanceOf(SAFE).call()
print(f"pUSD before : {pusd_before / 1e6:.6f}")
print(f"pUSD after  : {pusd_after  / 1e6:.6f}")
print(f"Gained      : {(pusd_after - pusd_before) / 1e6:.6f} pUSD ✓")
