# python 2_allowances.py  — one-time per EOA, skips already-set approvals
import os
from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

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

ERC20_ABI   = [{"name": "allowance", "type": "function", "stateMutability": "view",
                "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
                "outputs": [{"name": "", "type": "uint256"}]},
               {"name": "approve", "type": "function", "stateMutability": "nonpayable",
                "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
                "outputs": [{"name": "", "type": "bool"}]}]
ERC1155_ABI = [{"name": "isApprovedForAll", "type": "function", "stateMutability": "view",
                "inputs": [{"name": "account", "type": "address"}, {"name": "operator", "type": "address"}],
                "outputs": [{"name": "", "type": "bool"}]},
               {"name": "setApprovalForAll", "type": "function", "stateMutability": "nonpayable",
                "inputs": [{"name": "operator", "type": "address"}, {"name": "approved", "type": "bool"}],
                "outputs": []}]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
EOA     = account.address
pusd    = w3.eth.contract(address=PUSD, abi=ERC20_ABI)
ctf     = w3.eth.contract(address=CTF,  abi=ERC1155_ABI)

def send_tx(tx_data):
    tx = tx_data.build_transaction({"from": EOA,
        "nonce": w3.eth.get_transaction_count(EOA),
        "gas": 100_000, "gasPrice": int(w3.eth.gas_price * 1.5), "chainId": 137})
    signed = account.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(h)
    return h.hex()

# 7 pUSD ERC-20 approvals (6 CLOB + offramp for unwrapping pUSD → USDC.e)
for addr in [CTF, CTF_EX, NR_EX, NR_ADPT, CTF_ADPT, NR_CTF_ADPT, OFFRAMP]:
    if pusd.functions.allowance(EOA, addr).call() < MAX_UINT256 // 2:
        print(f"pUSD → {addr}: {send_tx(pusd.functions.approve(addr, MAX_UINT256))}")
    else:
        print(f"pUSD → {addr}: already set ✓")

# 5 CTF ERC-1155 setApprovalForAll
for addr in [CTF_EX, NR_EX, NR_ADPT, CTF_ADPT, NR_CTF_ADPT]:
    if not ctf.functions.isApprovedForAll(EOA, addr).call():
        print(f"CTF  → {addr}: {send_tx(ctf.functions.setApprovalForAll(addr, True))}")
    else:
        print(f"CTF  → {addr}: already set ✓")

print("\n✓ All allowances set")
