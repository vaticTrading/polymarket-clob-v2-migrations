"""
11_offramp.py — Unwrap Safe's pUSD → USDC.e via CollateralOfframp (1:1).

Run:
    python 11_offramp.py

Requires: PRIVATE_KEY, SAFE_ADDRESS, POLYGON_RPC_URL in .env
The unwrap recipient is SAFE_ADDRESS — USDC.e is sent into the Safe, not the EOA.

NOTE: CollateralOfframp goes live on April 28, 2026 alongside CLOB V2.
Prerequisite: pUSD → CollateralOfframp approval is set in 2_allowances.py.
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

USDC_E             = Web3.to_checksum_address("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")
PUSD               = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
COLLATERAL_OFFRAMP = Web3.to_checksum_address("0x2957922Eb93258b93368531d39fAcCA3B4dC5854")

ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
]

# unwrap(address _asset, address _to, uint256 _amount)
# _asset = USDC_E (the output token), mirroring wrap(USDC_E, ...) on the onramp
OFFRAMP_ABI = [
    {"name": "unwrap", "type": "function", "stateMutability": "nonpayable",
     "inputs": [
         {"name": "_asset",  "type": "address"},
         {"name": "_to",     "type": "address"},
         {"name": "_amount", "type": "uint256"},
     ], "outputs": []},
]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
SAFE    = Web3.to_checksum_address(SAFE_ADDRESS)

pusd_contract    = w3.eth.contract(address=PUSD,               abi=ERC20_ABI)
usdc_contract    = w3.eth.contract(address=USDC_E,             abi=ERC20_ABI)
offramp_contract = w3.eth.contract(address=COLLATERAL_OFFRAMP, abi=OFFRAMP_ABI)

pusd_bal    = pusd_contract.functions.balanceOf(SAFE).call()
usdc_before = usdc_contract.functions.balanceOf(SAFE).call()

print(f"Safe   : {SAFE}\n")
print(f"pUSD   (Safe) : {pusd_bal    / 1e6:.6f}")
print(f"USDC.e (Safe) : {usdc_before / 1e6:.6f}")

if pusd_bal == 0:
    print("\n⚠ No pUSD in Safe — nothing to unwrap")
    exit(0)

print(f"\nUnwrapping {pusd_bal / 1e6:.6f} pUSD → USDC.e via Safe…")

# Unwrap — _asset = USDC_E, recipient = Safe
unwrap_data = offramp_contract.encode_abi("unwrap", args=[USDC_E, SAFE, pusd_bal])
unwrap_hash = safe_execute(w3, account, SAFE, COLLATERAL_OFFRAMP, bytes.fromhex(unwrap_data[2:]))
print(f"\n✓ Unwrap tx: {unwrap_hash}")

pusd_after = pusd_contract.functions.balanceOf(SAFE).call()
usdc_after = usdc_contract.functions.balanceOf(SAFE).call()
print(f"pUSD after   : {pusd_after / 1e6:.6f}")
print(f"USDC.e after : {usdc_after / 1e6:.6f} (+{(usdc_after - usdc_before) / 1e6:.6f}) ✓")
