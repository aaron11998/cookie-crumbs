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
- **Boosted tips (pay-for-prominence)** — a tip of **5+ COOK** is a 🚀 BOOST: it renders with a badge and is pinned to the top of the Crumb Feed above newer small tips. Verifiable on-chain from the same transfer the feed already reads — no backend, no trust. Boost bigger → get seen first.
- **Referral split** — share links carrying `?via=<address>` route 30% of the protocol fee to the promoter. Growth rail: earn by distributing tip pages.

### The jar

All tips land in a plain wallet owned by nobody's app logic — a community pot:

```
5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8
```

View it on the explorer: https://cookiescan.io/address/5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8

## Walkthrough

Narrated video walkthrough (75s): **https://altaranexus-ship-it.github.io/cookie-crumbs/media/walkthrough.mp4** — also in the repo under `media/walkthrough.mp4`.

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


---

## Bounty alignment: Create an App on Cookie Chain (Superteam Earn)

Mapping of the listing's required features to what ships here:

| Listing requirement | Cookie Crumbs |
|---|---|
| Connect a wallet (Nightly required) | Nightly-first provider discovery + wallet-standard fallback (Phantom/Solflare/Backpack-style) |
| Display connected wallet address | Shortened address + wallet label in the connect button, full address in receipts |
| Interact with on-chain functionality | Native COOK system-program transfers to the community jar (or any ?jar=<addr> page) |
| Execute transactions + real-time feedback | Stage banner: build -> sign -> broadcast -> confirm, toasts at each step |
| Transaction confirmation handling | Pre-fetched blockhash, blockheight-based expiry + 60s timeout via confirmTransaction |
| Error handling and user feedback | Human-readable errors: rejection / insufficient funds / wrong network / RPC failure |
| App-specific data and activity | Crumb Feed: per-tip history (sender, amount, message, time) read from chain |
| Analytics / dashboard | Totals (tips, COOK volume, unique tippers, 24h volume) + 24-hour tips-per-hour chart |
| CookieScan integration | Deep links to cookiescan.io for every tip, the jar, and fee transactions |
| Deployed and publicly accessible | https://altaranexus-ship-it.github.io/cookie-crumbs/ (GitHub Pages) |
| Open source + README | This repo; setup in Running locally above |

Application addresses (Cookie Chain mainnet, RPC https://rpc.cookiescan.io):

- Community tip jar (tip destination): 5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8
- Protocol fee treasury (0.75% of each tip): 2BmqohyRU8mprrRXtUokCBje52MBKFd3FWNCcsPLJf3k

Both are plain system accounts - the app is 100% client-side and custodies nothing.
Get COOK for your first tip via the community bridge: https://hyperlane.cookiescan.io

## Embed on your site

Put a **Tip 🍪** button on any page with one script tag:

```html
<script src="https://altaranexus-ship-it.github.io/cookie-crumbs/embed.js"></script>
```

- Add `data-jar="<base58 address>"` to collect tips into **your** jar (omit it to tip the community jar).
- Add `data-via="<base58 address>"` to credit a promoter's referral fee share on tips from your widget.
- Add `data-label="<text>"` to customize the button (default **Tip 🍪**; trimmed, max 32 chars).
- The button opens the full tip page in an on-site popup; tips are plain on-chain COOK transfers signed by the tipper's own wallet. Your site never touches keys, RPC, or transaction bytes.
- Deep link: load your page with `?cookie_crumbs=popup` to open the tip flow immediately.
- JS API: `CookieCrumbs.open()` / `CookieCrumbs.close()` for custom triggers.

Every tip through an embedded widget carries the same 0.75% protocol fee as the hosted app — embedding is the platform's distribution rail.

### Live deployments (the embed network)

The widget is deployed on every org-owned property — each one is a live distribution rail carrying the protocol fee:

| Site | Widget | Notes |
|------|--------|-------|
| [Cookie Crumbs](https://altaranexus-ship-it.github.io/cookie-crumbs/) | the app itself | community jar, all 8 mechanisms |
| [Lumenfall](https://altaranexus-ship-it.github.io/lumenfall/) | "Tip the devs 🍪" (fixed bottom-left) | injected automatically by `build_matrix.sh` on every web export |
| [Aeon Intelligence](https://altaranexus-ship-it.github.io/aeon-intelligence/) | "Tip the desk 🍪" | research-brief audience |
| [K-Dense Science Lab](https://altaranexus-ship-it.github.io/kdense-science-lab/) | "Support open research 🍪" | storefront audience, promoter share routed to the protocol treasury |


### Premium embeds — 1 COOK/month, verified on-chain

Upgrade any widget to a **premium embed** and earn **50% of the protocol fee** on every tip from your site (vs the standard 30% promoter share), plus tip analytics events.

1. Send **1 COOK** (one-time per month) from your wallet to the protocol treasury `2BmqohyRU8mprrRXtUokCBje52MBKFd3FWNCcsPLJf3k` — a plain transfer in Nightly/Phantom, memo optional.
2. Add your attributes to the script tag:

   ```html
   <script src="https://altaranexus-ship-it.github.io/cookie-crumbs/embed.js"
           data-jar="<your jar>"
           data-premium="true"
           data-wallet="<the wallet that paid>"></script>
   ```

3. That's it — verification is fully on-chain: the widget scans the treasury's recent transactions for a payment of ≥ 1 COOK **from your wallet** within the last 30 days. No account, no API key, no backend.

Why it recurs: verification covers a rolling 30-day window, so keep the 50% share flowing by topping up 1 COOK each month. The payment **is** the subscription.

Premium also unlocks analytics: the widget `postMessage`s `{ type: "cookie-crumbs:tip:open" | "cookie-crumbs:tip:confirm" | "cookie-crumbs:tip:error", detail }` events to your host page (listen for `message` events and filter on the `type` prefix). Non-premium embeds receive no events, and verification fails closed — if the on-chain check can't confirm your payment, the widget silently stays on the standard 30% share.

## Sponsor the banner

The community tip page sells its top banner slot as a **24-hour rental**, settled entirely on-chain:

1. Send a tip of **25+ COOK** to the community jar with the message `sponsor:<your name>` (the **📣 Sponsor 25** chip fills the amount and auto-prefixes the marker for you).
2. The newest qualifying transaction owns the banner at the top of the page for **24 hours** — your label renders next to a "rented · Nh left" link pointing at the renting transaction on [Cookiescan](https://cookiescan.io).
3. Renewal is the revenue loop: when the slot expires the banner disappears until someone rents it again.

Like every other number in Cookie Crumbs, sponsorship is verified straight from the ledger (balance delta + SPL Memo) — there is no backend, no database, and nothing to trust but the chain. A sponsor tip is still a tip: the 0.75% protocol fee and any `?via=` referral split apply exactly as usual.
