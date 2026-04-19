# Polymarket CLOB V2 — Code Examples

End-to-end code examples for Polymarket's CLOB V2 API, covering every step from RPC check to split/merge. Both **Python** and **TypeScript** are included.

All examples use a plain EOA private key (`signatureType=0`) — no Gnosis Safe or relay service required.

> **Go-live:** Polymarket CLOB V2 launches **April 28, 2026**.  
> Need a managed API? Check [platform.vatic.trading](https://platform.vatic.trading) for hosted V2 access with automatic wallet provisioning.

---

## What's new in V2

| Change | V1 | V2 |
|---|---|---|
| Collateral token | USDC.e | **pUSD** |
| Wrap path | — | `CollateralOnramp.wrap(asset, to, amount)` |
| SDK (Python) | `py-clob-client` | `py-clob-client-v2` |
| SDK (TypeScript) | `@polymarket/clob-client` | `@polymarket/clob-client-v2` |
| Constructor | Positional args | **Options object** (`chain` not `chainId`) |
| EIP-712 domain version | `"1"` | `"2"` |
| Exchange address | `0x4bFb…` | `0xE111…` |
| Order struct fields | includes `nonce`, `feeRateBps`, `taker` | adds `timestamp` (ms), `metadata`, `builder` (bytes32) |
| Market info | Hardcoded fee tables | `getClobMarketInfo(conditionId)` → `mts`, `fd`, `mos`, `t[]` |
| Allowances required | 7 | **11** (adds CtfCollateralAdapter × 2, for both ERC-20 and ERC-1155) |
| Split/merge | Direct CTF contract | **Via CtfCollateralAdapter** (required for CLOB-tradeable IDs) |
| `cancelOrder` | Raw `orderID` string | **`{ orderID }` object** |
| Builder auth | HMAC headers + `builder-signing-sdk` | Single `builderCode` (bytes32) on each order |

---

## Structure

```
polymarket_clob_v2/
├── .env.example
├── python/
│   └── private_key/
│       ├── requirements.txt
│       ├── 1_rpc.py          — RPC smoke test (MATIC / USDC.e / pUSD balances)
│       ├── 2_allowances.py   — Set 11 approvals (6 ERC-20 pUSD + 5 ERC-1155 CTF)
│       ├── 3_wrap.py         — Wrap USDC.e → pUSD via CollateralOnramp
│       ├── 4_init_clob.py    — Init ClobClient V2, getClobMarketInfo, getOrderBook
│       ├── 5_limit_order.py  — GTC BUY 2 ticks below best bid → cancel
│       ├── 6_market_order.py — FOK BUY at best ask → poll fill → FOK SELL back
│       ├── 7_split.py        — pUSD → YES + NO via CtfCollateralAdapter
│       └── 8_merge.py        — YES + NO → pUSD via CtfCollateralAdapter
└── typescript/
    ├── tsconfig.json
    └── private_key/
        ├── package.json
        ├── 1_rpc.ts
        ├── 2_allowances.ts
        ├── 3_wrap.ts
        ├── 4_init_clob.ts
        ├── 5_limit_order.ts
        ├── 6_market_order.ts
        ├── 7_split.ts
        └── 8_merge.ts
```

---

## Quickstart

### 1. Configure environment

```bash
cp .env.example .env
# Fill in PRIVATE_KEY (hex, no 0x prefix)
# Optionally set POLYGON_RPC_URL for a dedicated RPC endpoint
```

### 2. Python

```bash
cd python/private_key
pip install -r requirements.txt

python 1_rpc.py           # verify balances
python 2_allowances.py    # approve all 11 contracts
python 3_wrap.py          # wrap USDC.e → pUSD
python 4_init_clob.py     # check market info + order book
python 5_limit_order.py   # place + cancel a limit order
python 6_market_order.py  # FOK buy → sell round-trip
python 7_split.py         # split pUSD into YES/NO tokens
python 8_merge.py         # merge YES/NO tokens back to pUSD
```

### 3. TypeScript

```bash
cd typescript/private_key
npm install

npm run 1:rpc
npm run 2:allowances
npm run 3:wrap
npm run 4:init
npm run 5:limit
npm run 6:market
npm run 7:split
npm run 8:merge
```

---

## Notes

- **Run scripts in order** for a full round-trip. Steps 1–3 are setup (one-time); 4–8 are the trading flow.
- **`EVENT_ID`** is hardcoded to `73106` in each script — replace with any active event ID from [gamma-api.polymarket.com/events](https://gamma-api.polymarket.com/events).
- Scripts keep a **$1 pUSD buffer** when splitting (so gas fees don't fail the tx).
- `cancelOrder` takes `{ orderID: string }` — passing a raw string silently fails in V2.
- Split/merge **must** go through `CtfCollateralAdapter` (or `NegRiskCtfCollateralAdapter` for neg-risk markets). Direct CTF contract calls produce non-CLOB-tradeable token IDs.

---

## Resources

- [Polymarket CLOB V2 Docs](https://docs.polymarket.com)
- [platform.vatic.trading](https://platform.vatic.trading) — hosted API with managed V2 wallets, automatic allowances, and pUSD wrapping
