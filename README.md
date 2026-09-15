# 🍪 Cookie Crumbs

A fully on-chain **tip jar cApp for [Cookie Chain](https://www.cookiechain.wtf)** — the community-run SVM.
Connect a wallet (**Nightly** supported, plus any Solana-standard injected wallet), send a COOK tip with the click of a button, and watch the **Crumb Feed** update straight from chain data.

**Live app:** https://altaranexus-ship-it.github.io/cookie-crumbs/
**Chain:** Cookie Chain mainnet · RPC `https://rpc.cookiescan.io` · Explorer [cookiescan.io](https://cookiescan.io)

---

## What it does

- **Wallet connection** — Nightly first (per the bounty), with fallback discovery for Phantom/Solflare/Backpack-style injected providers via the Solana wallet standard.
- **Transaction execution** — tips are plain **system-program transfers** (SOL-style native COOK transfer). The connected wallet is fee payer; nothing is custodied, no backend exists.
- **Transaction confirmation handling** — blockhash is fetched up-front, the signature is confirmed via `confirmTransaction` with blockheight-based expiry **and** a 60s timeout, and on-chain errors are surfaced.
- **Error handling & feedback** — human-readable errors for rejection / insufficient funds / wrong network / RPC hiccups, status banner at each stage (build → sign → broadcast → confirm), toasts + inline receipts with explorer links.
- **App-specific data & activity** — the **Crumb Feed** reads the jar's recent history via `getSignaturesForAddress` → `getTransaction` (balance deltas, senders, timestamps), plus totals: crumb count, total COOK, unique tippers, last-24h volume and a 24-hour tips-per-hour chart.
- **Analytics** — everything above is computed client-side from RPC data. No API keys, no database.

### The jar

All tips land in a plain wallet owned by nobody's app logic — a community pot:

```
5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8
```

View it on the explorer: https://cookiescan.io/account/5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8

## Getting COOK

Cookie Chain has no faucet. Get COOK by bridging from Solana through the community multi-sig Hyperlane bridge: **https://hyperlane.cookiescan.io** (see the [docs](https://docs.cookiechain.wtf/getting-started)).

## Running locally

No build step, no dependencies — it's a static site:

```bash
git clone https://github.com/altaranexus-ship-it/cookie-crumbs
cd cookie-crumbs
python3 -m http.server 8080
# open http://localhost:8080
```

The only external runtime dep is `@solana/web3.js` loaded via CDN (unpkg IIFE build). Point your wallet (Nightly → network → Cookie Chain, RPC `https://rpc.cookiescan.io`) and you're live.

## Architecture

```
index.html    markup — jar card, tip form, feed, how-it-works
styles.css    cookie-themed dark UI (pure CSS, no framework)
app.js        all logic:
              · wallet discovery/connect (nightly.solana, window.solana, providers.solana)
              · getLatestBlockhash → Transaction(SystemProgram.transfer) → sign → sendRawTransaction
              · confirmTransaction({signature, blockhash, lastValidBlockHeight}, 'confirmed')
              · feed: getSignaturesForAddress → getTransaction → pre/post balance deltas
              · stats + canvas chart, 30s auto-refresh
```

**Design choice:** the Memo program is not deployed on Cookie Chain, so tip *messages* are kept client-side (attached to the tip in the browser) while the *money* is 100% on-chain. Everything the chain can prove, the app shows; nothing is faked.

## Submission checklist (Superteam Earn — create-an-app-on-cookie-chain-app)

- [x] Built on Cookie Chain (SVM) — mainnet RPC, native COOK transfers
- [x] Wallet connection (Nightly required ✓, standard wallets ✓)
- [x] Transaction execution + confirmation handling + error handling
- [x] App-specific data/activity view (feed) + analytics (stats + chart)
- [x] Live, publicly accessible URL (GitHub Pages)
- [x] Open-source repo (MIT)
- [x] README with setup instructions (this file)
- [ ] X thread demo + share in Cookie Chain Telegram (owner step)

## License

MIT — do whatever, just be excellent to each other. 🍪
