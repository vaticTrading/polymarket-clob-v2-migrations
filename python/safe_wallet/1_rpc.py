"""
1_rpc.py — RPC smoke test: EOA gas (MATIC) + Safe pUSD/USDC.e balances.

Run:
    python 1_rpc.py

Requires: PRIVATE_KEY, SAFE_ADDRESS, POLYGON_RPC_URL in .env
EOA pays gas for Safe.execTransaction — needs MATIC. Safe holds pUSD collateral.
"""

import os
from dotenv import load_dotenv
from web3 import Web3

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY  = os.environ["PRIVATE_KEY"]
SAFE_ADDRESS = os.environ["SAFE_ADDRESS"]
RPC_URL      = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
CLOB_HOST    = os.environ.get("CLOB_V2_BASE_URL", "https://clob-v2.polymarket.com")

PUSD   = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
USDC_E = Web3.to_checksum_address("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")

ERC20_ABI = [
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
EOA     = account.address
SAFE    = Web3.to_checksum_address(SAFE_ADDRESS)

pusd_contract = w3.eth.contract(address=PUSD,   abi=ERC20_ABI)
usdc_contract = w3.eth.contract(address=USDC_E, abi=ERC20_ABI)

print(f"EOA  : {EOA}")
print(f"Safe : {SAFE}")
print(f"CLOB : {CLOB_HOST}\n")

matic = w3.eth.get_balance(EOA)
print(f"MATIC (EOA)   : {matic / 1e18:.6f}  {'⚠ no gas' if matic == 0 else '✓'}")

usdce = usdc_contract.functions.balanceOf(SAFE).call()
pusd  = pusd_contract.functions.balanceOf(SAFE).call()
print(f"USDC.e (Safe) : {usdce / 1e6:.6f}  {'(fund for 3_wrap.py)' if usdce == 0 else '✓'}")
print(f"pUSD   (Safe) : {pusd  / 1e6:.6f}  {'(run 3_wrap.py first)' if pusd == 0 else '✓'}")

chain_id = w3.eth.chain_id
print(f"\nChain ID : {chain_id}  {'(Polygon ✓)' if chain_id == 137 else '⚠ expected 137'}")
print("\nRPC smoke test complete ✓")
