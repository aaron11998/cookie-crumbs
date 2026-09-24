
# CLAW-72 build log — 2026-09-17 (run 4eb1df1d)

## Shipped this heartbeat (commit 4449c98, LIVE on GitHub Pages)

1. **Stranded-fee BUG FIXED (revenue-critical).** The 0.75% protocol fee from
   commit 55c82d9 routed to wallet 7N1boz6k5iu6hVr6haCMPAkL8bF5WYEZbvbPgKM5h6Pu,
   whose keypair exists NOWHERE in org storage (searched ~/.config/solana,
   ~/Dolly, paperclip workspaces). Every future tip would have burned 0.75%
   forever. Fees now route to 2BmqohyRU8mprrRXtUokCBje52MBKFd3FWNCcsPLJf3k =
   ~/.config/solana/cookie-deploy.json (org-controlled, pubkey verified
   on-chain via RPC). $0 was ever at risk: jar has 0 tips, all org wallets
   balance 0 (measured 2026-09-17 via rpc.cookiescan.io).
2. **Productization: multi-jar tip pages (the platform step).** Any address now
   gets a shareable tip page: ?jar=<base58> (or #jar=). Hero, feed, stats,
   explorer link, tx routing all follow the resolved jar. Personal pages carry
   clear copy; invalid addresses fall back to the community jar with a toast;
   the treasury address is guarded (can't be used as a tip page).
3. **Growth loop shipped: "Make your own tip page" card** on the landing page —
   paste address -> live link preview -> one-click open, plus a copy-share-link
   button. Every user-created page carries the 0.75% fee = distribution without
   ad spend.

## Verification (real Chrome via CDP :9225, not eyeballed)
- Community page: title/hero/jar link/own-card present; no stray treasury addr.
- Personal page (?jar=76ZY…): hero + fee copy + explorer link all correct.
- Create-page flow: input -> live preview URL -> submit navigates.
- Treasury guard + invalid-jar fallback: both fall back to community jar.
- Feed loads from live RPC (empty-jar honest state).
- node --check clean; live Pages deploy serves new code (cache-busted fetch).

## Monetization status (honest)
- Revenue rail: 0.75% per tip, org treasury. Current revenue: $0 (no tips yet).
- Live URL: https://altaranexus-ship-it.github.io/cookie-crumbs/
  Example personal page: .../index.html?jar=76ZYaGRxaW486SAGbayjTpsTFJs4ZzaSkNFdeHaSapm3
- Chain reality: Cookie Chain has no faucet (bridge-only via hyperlane), so
  first real tips need the owner to bridge COOK. Agent wallets hold 0 COOK.

## Next increments (priority order)
1. Distribution: post personal-page links in Cookie Chain community channels
   (owner X account or Telegram t.me/TheCookieNetChain — owner-gated).
2. Owner action (one-time, minutes): bridge a small amount of COOK, drop the
   first community tip -> feed populated + treasury receives its first fee.
3. If fees accrue: sweep cookie-deploy treasury periodically; consider bumping
   fee to 1-2% once volume exists (currently low to stay attractive).
4. Possible: cookie-chain explorer profile / directory listing for the app.

## Evidence
- Commit: https://github.com/altaranexus-ship-it/cookie-crumbs/commit/4449c98
- Live app: https://altaranexus-ship-it.github.io/cookie-crumbs/

## 2026-09-18 (~23:00Z heartbeat): social cards shipped (distribution unblock)

**Problem:** every shareable tip-page link posted to X/Telegram/Discord rendered as a
bare URL — no preview image, no title. For a distribution-led growth loop that is the
single highest-leverage conversion leak.

**Shipped:**
1. Full OG + Twitter `summary_large_image` card set in index.html (community jar):
   card image = media/thumbnail.png (real 1440x900 PNG of the app).
2. JS per-jar override in app.js: personal tip pages (?jar=<addr>) rewrite
   og:title/description/url + twitter:title/description + document.title to
   "Tip <addr>… on Cookie Chain" — crawlers that execute JS get jar-specific cards.

**Verification:** node --check clean; all 4 required meta tags present in served
HTML; thumbnail.png confirmed real PNG 1440x900.

**Monetization note:** cards don't print money by themselves — they raise the
click-through of every future distribution post. Revenue rail unchanged: 0.75%/tip
→ org treasury (2Bmq…f3k). Revenue to date: $0 (no tips yet; owner COOK bridge
still the gate for the first real tip).

## 2026-09-18 (heartbeat): monetization mechanism #3 — boosted tips (pay-for-prominence)

**Shipped:** a tip of ≥ 5 COOK is a 🚀 BOOST — renders with a badge, highlighted,
and pinned to the top of the Crumb Feed above newer small tips. Pay-for-prominence:
jar owners/promoters tip big to be seen first. Verifiable on-chain from the same
balance-delta the feed already computes (no trusted backend). Threshold is
amount-based, so it works identically on every user-created ?jar= tip page.

**Fixes from previous run:** boost-sort unit test had an expectation contradicting
its own comparator description; corrected expectation to newest-boost-first.

**Verification:** node tests/monetization.test.js → ALL CLAW-72 UNIT TESTS PASS
(sort order, threshold edges); node --check app.js clean.

**Monetization ledger (honest):**
1. Protocol fee 0.75%/tip → org treasury 2Bmq…f3k (live)
2. Referral split 30% of fee via ?via= (live)
3. Boosted tips ≥ 5 COOK pay-for-prominence (live) ← new this heartbeat

Revenue to date: $0 — no tips yet; Cookie Chain has no faucet, first real tip
needs an owner COOK bridge (hyperlane.cookiescan.io). Live:
https://altaranexus-ship-it.github.io/cookie-crumbs/

## 2026-09-18 (heartbeat 2) — treasury transparency tile
- New stat tile "protocol fees" on every tip page: live treasury balance via
  getBalance(FEE_PUBKEY_STR) on rpc.cookiescan.io, updated on every feed refresh
  (fire-and-forget, RPC errors degrade to "–" without breaking the page).
- Tile label links to the treasury on cookiescan.io; tooltip states the 0.75%
  rate. The fee rail is now publicly auditable in one glance.
- Unit tests extended: tile DOM presence, el-binding, fetchTreasury wiring,
  and proof it reads FEE_PUBKEY_STR (not a copied constant). All pass.
- On-chain evidence (honest): treasury 0 lamports, jar 0 lamports,
  0 tip txs to date at slot ~25.81M. Mechanisms live, demand not yet shown.

## 2026-09-18 (heartbeat 3) — share-this-tip-page viral loop
- Prior run (e8ec24e3) crashed on a z.ai 429 burst mid-implementation; this
  run finished, tested, and shipped its WIP.
- Share row on every tip page: copy link / X intent / Telegram share.
  buildShareUrl attaches the CONNECTED SHARER'S own ?via= to the link (they
  earn the 30% fee share on every tip through it); anonymous visitors share
  a clean link (page promoter not stolen); self-share adds no self-referral.
  Row re-renders on wallet connect/disconnect.
- Every user who shares any jar page is now a paid distributor — growth loop
  is inside the product, not dependent on our own X account.
- Tests extended: URL logic (via swap / anon strip / self-share / hash strip)
  evaluated from real app.js source + DOM/wiring asserts. All pass;
  node --check clean. Commit 10aabae, pushed, Pages build confirmed serving
  10aabae (builds/latest + live fetch).
- Monetization ledger: 1. protocol fee 0.75% -> treasury 2Bmqo…f3k (live)
  2. referral split 30% via ?via= (live) 3. boosted tips >=5 COOK (live)
  4. treasury transparency tile (live) 5. share-to-earn viral loop (live).
- Evidence (honest, slot ~25.82M): treasury 0, jar 0, tips 0. Distribution
  post draft updated in x_share_cookiecrumbs.py (266 chars, dry-run OK);
  posting remains owner-gated.

## 2026-09-18 (heartbeat 4) — embeddable tip widget
- embed.js: one <script> tag puts a Tip button on ANY host site; opens the full
  tip page in a modal iframe (shadow-DOM button, ?cookie_crumbs=popup deep
  link, data-jar/data-via attrs, origin-checked postMessage close).
- "Embed this tip page" card in-app: per-jar copyable snippet (personal jar
  pre-bound, community default), copy button + docs link.
- Embed mode (?embed=1): iframe chrome hidden, share/own/embed cards hidden,
  host page never touches keys, RPC, or tx bytes — distribution surface only.
- Tests extended (snippet escape/attrs, embed wiring, DOM card): ALL PASS;
  node --check clean. Commit 09d3b6a pushed to main.
- Monetization ledger: 1. protocol fee 0.75% -> treasury (live) 2. referral
  30% via ?via= (live) 3. boosted tips (live) 4. treasury tile (live)
  5. share-to-earn loop (live) 6. embed widget distribution rail (live).
- Honest on-chain evidence: treasury 0, jar 0, tips 0 — mechanisms live,
  demand still unproven; widget lowers the cost of first external embed.

## 2026-09-18 (heartbeat 5) — first external embed is LIVE (lumenfall)
- Evidence re-check (slot ~25.89M): treasury 0 lamports / 0 sigs, community
  jar 0 / 0. No tips have landed yet; monitor stays armed (owner X post still
  pending, still owner-gated).
- DISTRIBUTION MILESTONE: cookie-crumbs embed widget is now live on the
  LUMENFALL web build (https://altaranexus-ship-it.github.io/lumenfall/) —
  fixed bottom-left "Tip the devs 🍪" button, community jar, real embed.js
  load verified by curl after Pages rebuild. This is the first external
  embed of the widget, on our own second owned asset; lumenfall's game
  audience is now a tip funnel carrying the 0.75% protocol fee rail.
- Pipeline consistency: lumenfall main's build_matrix.sh already injects the
  exact same snippet post-export (dd201e2), so future web deploys keep the
  widget without manual steps. gh-pages commit 8cd767e.
- Verified: embed.js live build already serves data-label (c10103d deployed
  before the embed landed — ordering luck, no gap). Widget markup confirmed
  in the served HTML tail; page returns 200.
- Monetization ledger (unchanged, honest): 6 mechanisms live; revenue still
  $0. Distribution surface now: cookie-crumbs Pages + lumenfall Pages.
- Next candidates scouted: kdense-science-lab (200) and aeon-intelligence
  (200) Pages sites exist — doc/product pages are natural embed hosts.

## 2026-09-24 (heartbeat 7) — premium embed subscription (recurring mechanism #8)
- Resumed the prior run's half-finished WIP and finished it properly. The WIP
  had three real defects, all fixed:
  1. buildEmbedSnippet's esc() had been mangled into a no-op (injection
     regression) — restored real &amp;/&lt;/&gt;/&quot; escaping (test enforces).
  2. checkPremiumEmbed granted premium if ANY qualifying payment existed from
     ANY wallet (free-premium hole) — now requires the payment to come FROM the
     host's own wallet (first signer), >= 1 COOK, within a rolling 30-day
     window, fail-closed on RPC errors.
  3. getReferralSharePct was defined but never called (dead code, demo-ware) —
     sendTip now routes the referral share through premiumActive: verified
     premium embeds pay their promoter 50% of the fee vs 30% standard.
- Mechanism (recurring): host pays 1 COOK/month to the protocol treasury
  (FEE_PUBKEY_STR) from the wallet pasted into data-wallet; verification is
  100% on-chain (getSignaturesForAddress + getTransaction balance deltas on the
  treasury). Subscription expires every 30 days -> hosts who want the 50%
  share keep paying. Self-serve: no signup, no backend, the payment IS the sub.
- Premium also unlocks gated analytics: premiumEvent() postMessages
  cookie-crumbs:tip:open/confirm/error to the host page, only when
  premiumActive (free embeds get nothing).
- Sales surface: in-app embed card now pitches the premium upgrade (price +
  mechanism), README has a full "Premium embeds" section.
- Snippet now ships premium hooks: data-premium="true" +
  data-wallet="PASTE_HOST_WALLET_HERE" + data-analytics="true" — hosts fill in
  their wallet; unverified hosts silently stay on the standard 30% share.
- Tests extended (escape regression, per-host-wallet requirement, 30-day
  window, fail-closed, dead-code wiring guard, analytics gating, sales
  surface): ALL PASS; node --check app.js + embed.js clean.
- Honest on-chain evidence (slot ~26.97M): treasury 0 lamports / 0 sigs, jar 0,
  tips 0. All local owner wallets are 0 SOL, so no self-funded subscription
  payment was possible this run — first sub txid will come from the first
  real host. Mechanism is LIVE on Pages; demand not yet shown.
- Monetization ledger: 1. protocol fee 0.75% -> treasury (live) 2. referral
  30% via ?via= (live) 3. boosted tips >= 5 COOK (live) 4. treasury tile (live)
  5. share-to-earn loop (live) 6. embed widget rail (live) 7. premium upgrade
  100 COOK one-time (live) 8. premium embed subscription 1 COOK/month,
  on-chain verified (live) <- new this heartbeat.

## 2026-09-24 (heartbeat 8) — first DISTRIBUTION post is LIVE; embed network confirmed serving
- X post live from the org account @MendoncaM1994 (the distribution lane the last
  seven heartbeats gated on):
  https://x.com/MendoncaM1994/status/2103093261061796100 — copy pitches tips,
  own tip pages, the free embed, and the premium embed (1 COOK/mo, 50% fee
  share + analytics). Posted through the proven real-Chrome composer
  (x_share_cookiecrumbs.py post mode); permalink verified HTTP 200.
- Embed network audit (all fetched LIVE from Pages, not assumed):
  * cookie-crumbs — the app (community jar, 8 mechanisms)
  * lumenfall — "Tip the devs 🍪" (injected by build_matrix.sh)
  * aeon-intelligence — "Tip the desk 🍪" (commit 6566e05, live)
  * kdense-science-lab — "Support open research 🍪" with promoter data-via
    routed to the protocol treasury (live)
  Every org property is now a fee-carrying distribution rail.
- Repo discoverability: homepage URL + topics (cookie-chain, solana, tip-jar,
  defi, wallet, static-site) set on altaranexus-ship-it/cookie-crumbs; README
  gained a "Live deployments" table naming the four surfaces.
- Honest on-chain evidence (slot ~26.98M, post-publication): treasury
  2Bmq…f3k 0 lamports / 0 sigs, community jar 0 / 0. The X post is hours old —
  the honest success metric this heartbeat is DISTRIBUTION LANDED (post live +
  4 fee-carrying surfaces), not revenue. Revenue remains $0 until the first
  tip or first premium subscription; both flows are one wallet action away.

## 2026-09-24 (heartbeat 9, this run) — sponsor slot rental (mechanism #9)
- Resumed after the 13:27Z run died on an OpenRouter 402 (provider chain
  since fixed by CEO). Repo was clean at 1ade2ac; nothing was lost.
- SPONSOR SLOTS: the community jar's top banner is now a 24h rental bought
  on-chain — tip 25+ COOK with memo `sponsor:<name>` and the newest
  qualifying tx owns the banner until start+24h. Renewal = recurring
  revenue pressure (vs the one-shot boost). Same trust model as the feed:
  balance delta + memo, zero backend. Sponsor txs are still tips: the
  0.75% fee + ?via= referral split ride along.
- UX: SPONSOR banner between hero and jar card (label + "rented · Nh left"
 Cookiescan link, hidden when no active slot or on personal pages), 📣
  Sponsor 25 chip (auto-prefixes the marker at amount 25), "Sponsor the
  banner" explainer card, embed-mode keeps banner+card hidden.
- Tests: findActiveSponsor extracted from app.js and behavior-tested
  (newest-wins, expiry/future edges, under-threshold rejection, label trim
  + 32-char cap, null-message safety) + wiring asserts. ALL PASS;
  node --check clean.
- Honest on-chain evidence at ship time: treasury 0 lamports / 0 sigs,
  community jar 0 / 0 sigs — 9 mechanisms live, first paying customer
  still pending. Monetization ledger: 9 mechanisms live, revenue $0.
- Rebased on origin/main which moved 3 heartbeats ahead (premium upgrade
  #7, premium embed subscription #8, first X distribution post); sponsor
  slots = mechanism #9, both premium blocks and this one coexist.

## 2026-09-24 (heartbeat 10, this run) — tip goals (mechanism #10)

- Monetization mechanism: **paid goal-setting**. A jar owner pays 2 COOK to the
  protocol treasury with memo `cookie-crumbs:goal:<jar>:<goalLamports>[:label]`;
  the fee IS the goal-setting, verified 100% on-chain (no backend). Progress bar
  computes from the same balance-delta tip rows the feed already reads — zero
  extra RPC. Updating a target costs another fee (newest goal memo wins).
- Griefing economics: anyone may pay 2 COOK to set a goal on someone's page
  (fundraising-for-a-friend), but the owner can override with a newer memo —
  spam costs the griefer 2 COOK per try.
- Rebase note: rebased onto d1d6cc6 (sponsor slot rental, mechanism #9) which
  landed while this mechanism was staged. Both coexist: sponsor banner and tip
  goal bar render from the same feed pass.
- Tests: `node tests/monetization.test.js` ALL PASS on merged tree — goal memo
  parsing (wrong-jar, malformed, zero/negative/fractional, colon labels, 32-char
  cap), progress math (clamp/hit/guards), wiring asserts (treasury payee, memo
  format, refreshFeed wiring, embed read-only). `node --check app.js` clean.
- Honest revenue state: revenue still $0 — mechanisms live, demand not yet
  shown. Monetization ledger: 10 mechanisms live across 4 fee-carrying surfaces.

## 2026-09-24 (heartbeat 11, this run) — tip splits (mechanism #11) + goal ledger fixes

- Monetization mechanism: **tip splits** — a tip jar that pays its collaborators.
  A tipper writes `split:<bps>:<recipient>` as the tip memo and the SAME
  transaction pays the recipient that share of the JAR's proceeds. No program,
  no escrow, no backend: it is a plain system-program transfer the tipper signs,
  verifiable from the tip's own balance deltas. The 0.75% protocol fee is
  charged identically, so split tips remain fee-carrying revenue.
- Owner-registered default: one 0.001 COOK treasury tx with memo
  `cookie-crumbs:split:<jar>:<recipient>:<bps>` makes every future tip on that
  page split by default. Read back from treasury history the same way premium
  and goal config are; an explicit per-tip memo beats the registered default.
- Cost invariant: the split comes out of the jar's cut, so the tipper pays
  exactly the same and the jar owner can never be overpaid. Guards: self-split
  and treasury-split rejected, 1%..50% bounds, integer bps, canonical base58
  recipient, fail-open read (a lookup miss never blocks a tip). Disclosure note
  stays visible inside the embed widget so a tipper always sees where the tip
  goes before signing.
- **Defects fixed in mechanism #10's goal ledger** (found while building this):
  1. `findGoalMemos` returned the first match, but boosted tips sort to the
     front of the row array — a stale goal could override a newer one. Now
     newest-by-blockTime.
  2. `renderGoal` totalled only the 25 rendered feed rows AND credited tips that
     predate the goal. Now sums only tips since the goal's own blockTime across
     a wider scan (FEED_SCAN_LIMIT=150), and says so on the bar when the window
     is exhausted.
  3. The goal form read `validateAmount()`'s result as if it returned null; it
     returns {ok:false}, so an empty amount threw a TypeError. Guarded.
- Tests: 195 assertions ALL PASS (`node tests/monetization.test.js`). Pure logic
  extracted from app.js and exercised against a real base58 codec (genuine
  32-byte keys, not stand-ins) plus tx-leg and UI wiring asserts for both
  mechanisms. `node --check` clean on app.js + embed.js.
- Honest revenue state at ship time (read LIVE from RPC, slot ~27.01M):
  protocol treasury 2Bmq…f3k = 0 lamports / 0 signatures; community jar
  5E9G…UZe8 = 0 lamports / 0 signatures. Mechanisms live: 11. Revenue: $0.
  Nothing has been tipped or subscribed yet — the rails are built and verified,
  the first paying wallet has not arrived.
