"""
2_allowances.py — Set all pUSD (ERC-20) + CTF (ERC-1155) allowances for V2 contracts.

Run:
    python 2_allowances.py

Requires: PRIVATE_KEY, POLYGON_RPC_URL in .env
One-time per EOA. Skips already-approved targets.
"""

import os
from dotenv import load_dotenv
from web3 import Web3

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

PRIVATE_KEY = os.environ["PRIVATE_KEY"]
RPC_URL     = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")

MAX_UINT256 = 2**256 - 1

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
EOA     = account.address

pusd_contract = w3.eth.contract(address=PUSD, abi=ERC20_ABI)
ctf_contract  = w3.eth.contract(address=CTF,  abi=ERC1155_ABI)

def send_tx(tx_data):
    tx = tx_data.build_transaction({
        "from": EOA,
        "nonce": w3.eth.get_transaction_count(EOA),
        "gas": 100_000,
        "gasPrice": int(w3.eth.gas_price * 1.5),
        "chainId": 137,
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_hash)
    return tx_hash.hex()

# pUSD ERC-20 approvals → 7 V2 contract targets (6 CLOB + offramp for unwrapping)
erc20_targets = [CTF, CTF_EX, NR_EX, NR_ADPT, CTF_ADPT, NR_CTF_ADPT, OFFRAMP]
for addr in erc20_targets:
    val = pusd_contract.functions.allowance(EOA, addr).call()
    if val < MAX_UINT256 // 2:
        h = send_tx(pusd_contract.functions.approve(addr, MAX_UINT256))
        print(f"pUSD → {addr}: ✓  {h}")
    else:
        print(f"pUSD → {addr}: already set ✓")

# CTF ERC-1155 setApprovalForAll → 5 targets
erc1155_targets = [CTF_EX, NR_EX, NR_ADPT, CTF_ADPT, NR_CTF_ADPT]
for addr in erc1155_targets:
    ok = ctf_contract.functions.isApprovedForAll(EOA, addr).call()
    if not ok:
        h = send_tx(ctf_contract.functions.setApprovalForAll(addr, True))
        print(f"CTF  → {addr}: ✓  {h}")
    else:
        print(f"CTF  → {addr}: already set ✓")

print("\n✓ All allowances set")
