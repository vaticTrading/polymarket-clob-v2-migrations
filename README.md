# Polymarket CLOB V2 — Code Examples

End-to-end, **validated** code examples for Polymarket's CLOB V2 API — covering every step from RPC check to offramp. Both **Python** and **TypeScript** are included, for both **EOA private key** and **Gnosis Safe** wallet setups.

> **Go-live:** Polymarket CLOB V2 launched **April 28, 2026**.  
> Need a managed API? Check [platform.vatic.trading](https://platform.vatic.trading) for hosted V2 access with automatic wallet provisioning.

---

## What's new in V2

| Change | V1 | V2 |
|---|---|---|
| Collateral token | USDC.e | **pUSD** |
| Wrap path | — | `CollateralOnramp.wrap(asset, to, amount)` |
| Unwrap path | — | `CollateralOfframp.unwrap(asset, to, amount)` |
| SDK (Python) | `py-clob-client` | `py-clob-client-v2` |
| SDK (TypeScript) | `@polymarket/clob-client` | `@polymarket/clob-client-v2` |
| Constructor | Positional args | Options object (`chain` not `chainId`) |
| EIP-712 domain version | `"1"` | `"2"` |
| Exchange address | `0x4bFb…` | `0xE111…` |
| Market info | Hardcoded fee tables | `getClobMarketInfo(conditionId)` → `mts`, `t[]`, `nr` |
| Market orders | `createAndPostOrder(FOK)` | `createAndPostMarketOrder(MarketOrderArgsV2)` |
| `cancelOrder` | Raw `orderID` string | `{ orderID }` object |
| Split/merge | Direct CTF contract | Via `CtfCollateralAdapter` (required for CLOB-tradeable token IDs) |
| Sell orders | — | Must sync YES token balance first: `update_balance_allowance(CONDITIONAL, token_id)` |

---

## Structure

```
polymarket_clob_v2/
├── .env.example
├── python/
│   ├── private_key/
│   │   ├── requirements.txt
│   │   ├── 1_rpc.py               — RPC smoke test (balances)
│   │   ├── 2_allowances.py        — Set all approvals (ERC-20 pUSD + ERC-1155 CTF)
│   │   ├── 3_wrap.py              — Wrap USDC.e → pUSD via CollateralOnramp
│   │   ├── 4_init_clob.py         — Init ClobClient V2, market info, order book
│   │   ├── 5_limit_buy_order.py   — GTC BUY 2 ticks below best bid → cancel
│   │   ├── 6_market_buy_order.py  — FOK market BUY at best ask → poll fill
│   │   ├── 7_market_sell_order.py — FOK market SELL full YES balance → settlement poll
│   │   ├── 8_split.py             — pUSD → YES + NO via CtfCollateralAdapter
│   │   ├── 9_limit_sell.py        — GTC SELL YES tokens 2 ticks above best ask → cancel
│   │   ├── 10_merge.py            — YES + NO → pUSD via CtfCollateralAdapter
│   │   └── 11_offramp.py          — Unwrap pUSD → USDC.e via CollateralOfframp
│   └── safe_wallet/
│       ├── requirements.txt
│       ├── _safe.py               — Safe execTransaction helper
│       ├── 1_rpc.py  …  11_offramp.py  (same pipeline, pUSD held in Safe)
└── typescript/
    ├── private_key/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── 1_rpc.ts  …  11_offramp.ts
    └── safe_wallet/
        ├── package.json
        ├── tsconfig.json
        ├── _safe.ts               — Safe execTransaction helper
        └── 1_rpc.ts  …  11_offramp.ts
```

---

## Quickstart

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in:
#   PRIVATE_KEY         — hex private key, no 0x prefix
#   SAFE_ADDRESS        — (safe_wallet only) your Gnosis Safe address
#   POLYGON_RPC_URL     — optional, defaults to public node
#   CLOB_V2_BASE_URL    — optional, defaults to https://clob-v2.polymarket.com
```

---

### 2. Python — Private Key

```bash
cd python/private_key
pip install -r requirements.txt

python 1_rpc.py                # verify RPC + balances
python 2_allowances.py         # approve all contracts (one-time setup)
python 3_wrap.py               # wrap USDC.e → pUSD (one-time setup)
python 4_init_clob.py          # check market info + order book
python 5_limit_buy_order.py    # GTC BUY 2 ticks below best bid → cancel
python 6_market_buy_order.py   # FOK market BUY at best ask → poll fill
python 7_market_sell_order.py  # FOK market SELL full YES balance
python 8_split.py              # split pUSD → YES + NO tokens
python 9_limit_sell.py         # GTC SELL YES tokens → cancel
python 10_merge.py             # merge YES + NO → pUSD
python 11_offramp.py           # unwrap pUSD → USDC.e
```

### 3. Python — Safe Wallet

```bash
cd python/safe_wallet
pip install -r requirements.txt
# .env must also have SAFE_ADDRESS

python 1_rpc.py                # verify RPC + Safe balances
python 2_allowances.py         # approve all contracts via Safe.execTransaction
python 3_wrap.py               # wrap USDC.e → pUSD into Safe
python 4_init_clob.py          # check market info
python 5_limit_buy_order.py    # GTC BUY (Safe pUSD collateral) → cancel
python 6_market_buy_order.py   # FOK market BUY
python 7_market_sell_order.py  # FOK market SELL full YES balance
python 8_split.py              # split Safe's pUSD → YES + NO
python 9_limit_sell.py         # GTC SELL YES tokens → cancel
python 10_merge.py             # merge YES + NO → pUSD
python 11_offramp.py           # unwrap pUSD → USDC.e (USDC.e sent to Safe)
```

---

### 4. TypeScript — Private Key

```bash
cd typescript/private_key
npm install

npm run 1:rpc
npm run 2:allow
npm run 3:wrap
npm run 4:init
npm run 5:buy       # GTC limit BUY → cancel
npm run 6:mbuy      # FOK market BUY → poll fill
npm run 7:msell     # FOK market SELL full YES balance
npm run 8:split     # split pUSD → YES + NO
npm run 9:sell      # GTC limit SELL YES → cancel
npm run 10:merge    # merge YES + NO → pUSD
npm run 11:offramp  # unwrap pUSD → USDC.e
```

### 5. TypeScript — Safe Wallet

```bash
cd typescript/safe_wallet
npm install

npm run 1:rpc
npm run 2:allow
npm run 3:wrap
npm run 4:init
npm run 5:buy
npm run 6:mbuy
npm run 7:msell
npm run 8:split
npm run 9:sell
npm run 10:merge
npm run 11:offramp
```

---

## Key gotchas

- **Run scripts in order.** Steps 1–3 are one-time setup; 4–11 are the full trading + lifecycle flow.
- **`EVENT_ID`** is hardcoded to `73106` in each script. Replace with any active event ID from [gamma-api.polymarket.com/events](https://gamma-api.polymarket.com/events).
- **`unwrap(_asset, to, amount)`** — `_asset` must be `USDC_E` (the **output** token), not pUSD. Mirrors the `wrap(USDC_E, ...)` call on the onramp.
- **Market orders** use `createAndPostMarketOrder` / `create_and_post_market_order` with `MarketOrderArgsV2`. `amount` = dollars for BUY, shares for SELL. Do **not** use `createAndPostOrder` with FOK — that's for limit orders only.
- **Sell orders**: before posting a SELL, you must sync your YES token balance to the CLOB server with `update_balance_allowance(AssetType.CONDITIONAL, token_id)` (Python) — the server tracks its own ledger and won't see on-chain splits otherwise.
- **Split/merge must go through `CtfCollateralAdapter`** (or `NegRiskCtfCollateralAdapter` for neg-risk markets). Direct CTF calls produce non-CLOB-tradeable token IDs.
- Scripts keep a **$1 pUSD buffer** when splitting so gas fees don't drain collateral.

---

## Resources

- [Polymarket CLOB V2 Docs](https://docs.polymarket.com)
- [platform.vatic.trading](https://platform.vatic.trading) — hosted API with managed V2 wallets, automatic allowances, and pUSD wrapping
