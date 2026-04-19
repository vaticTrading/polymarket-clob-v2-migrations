# python 3_wrap.py  — wrap all USDC.e → pUSD (1:1)
import os
from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

PRIVATE_KEY       = os.environ["PRIVATE_KEY"]
RPC_URL           = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")
USDC_E            = Web3.to_checksum_address("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")
PUSD              = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
COLLATERAL_ONRAMP = Web3.to_checksum_address("0x93070a847efEf7F70739046A929D47a521F5B8ee")

ERC20_ABI  = [{"name": "balanceOf",  "type": "function", "stateMutability": "view",
               "inputs": [{"name": "account", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
              {"name": "allowance",  "type": "function", "stateMutability": "view",
               "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
               "outputs": [{"name": "", "type": "uint256"}]},
              {"name": "approve",    "type": "function", "stateMutability": "nonpayable",
               "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
               "outputs": [{"name": "", "type": "bool"}]}]
ONRAMP_ABI = [{"name": "wrap", "type": "function", "stateMutability": "nonpayable",
               "inputs": [{"name": "_asset", "type": "address"}, {"name": "_to", "type": "address"},
                          {"name": "_amount", "type": "uint256"}], "outputs": []}]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
EOA     = account.address
usdc_c  = w3.eth.contract(address=USDC_E,            abi=ERC20_ABI)
pusd_c  = w3.eth.contract(address=PUSD,              abi=ERC20_ABI)
onramp  = w3.eth.contract(address=COLLATERAL_ONRAMP, abi=ONRAMP_ABI)

def send_tx(tx_data, gas=200_000):
    tx = tx_data.build_transaction({"from": EOA,
        "nonce": w3.eth.get_transaction_count(EOA),
        "gas": gas, "gasPrice": int(w3.eth.gas_price * 1.5), "chainId": 137})
    s = account.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(s.raw_transaction)
    w3.eth.wait_for_transaction_receipt(h)
    return h.hex()

usdc_bal    = usdc_c.functions.balanceOf(EOA).call()
pusd_before = pusd_c.functions.balanceOf(EOA).call()
print(f"USDC.e : {usdc_bal    / 1e6:.6f}")
print(f"pUSD   : {pusd_before / 1e6:.6f}")

if usdc_bal == 0:
    print("⚠ No USDC.e — fund the EOA first"); exit(0)

if usdc_c.functions.allowance(EOA, COLLATERAL_ONRAMP).call() < usdc_bal:
    send_tx(usdc_c.functions.approve(COLLATERAL_ONRAMP, usdc_bal))
    print("Approved USDC.e → CollateralOnramp ✓")

wrap_hash  = send_tx(onramp.functions.wrap(USDC_E, EOA, usdc_bal))
pusd_after = pusd_c.functions.balanceOf(EOA).call()
print(f"pUSD after : {pusd_after / 1e6:.6f} (+{(pusd_after - pusd_before) / 1e6:.6f}) ✓")
print(f"Wrap tx    : {wrap_hash}")
