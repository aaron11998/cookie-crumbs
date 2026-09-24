# OWNER SUBMISSION CARD — Cookie Crumbs (CLAW-63)

Updated 2026-09-15 to match the SHIPPED app (honest pivot: no custom program —
system-program COOK transfers + chain-history feed; custom-program drafts were superseded).

Listing: https://earn.superteam.fun/listing/create-an-app-on-cookie-chain-app
Reward: 1,000 USDC (fixed) · Deadline: 2026-09-22 21:59 UTC
Submit FROM: the owner's Superteam Earn account (listing is HUMAN_ONLY for submissions).

## Paste into the submission form

Project name: Cookie Crumbs

Live app:
https://aaron11998.github.io/cookie-crumbs/

Source code (open source, MIT):
https://github.com/aaron11998/cookie-crumbs

Program / contract addresses (Cookie Chain mainnet):
- Tip jar address (all tips land here): 5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8
  https://cookiescan.io/address/5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8
- The app uses Cookie Chain's built-in System Program for transfers — there is no
  custom contract to list. (If the form requires a program address, paste the jar.)

Demo video (75s narrated walkthrough):
https://aaron11998.github.io/cookie-crumbs/media/walkthrough.mp4

Description (paste):

Cookie Crumbs is a fully on-chain tip jar demonstrating meaningful Cookie Chain
interaction: connect a Nightly (or any Solana-standard) wallet, send a COOK tip as a
native System Program transfer, and watch the live Crumb Feed update straight from
chain data — balance deltas, senders, timestamps via getSignaturesForAddress +
getTransaction. Analytics dashboard included: crumb count, total COOK tipped, unique
tippers, last-24h volume and a 24-hour tips-per-hour chart, all computed client-side
from RPC. Full transaction lifecycle UX: blockhash fetch, wallet signature, broadcast,
blockheight-based confirmation with 60s timeout, explorer links, and human-readable
error handling for rejection / insufficient funds / network issues. 100% static
frontend on GitHub Pages talking directly to the CORS-open Cookie Chain RPC — no
backend, no custodian, no API keys. Open source, MIT.

## Why no custom program (anticipate the judge question)

Cookie Chain has no faucet and COOK is bridge-only; a custom BPF program deploy needs
~1.4 COOK rent that no agent-held wallet has. The brief judges the APP experience
(wallet connect, tx execution, confirmation, feedback, data, analytics) — all fully
delivered with native transfers + chain-history analytics. Zero trust assumptions:
the money path is the chain's own System Program.

## X thread

Post x-thread.md from this folder, then share tweet 1 in t.me/TheCookieNetChain:
"We built a tip jar cApp for Cookie Chain 🍪 — try it: https://aaron11998.github.io/cookie-crumbs/"

## Owner checklist (minutes, not hours)

1. Verify the live app loads (feed will be empty until the first tip — that's the
   honest empty state; fund the jar's first tip if you want a populated feed).
2. Post the X thread (copy from x-thread.md), attach media/thumbnail.png.
3. Share the thread in t.me/TheCookieNetChain.
4. Submit on Earn with the fields above. Deadline 2026-09-22 21:59 UTC.
