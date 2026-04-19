# python 7_split.py  — split pUSD → YES + NO via CtfCollateralAdapter
import os, requests
from dotenv import load_dotenv
from web3 import Web3
from eth_abi import decode as abi_decode
from py_clob_client_v2.client import ClobClient

load_dotenv()

PRIVATE_KEY    = os.environ["PRIVATE_KEY"]
CLOB_HOST      = os.environ.get("CLOB_BASE_URL", "https://clob-v2.polymarket.com")
RPC_URL        = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
EVENT_ID       = "73106"
PUSD           = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
CTF            = Web3.to_checksum_address("0x4D97DCd97eC945f40cF65F87097ACe5EA0476045")
CTF_ADAPTER    = Web3.to_checksum_address("0xADa100874d00e3331D00F2007a9c336a65009718")
NR_CTF_ADAPTER = Web3.to_checksum_address("0xAdA200001000ef00D07553cEE7006808F895c6F1")
TRANSFER_BATCH = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb"
MAX_UINT256    = 2**256 - 1
BYTES32_ZERO   = bytes(32)

ERC20_ABI   = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
                "inputs": [{"name": "account", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
               {"name": "allowance", "type": "function", "stateMutability": "view",
                "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
                "outputs": [{"name": "", "type": "uint256"}]},
               {"name": "approve", "type": "function", "stateMutability": "nonpayable",
                "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
                "outputs": [{"name": "", "type": "bool"}]}]
ADAPTER_ABI = [{"name": "splitPosition", "type": "function", "stateMutability": "nonpayable",
                "inputs": [{"name": "collateralToken", "type": "address"},
                           {"name": "parentCollectionId", "type": "bytes32"},
                           {"name": "conditionId", "type": "bytes32"},
                           {"name": "partition", "type": "uint256[]"},
                           {"name": "amount", "type": "uint256"}], "outputs": []}]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
EOA     = account.address
pusd_c  = w3.eth.contract(address=PUSD, abi=ERC20_ABI)

def send_tx(tx_data, gas=400_000):
    tx = tx_data.build_transaction({"from": EOA,
        "nonce": w3.eth.get_transaction_count(EOA),
        "gas": gas, "gasPrice": int(w3.eth.gas_price * 1.5), "chainId": 137})
    s = account.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(s.raw_transaction)
    w3.eth.wait_for_transaction_receipt(h)
    return h

temp = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, signature_type=0)
creds = temp.create_or_derive_api_key()
client = ClobClient(CLOB_HOST, chain_id=137, key=PRIVATE_KEY, creds=creds, signature_type=0)

event        = requests.get(f"https://gamma-api.polymarket.com/events/{EVENT_ID}").json()
condition_id = event["markets"][0]["conditionId"]
neg_risk     = client.get_clob_market_info(condition_id).get("nr", False)
ADAPTER      = NR_CTF_ADAPTER if neg_risk else CTF_ADAPTER
adapter      = w3.eth.contract(address=ADAPTER, abi=ADAPTER_ABI)

if pusd_c.functions.allowance(EOA, ADAPTER).call() < MAX_UINT256 // 2:
    send_tx(pusd_c.functions.approve(ADAPTER, MAX_UINT256))
    print("pUSD approval set ✓")

raw_bal     = pusd_c.functions.balanceOf(EOA).call()
split_units = raw_bal - 1_000_000  # leave $1 buffer
cond_bytes  = bytes.fromhex(condition_id.lstrip("0x"))
print(f"Splitting {split_units / 1e6:.6f} pUSD → YES + NO…")

tx_hash = send_tx(adapter.functions.splitPosition(PUSD, BYTES32_ZERO, cond_bytes, [1, 2], split_units))

receipt = w3.eth.get_transaction_receipt(tx_hash)
for log in receipt["logs"]:
    if log["address"].lower() == CTF.lower() and log["topics"][0].hex() == TRANSFER_BATCH:
        ids, _ = abi_decode(["uint256[]", "uint256[]"], bytes.fromhex(log["data"].hex()[2:]))
        print(f"YES token : {ids[0]}")
        print(f"NO  token : {ids[1]}")
print(f"✓ Split tx: {tx_hash.hex()}")
