# python 9_offramp.py  — unwrap all pUSD → USDC.e via CollateralOfframp (1:1)
# Prerequisite: pUSD allowance for COLLATERAL_OFFRAMP is set in 2_allowances.py
# NOTE: CollateralOfframp is live from April 28, 2026 (CLOB V2 go-live).

import os
from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

PRIVATE_KEY        = os.environ["PRIVATE_KEY"]
RPC_URL            = os.environ.get("POLYGON_RPC_URL", "https://polygon-bor-rpc.publicnode.com")

USDC_E             = Web3.to_checksum_address("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")
PUSD               = Web3.to_checksum_address("0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB")
COLLATERAL_OFFRAMP = Web3.to_checksum_address("0x2957922Eb93258b93368531d39fAcCA3B4dC5854")

ERC20_ABI = [{"name": "balanceOf", "type": "function", "stateMutability": "view",
              "inputs": [{"name": "account", "type": "address"}],
              "outputs": [{"name": "", "type": "uint256"}]}]

OFFRAMP_ABI = [{"name": "unwrap", "type": "function", "stateMutability": "nonpayable",
                "inputs": [{"name": "_asset",  "type": "address"},
                           {"name": "_to",     "type": "address"},
                           {"name": "_amount", "type": "uint256"}],
                "outputs": []}]

w3      = Web3(Web3.HTTPProvider(RPC_URL))
account = w3.eth.account.from_key("0x" + PRIVATE_KEY)
EOA     = account.address
pusd    = w3.eth.contract(address=PUSD,               abi=ERC20_ABI)
usdc    = w3.eth.contract(address=USDC_E,             abi=ERC20_ABI)
offramp = w3.eth.contract(address=COLLATERAL_OFFRAMP, abi=OFFRAMP_ABI)

def send_tx(tx_data, gas=200_000):
    tx = tx_data.build_transaction({"from": EOA,
        "nonce": w3.eth.get_transaction_count(EOA),
        "gas": gas, "gasPrice": int(w3.eth.gas_price * 1.5), "chainId": 137})
    signed = account.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(h)
    return h.hex()

pusd_bal    = pusd.functions.balanceOf(EOA).call()
usdc_before = usdc.functions.balanceOf(EOA).call()

print(f"pUSD   : {pusd_bal    / 1e6:.6f}")
print(f"USDC.e : {usdc_before / 1e6:.6f}")

if pusd_bal == 0:
    print("⚠ No pUSD — nothing to unwrap")
    exit(0)

# _asset = USDC_E (the output token), mirroring wrap(USDC_E, ...) on the onramp
unwrap_hash = send_tx(offramp.functions.unwrap(USDC_E, EOA, pusd_bal))

usdc_after = usdc.functions.balanceOf(EOA).call()
gained     = usdc_after - usdc_before
print(f"USDC.e after : {usdc_after / 1e6:.6f} (+{gained / 1e6:.6f}) ✓")
print(f"Unwrap tx    : {unwrap_hash}")
