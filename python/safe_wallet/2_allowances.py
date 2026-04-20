"""
2_allowances.py — Set all pUSD + CTF allowances from the Safe for V2 contracts.

Run:
    python 2_allowances.py

Requires: PRIVATE_KEY, SAFE_ADDRESS, POLYGON_RPC_URL in .env
Each approval is a separate Safe.execTransaction on-chain.
First run is 4–11 txs; subsequent runs are instant (all ✓).
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

MAX_UINT256  = 2**256 - 1

PUSD        = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
CTF         = Web3.to_checksum_address("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")
CTF_EX      = Web3.to_checksum_address("0xE111180000d2663C0091e4f400237545B87B996B")
NR_EX       = Web3.to_checksum_address("0xe2222d279d744050d28e00520010520000310F59")
NR_ADPT     = Web3.to_checksum_address("0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296")
CTF_ADPT    = Web3.to_checksum_address("0xADa100874d00e3331D00F2007a9c336a65009718")
NR_CTF_ADPT = Web3.to_checksum_address("0xAdA200001000ef00D07553cEE7006808F895c6F1")
OFFRAMP     = Web3.to_checksum_address("0x2957922Eb93258b93368531d39fAcCA3B4dC5854")

ERC20_ABI = [
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
]

ERC1155_ABI = [
    {"name": "isApprovedForAll", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}, {"name": "operator", "type": "address"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "setApprovalForAll", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "operator", "type": "address"}, {"name": "approved", "type": "bool"}],
     "outputs": []},
]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
SAFE    = Web3.to_checksum_address(SAFE_ADDRESS)

pusd_contract = w3.eth.contract(address=PUSD, abi=ERC20_ABI)
ctf_contract  = w3.eth.contract(address=CTF,  abi=ERC1155_ABI)

erc20_targets = [
    ("CTF",                        CTF),
    ("CTF Exchange V2",            CTF_EX),
    ("NR Exchange V2",             NR_EX),
    ("NR Adapter",                 NR_ADPT),
    ("CtfCollateralAdapter",       CTF_ADPT),
    ("NegRiskCtfCollateralAdapter",NR_CTF_ADPT),
    ("CollateralOfframp",          OFFRAMP),
]
erc1155_targets = [
    ("CTF Exchange V2",            CTF_EX),
    ("NR Exchange V2",             NR_EX),
    ("NR Adapter",                 NR_ADPT),
    ("CtfCollateralAdapter",       CTF_ADPT),
    ("NegRiskCtfCollateralAdapter",NR_CTF_ADPT),
]

# Print current status
print("Current allowances:")
for label, addr in erc20_targets:
    val = pusd_contract.functions.allowance(SAFE, addr).call()
    print(f"  pUSD → {label:<28}: {'✓' if val >= MAX_UINT256 else '✗'}")
for label, addr in erc1155_targets:
    ok = ctf_contract.functions.isApprovedForAll(SAFE, addr).call()
    print(f"  CTF  → {label:<28}: {'✓' if ok else '✗'}")

count = 0

# pUSD ERC-20 approvals via Safe
for label, addr in erc20_targets:
    val = pusd_contract.functions.allowance(SAFE, addr).call()
    if val < MAX_UINT256:
        data = pusd_contract.encode_abi("approve", args=[addr, MAX_UINT256])
        h    = safe_execute(w3, account, SAFE, PUSD, bytes.fromhex(data[2:]))
        print(f"  ✓ pUSD → {label}  {h}")
        count += 1

# CTF ERC-1155 setApprovalForAll via Safe
for label, addr in erc1155_targets:
    ok = ctf_contract.functions.isApprovedForAll(SAFE, addr).call()
    if not ok:
        data = ctf_contract.encode_abi("setApprovalForAll", args=[addr, True])
        h    = safe_execute(w3, account, SAFE, CTF, bytes.fromhex(data[2:]))
        print(f"  ✓ CTF  → {label}  {h}")
        count += 1

if count == 0:
    print("\nAll allowances already set ✓")
else:
    print(f"\n✓ {count} approval(s) confirmed")
