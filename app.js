/* Cookie Crumbs — tip jar cApp on Cookie Chain (SVM)
 * 100% client-side. Talks straight to the Cookie Chain RPC.
 * Wallet: any Solana wallet-standard injected wallet (Nightly supported).
 * Tips: plain system-program transfers, confirmed via polling.
 */
"use strict";

const RPC_URL = "https://rpc.cookiescan.io";
const EXPLORER = "https://cookiescan.io";
const COMMUNITY_JAR = "5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8";
// Protocol treasury — org-controlled keypair (cookie-deploy.json).
// 2026-09-17 FIX: replaced 7N1boz6k5iu6hVr6haCMPAkL8bF5WYEZbvbPgKM5h6Pu, whose
// keypair was never stored anywhere — fees routed there would have been
// unrecoverable. Nothing was lost (wallet balance 0, no tips yet).
const FEE_PUBKEY_STR = "2BmqohyRU8mprrRXtUokCBje52MBKFd3FWNCcsPLJf3k";
const PROTOCOL_FEE_BPS = 75; // 0.75% protocol fee on each tip -> org treasury
// Referral split: a share link carrying ?via=<address> routes 30% of the protocol
// fee to that address. Growth rail — promoters earn by distributing tip pages.
const REFERRAL_SHARE_PCT = 30;
// Premium embed subscription: host sites pay SUB_LAMPORTS (1 COOK/month) to the
// treasury (FEE_PUBKEY_STR) from the wallet they paste into the embed snippet.
// On-chain verification (checkPremiumEmbed) unlocks 50% referral share + analytics.
const SUB_LAMPORTS = 1_000_000_000; // 1 COOK/month (verified within a rolling 30-day window)
const PREMIUM_REFERRAL_SHARE_PCT = 50; // 50% of protocol fee for premium embeds (vs 30% standard)
// Boosted tips: a tip >= BOOST_LAMPORTS is a "boost" — it renders pinned at the
// top of the feed with a badge. Pay-for-prominence: jar owners/promoters tip big
// to be seen first. Amount-based, so it is verifiable on-chain from the same
// balance-delta the feed already computes (no trusted backend needed).
const BOOST_LAMPORTS = 5_000_000_000; // 5 COOK
// SPL Memo v2 — verified deployed + executable on Cookie Chain (getAccountInfo,
// slot ~25.7M). Lets tip messages live ON-CHAIN instead of only in the browser.
const MEMO_PROGRAM_ID_STR = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
// Sponsor slots: the newest tx to the community jar carrying memo marker
// `sponsor:<label>` of at least SPONSOR_LAMPORTS owns the sponsor banner for
// SPONSOR_HOURS. Time-based rental — recurring renewal pressure (vs the one-shot
// boost), same trusted math as the feed (balance delta + memo, no backend).
const SPONSOR_LAMPORTS = 25_000_000_000; // 25 COOK per 24h slot
const SPONSOR_HOURS = 24;
const SPONSOR_PREFIX = "sponsor:";
const REPO_URL = "https://github.com/aaron11998/cookie-crumbs";
const LAMPORTS_PER_COOK = 1_000_000_000;
const FEED_LIMIT = 25;
// How many recent jar transactions are scanned. The FEED only renders FEED_LIMIT
// rows, but a tip goal's progress must total ALL tips since the goal was set —
// scanning more than we render keeps that progress honest (the ledger needs it).
const FEED_SCAN_LIMIT = 150;
const CONFIRM_TIMEOUT_MS = 60_000;

// Premium upgrade: one-time fee (100 COOK) to unlock custom branding + analytics
// Paid to protocol treasury; verified on-chain via fee-payment memo.
// Upgraded jars get: custom hero, custom colors, custom CTA, analytics dashboard, no "powered by" badge.
const PREMIUM_UPGRADE_FEE = 100_000_000_000; // 100 COOK in lamports
const PREMIUM_MEMO_PREFIX = "cookie-crumbs:premium:";
const PREMIUM_MEMO_UPGRADE = "upgrade";
const PREMIUM_MEMO_CUSTOMIZE = "customize";

// Tip goals (mechanism #9): the jar owner pays GOAL_FEE to the treasury with a
// memo `cookie-crumbs:goal:<jarAddress>:<goalLamports>[:label]` — the fee IS
// the goal-setting, verified on-chain (no backend). Every subsequent tip moves
// the page's progress bar toward the goal, computed from the same balance-delta
// tips the feed already reads. Newer goal memos win, so owners can update the
// target for another GOAL_FEE.
const GOAL_FEE = 2_000_000_000; // 2 COOK per goal set/update
const GOAL_MEMO_PREFIX = "cookie-crumbs:goal:";

// Tip splits (mechanism #11): a tipper routes a share of the JAR's proceeds to a
// second wallet in the SAME transaction, by writing `split:<bps>:<recipient>`
// as the tip memo. Pure client-side arithmetic — no program, no escrow: the
// transfer is a plain system-program transfer the tipper signs, so it is
// verifiable on-chain from the tip's own balance deltas. The 0.75% protocol fee
// is charged identically, so every split tip is still fee-carrying revenue.
const SPLIT_MEMO_PREFIX = "split:";
const SPLIT_MIN_BPS = 100;   // 1%
const SPLIT_MAX_BPS = 5000;  // 50% (of the jar's proceeds, after the protocol fee)

// Split config (owner action): memo `cookie-crumbs:split:<jar>:<recipient>:<bps>[:label]`
// written by the jar owner, verified on-chain from the treasury's tx history the
// same way premium/goal config are read. Cost: a 0.001 COOK config tip.
const SPLIT_CONFIG_PREFIX = "cookie-crumbs:split:";
const SPLIT_CONFIG_TIP = 1_000_000; // 0.001 COOK — negligible, keeps the tx well-formed

const { Connection, PublicKey, SystemProgram, Transaction } = solanaWeb3;

const connection = new Connection(RPC_URL, { commitment: "confirmed" });

/* ---------- jar resolution: community jar vs personal tip pages ---------- */
/* ?jar=<base58> (or #jar=<base58>) turns this app into a shareable tip page
   for any address. Every page — community or personal — carries the same
   0.75% protocol fee; that split is the platform's revenue rail. */
function resolveJar() {
  const q = new URLSearchParams(location.search);
  let raw = (q.get("jar") || "").trim();
  if (!raw && location.hash.startsWith("#jar=")) raw = decodeURIComponent(location.hash.slice(5)).trim();
  if (!raw) return { address: COMMUNITY_JAR, personal: false };
  try {
    const pk = new PublicKey(raw);
    const addr = pk.toBase58();
    if (addr === FEE_PUBKEY_STR) return { address: COMMUNITY_JAR, personal: false }; // treasury is not a tip page
    return { address: addr, personal: true, onCurve: PublicKey.isOnCurve(pk.toBytes()) };
  } catch {
    return { address: COMMUNITY_JAR, personal: false, invalid: raw.slice(0, 44) };
  }
}
const JAR = resolveJar();
const jarPubkey = new PublicKey(JAR.address);

/* ---------- referral (via) resolution ---------- */
/* ?via=<base58> (or #via=) names a promoter who earns REFERRAL_SHARE_PCT of the
   protocol fee on every tip from this visit. Invalid/self-referential/treasury
   refs are ignored — referrals must never change the user's total cost. */
function resolveVia() {
  const q = new URLSearchParams(location.search);
  let raw = (q.get("via") || "").trim();
  if (!raw && location.hash.startsWith("#via=")) raw = decodeURIComponent(location.hash.slice(5)).trim();
  if (!raw) return null;
  try {
    const pk = new PublicKey(raw);
    const addr = pk.toBase58();
    if (addr === FEE_PUBKEY_STR) return null;      // treasury can't refer to itself
    if (addr === JAR.address) return null;         // jar owner gets tips, not fee share
    return addr;
  } catch {
    return null;
  }
}
const VIA = resolveVia();
const viaPubkey = VIA ? new PublicKey(VIA) : null;

/* ---------- social card override for personal tip pages ---------- */
/* Static OG tags (community jar) live in index.html. Crawlers that execute JS
   (X/Twitter fleet) get jar-specific previews for shared personal pages. */
(function socialCard() {
  try {
    if (!JAR.personal || !JAR.address) return;
    const short = JAR.address.slice(0, 4) + "…" + JAR.address.slice(-4);
    const u = new URL("https://aaron11998.github.io/cookie-crumbs/");
    u.searchParams.set("jar", JAR.address);
    const set = (sel, attr, val) => {
      const t = document.head.querySelector(sel);
      if (t) t.setAttribute(attr, val);
    };
    const title = `Tip ${short} on Cookie Chain 🍪`;
    const desc = "Cookie Crumbs tip page — send a COOK tip with a message, all on-chain, feed updates live. Powered by Cookie Crumbs.";
    set('meta[property="og:title"]', "content", title);
    set('meta[property="og:description"]', "content", desc);
    set('meta[property="og:url"]', "content", u.toString());
    set('meta[name="twitter:title"]', "content", title);
    set('meta[name="twitter:description"]', "content", desc);
    document.title = `${title} — Cookie Crumbs`;
  } catch (e) { console.warn("social card override skipped", e); }
})();

/* ---------- dom ---------- */
const $ = (id) => document.getElementById(id);
const el = {
  connectBtn: $("connect-btn"),
  netBadge: $("net-badge"),
  noWallet: $("no-wallet"),
  needFunds: $("need-funds"),
  bannerDismiss: $("banner-dismiss"),
  jarExplorer: $("jar-explorer"),
  statCount: $("stat-count"),
  statTotal: $("stat-total"),
  statTippers: $("stat-tippers"),
  stat24h: $("stat-24h"),
  statTreasury: $("stat-treasury"),
  treasuryLink: $("treasury-link"),
  chart: $("chart"),
  status: $("status"),
  form: $("tip-form"),
  amount: $("amount"),
  message: $("message"),
  submit: $("tip-submit"),
  feed: $("feed"),
  refresh: $("refresh-btn"),
  toasts: $("toasts"),
  repoLink: $("repo-link"),
};

el.repoLink.href = REPO_URL;
el.jarExplorer.href = `${EXPLORER}/address/${JAR.address}`;
el.jarExplorer.textContent = `${JAR.address.slice(0, 4)}…${JAR.address.slice(-4)}`;

/* ---------- personal tip-page personalization ---------- */
let jarIsPremium = false;
let jarOwner = null;

if (JAR.personal) {
  document.title = `Cookie Crumbs — tip this jar on Cookie Chain`;
  const hero = document.querySelector(".hero h1");
  const sub = document.querySelector(".hero-sub");
  if (hero) hero.innerHTML = `This jar takes <span class="accent">crumbs</span>.<br/>Tip it directly on-chain.`;
  if (sub) {
    sub.innerHTML = `You're viewing a <strong>personal tip page</strong> for <span class="mono">${shortAddr(JAR.address, 6)}</span> — ` +
      `<a href="${EXPLORER}/address/${JAR.address}" target="_blank" rel="noopener noreferrer">view on explorer</a>. ` +
      `Tips go straight to this address; a 0.75% protocol fee keeps Cookie Crumbs running. ` +
      `Anyone can make a page like this: append <code>?jar=<any address></code> to the app URL.`;
  }
  
  // Check for premium status on-chain (async, non-blocking)
  checkPremiumStatus().catch(e => console.warn("premium check failed", e));
} else if (JAR.invalid) {
  toast(`"?jar=${JAR.invalid}" is not a valid address — showing the community jar.`, "err", 8000);
}

/* ---------- referral note ---------- */
if (VIA) {
  const sub = document.querySelector(".hero-sub");
  if (sub) {
    const note = document.createElement("div");
    note.className = "fineprint";
    note.style.marginTop = "8px";
    note.innerHTML = `🔗 <strong>Referral visit</strong> — part of this page's protocol fee goes to <span class="mono">${shortAddr(VIA, 6)}</span> at no extra cost to you.`;
    sub.appendChild(note);
  }
}

/* ---------- state ---------- */
let wallet = null; // wallet-standard provider
let walletPubkey = null;
let lastKnownTip = localStorage.getItem("cc_last_tip") || "";

/* ---------- tiny utils ---------- */
function shortAddr(s, n = 4) {
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}
function fmtCook(lamports) {
  const v = lamports / LAMPORTS_PER_COOK;
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function timeAgo(unixSec) {
  const d = Date.now() / 1000 - unixSec;
  if (d < 60) return `${Math.max(1, Math.floor(d))}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function toast(msg, kind = "info", ms = 5000) {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  el.toasts.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function setStatus(html, kind) {
  el.status.className = `status ${kind}`;
  el.status.innerHTML = html;
}
function clearStatus() {
  el.status.className = "status hidden";
  el.status.innerHTML = "";
}
function setBusy(b) {
  el.submit.disabled = b;
  el.submit.textContent = b ? "working…" : "Send tip";
}

/* ---------- wallet (wallet-standard) ---------- */
function getWalletProviders() {
  const w = window;
  const out = [];
  const push = (p, name) => p && out.push({ provider: p, name });
  // Nightly: solana is an emitter proxy with providers.solana; also nightly.solana
  if (w.nightly && w.nightly.solana) push(w.nightly.solana, "Nightly");
  if (w.solana && w.solana.providers && w.solana.providers.solana) push(w.solana.providers.solana, w.solana.providers.solana.isNightly ? "Nightly" : "Injected");
  if (w.solana && (w.solana.isPhantom || w.solana.isSolflare || w.solana.isConnected !== undefined)) push(w.solana, w.solana.isPhantom ? "Phantom" : w.solana.isSolflare ? "Solflare" : "Injected");
  // Backpack / others register window.phantom.solana etc.
  if (w.phantom && w.phantom.solana) push(w.phantom.solana, "Backpack");
  return out;
}

function pickWallet() {
  const list = getWalletProviders();
  if (!list.length) return null;
  const nightly = list.find((w) => /nightly/i.test(w.name));
  return nightly || list[0];
}

async function connectWallet() {
  const pick = pickWallet();
  if (!pick) {
    el.noWallet.classList.remove("hidden");
    toast("No Solana-standard wallet found — install Nightly and switch it to Cookie Chain.", "err", 8000);
    return;
  }
  try {
    const resp = await pick.provider.connect();
    wallet = pick.provider;
    walletPubkey = new PublicKey(resp.publicKey || resp.publickey || resp.pubkey);
    const label = /nightly/i.test(pick.name) ? "Nightly" : pick.name;
    el.connectBtn.textContent = `${shortAddr(walletPubkey.toBase58())} (${label})`;
    el.connectBtn.title = "Click to disconnect";
    el.netBadge.classList.remove("hidden");
    el.noWallet.classList.add("hidden");
    renderShareRow(); // links now carry the sharer's own ?via=
    await checkBalance();
    toast(`Connected via ${label}`, "ok");
  } catch (e) {
    console.warn("connect failed", e);
    toast(`Wallet connect failed: ${humanError(e)}`, "err", 8000);
  }
}

function disconnectWallet() {
  try { wallet && wallet.disconnect && wallet.disconnect(); } catch (_) {}
  wallet = null;
  walletPubkey = null;
  el.connectBtn.textContent = "Connect Wallet";
  el.connectBtn.title = "";
  el.needFunds.classList.add("hidden");
  clearStatus();
  renderShareRow(); // back to the page's own referral link
}

async function checkBalance() {
  try {
    const lamports = await connection.getBalance(walletPubkey, "confirmed");
    if (lamports < 20_000) {
      el.needFunds.classList.remove("hidden");
      return false;
    }
    el.needFunds.classList.add("hidden");
    return true;
  } catch (e) {
    console.warn("balance check failed", e);
    return true; // don't block on transient RPC errors
  }
}

/* ---------- tipping ---------- */
function humanError(e) {
  const m = (e && (e.message || e.toString())) || "unknown error";
  if (/User rejected|rejected the request|user denied/i.test(m)) return "you rejected the request in the wallet";
  if (/insufficient|0x1$/i.test(m)) return "insufficient COOK in wallet";
  if (/blockhash|block hash/i.test(m)) return "network hiccup (blockhash) — try again";
  if (/chain|cluster|network/i.test(m) && /switch|mismatch/i.test(m)) return "wallet is on the wrong network — switch Nightly to Cookie Chain";
  return m.length > 140 ? `${m.slice(0, 140)}…` : m;
}

function validateAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, err: "enter a positive amount" };
  if (n > 1_000_000) return { ok: false, err: "that's… a lot. enter a smaller amount" };
  const lamports = Math.round(n * LAMPORTS_PER_COOK);
  if (lamports < 1) return { ok: false, err: "amount too small" };
  return { ok: true, lamports };
}

async function sendTip() {
  if (!walletPubkey) {
    await connectWallet();
    if (!walletPubkey) return;
  }
  const amt = validateAmount(el.amount.value);
  if (!amt.ok) {
    setStatus(amt.err, "err");
    return;
  }
  setBusy(true);
  clearStatus();
  premiumEvent("tip:open", { jar: JAR.address, amount: amt.lamports });
  try {
    setStatus("building transaction…", "info");

    // Mechanism #11 — resolve any split BEFORE building, so the transaction
    // carries the recipient transfer and the memo in one atomic payment.
    let msg = el.message.value.trim().slice(0, 180);
    if (el.amount.value === "25" && msg && !msg.startsWith(SPONSOR_PREFIX)) msg = SPONSOR_PREFIX + msg;
    const split = await effectiveSplit(msg);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    // Protocol fee (0.75%) routes to the org treasury on every tip — recurring revenue.
    // A referral link's ?via= address earns a share of that fee at no cost to the tipper.
    // Premium embeds (verified 1 COOK/month host subscription) earn 50% of the fee
    // instead of 30% — the subscription IS the recurring income; tips still cost the
    // tipper exactly the same.
    const feeLamports = Math.floor((amt.lamports * PROTOCOL_FEE_BPS) / 10_000);
    const refSharePct = getReferralSharePct(premiumActive);
    const refLamports = viaPubkey ? Math.floor((feeLamports * refSharePct) / 100) : 0;
    const jarLamports = amt.lamports - feeLamports;
    // Split tips: the recipient's cut comes out of the jar's proceeds, so the
    // tipper's total cost and the protocol fee are both unchanged.
    const splitParts = split ? computeSplit(jarLamports, split.bps) : null;
    const tx = new Transaction({
      feePayer: walletPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: walletPubkey,
        toPubkey: jarPubkey,
        lamports: splitParts ? splitParts.jar : jarLamports,
      })
    );
    if (splitParts && splitParts.recipient > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: walletPubkey,
          toPubkey: new PublicKey(split.recipient),
          lamports: splitParts.recipient,
        })
      );
    }
    if (feeLamports > 0) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: walletPubkey,
          toPubkey: new PublicKey(FEE_PUBKEY_STR),
          lamports: feeLamports - refLamports,
        })
      );
      if (viaPubkey && refLamports > 0) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: walletPubkey,
            toPubkey: viaPubkey,
            lamports: refLamports,
          })
        );
      }
    }
    // On-chain tip message: SPL Memo (v2, deployed on Cookie Chain). One memo per
    // tip, indexed by explorers — the feed reads it back for everyone.
    // Sponsor flow: typing "sponsor:<name>" makes the memo self-marking so the
    // tx doubles as a banner rental without any second transaction.
    // (msg was resolved above so a split memo can be honoured in this same tx.)
    if (msg) {
      tx.add({
        programId: new PublicKey(MEMO_PROGRAM_ID_STR),
        keys: [{ pubkey: walletPubkey, isSigner: true, isWritable: false }],
        data: new TextEncoder().encode(msg),
      });
    }

    setStatus("waiting for signature — approve in your wallet…", "info");
    let signed;
    if (typeof wallet.signAndSendTransaction === "function") {
      const resp = await wallet.signAndSendTransaction(tx);
      signed = resp.signature || resp.sig || resp;
    } else if (typeof wallet.signTransaction === "function") {
      const stx = await wallet.signTransaction(tx);
      setStatus("broadcasting to Cookie Chain…", "info");
      signed = await connection.sendRawTransaction(stx.serialize(), { skipPreflight: false, maxRetries: 3 });
    } else {
      throw new Error("wallet cannot sign transactions");
    }

    setStatus(`confirming <span class="mono">${shortAddr(signed, 8)}</span> …`, "info");
    // confirmation with timeout + blockheight-based expiry handling
    const confirmed = await Promise.race([
      connection.confirmTransaction(
        { signature: signed, blockhash, lastValidBlockHeight },
        "confirmed"
      ),
      new Promise((_, rej) => setTimeout(() => rej(new Error("confirmation timed out after 60s — check the explorer")), CONFIRM_TIMEOUT_MS)),
    ]);
    if (confirmed && confirmed.value && confirmed.value.err) {
      throw new Error(`transaction failed on-chain: ${JSON.stringify(confirmed.value.err)}`);
    }

    setStatus(
      `🍪 crumb delivered! tx <a class="mono" href="${EXPLORER}/tx/${signed}" target="_blank" rel="noopener noreferrer">${signed}</a>` +
        (msg ? ` — your message is on-chain (memo).` : ``),
      "ok"
    );
    premiumEvent("tip:confirm", { jar: JAR.address, signature: signed });
    toast("Tip confirmed on Cookie Chain 🍪", "ok");
    lastKnownTip = el.amount.value;
    localStorage.setItem("cc_last_tip", el.amount.value);
    el.message.value = "";
    await refreshFeed();
  } catch (e) {
    console.warn("tip failed", e);
    premiumEvent("tip:error", { jar: JAR.address, error: String((e && e.message) || e).slice(0, 200) });
    setStatus(`❌ ${humanError(e)}`, "err");
    toast(`Tip failed: ${humanError(e)}`, "err", 8000);
  } finally {
    setBusy(false);
  }
}

/* ---------- feed + stats (all from RPC) ---------- */
let feedCache = [];

async function fetchTips() {
  const sigs = await connection.getSignaturesForAddress(jarPubkey, { limit: FEED_SCAN_LIMIT });
  const ok = sigs.filter((s) => !s.err);
  const rows = await Promise.all(
    ok.slice(0, FEED_SCAN_LIMIT).map(async (s) => {
      try {
        const tx = await connection.getTransaction(s.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.meta) return null;
        const idx = tx.transaction.message.accountKeys.findIndex((k) => k.toBase58() === JAR.address);
        if (idx === -1) return null;
        const pre = tx.meta.preBalances[idx] || 0;
        const post = tx.meta.postBalances[idx] || 0;
        const delta = post - pre;
        if (delta <= 0) return null; // jar -> someone (not a tip)
        // tipper = first required signer (they fund + sign the memo)
        const numReq = (tx.transaction.message.header && tx.transaction.message.header.numRequiredSignatures) || 1;
        const from = numReq > 0 && tx.transaction.message.accountKeys[0] ? tx.transaction.message.accountKeys[0].toBase58() : null;
        // referral: ?via address received its fee-share in this same tx
        let referral = null;
        if (viaPubkey) {
          for (let i = 0; i < tx.transaction.message.accountKeys.length; i++) {
            if (tx.transaction.message.accountKeys[i].toBase58() === VIA) {
              const gained = (tx.meta.postBalances[i] || 0) - (tx.meta.preBalances[i] || 0);
              if (gained > 0) { referral = VIA; break; }
            }
          }
        }
        // on-chain message: spl-memo instruction payload (utf-8)
        let message = null;
        for (const ins of tx.transaction.message.instructions) {
          if (ins.programId && ins.programId.toBase58 && ins.programId.toBase58() === MEMO_PROGRAM_ID_STR && ins.data) {
            if (typeof ins.data === "string") continue; // unexpected encoding — skip rather than garble
            try { message = new TextDecoder("utf-8").decode(ins.data) || null; } catch (_) { message = null; }
          }
        }
        return {
          sig: s.signature,
          lamports: delta,
          from,
          referral,
          message,
          blockTime: tx.blockTime || (s.blockTime || 0),
        };
      } catch (_) {
        return null;
      }
    })
  );
  return rows.filter(Boolean).sort((a, b) => {
    // boosts first (pay-for-prominence), then newest-first
    const ba = a.lamports >= BOOST_LAMPORTS ? 1 : 0;
    const bb = b.lamports >= BOOST_LAMPORTS ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return b.blockTime - a.blockTime;
  });
}

function renderFeed(rows) {
  if (!rows.length) {
    el.feed.innerHTML = `<div class="feed-empty">no crumbs yet — be the first to feed the jar 🍪</div>`;
    return;
  }
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const boostBadge = (lamports) =>
    lamports >= BOOST_LAMPORTS
      ? `<span class="crumb-boost" title="boosted tip — ≥ ${fmtCook(BOOST_LAMPORTS)} COOK, pinned to the top">🚀 BOOST</span>`
      : "";
  const renderRow = (r) => `
      <div class="crumbs${r.lamports >= BOOST_LAMPORTS ? " crumb-boosted" : ""}">
        <span class="crumb-emoji">🍪</span>
        <div class="crumb-line">
          <div class="crumb-top">
            <span>
              <a class="crumb-from mono" href="${EXPLORER}/address/${r.from || ""}" target="_blank" rel="noopener noreferrer">${shortAddr(r.from || "?")}</a>
              ${boostBadge(r.lamports)}
              ${r.referral ? `<span class="crumb-ref" title="referral fee share paid to ${r.referral}">🔗</span>` : ""}
              <span class="crumb-time">${timeAgo(r.blockTime)}</span>
            </span>
            <span class="crumb-amount">+${fmtCook(r.lamports)} COOK</span>
          </div>
          ${r.message ? `<div class="crumb-msg">${esc(String(r.message).slice(0, 180))}</div>` : ""}
        </div>
      </div>`;
  const boosts = rows.filter((r) => r.lamports >= BOOST_LAMPORTS);
  const rest = rows.filter((r) => r.lamports < BOOST_LAMPORTS);
  el.feed.innerHTML = [...boosts, ...rest].map(renderRow).join("");
}

function renderStats(rows) {
  const total = rows.reduce((a, r) => a + r.lamports, 0);
  const tippers = new Set(rows.map((r) => r.from).filter(Boolean)).size;
  const dayAgo = Date.now() / 1000 - 86400;
  const last24 = rows.filter((r) => r.blockTime >= dayAgo);
  const total24 = last24.reduce((a, r) => a + r.lamports, 0);
  el.statCount.textContent = String(rows.length);
  el.statTotal.textContent = fmtCook(total);
  el.statTippers.textContent = String(tippers);
  el.stat24h.textContent = fmtCook(total24);
  drawChart(last24);
}

function drawChart(rows) {
  const c = el.chart;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 400;
  const h = 120;
  c.width = w * dpr;
  c.height = h * dpr;
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // 24 buckets
  const now = Math.floor(Date.now() / 1000);
  const buckets = new Array(24).fill(0);
  for (const r of rows) {
    const bh = Math.floor((now - r.blockTime) / 3600);
    if (bh >= 0 && bh < 24) buckets[23 - bh] += r.lamports / LAMPORTS_PER_COOK;
  }
  const max = Math.max(...buckets, 0.0001);
  const bw = w / 24;
  for (let i = 0; i < 24; i++) {
    const bh = (buckets[i] / max) * (h - 26);
    const x = i * bw + bw * 0.18;
    const bwr = bw * 0.64;
    if (buckets[i] > 0) {
      const grad = ctx.createLinearGradient(0, h - bh - 14, 0, h - 14);
      grad.addColorStop(0, "#ffb347");
      grad.addColorStop(1, "#ff8c42");
      ctx.fillStyle = grad;
      const r = 3;
      const y = h - 14 - bh;
      ctx.beginPath();
      ctx.moveTo(x, h - 14);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.lineTo(x + bwr - r, y);
      ctx.arcTo(x + bwr, y, x + bwr, y + r, r);
      ctx.lineTo(x + bwr, h - 14);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = "#857355";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillText("24h ago", 0, h - 2);
  ctx.textAlign = "right";
  ctx.fillText("now", w, h - 2);
  ctx.textAlign = "left";
}

el.treasuryLink.href = `${EXPLORER}/address/${FEE_PUBKEY_STR}`;
el.treasuryLink.title = `Protocol treasury ${shortAddr(FEE_PUBKEY_STR)} — ${(PROTOCOL_FEE_BPS / 100).toFixed(2)}% of every tip lands here, on-chain`;

/* ---------- protocol treasury readout (live, from RPC) ---------- */
/* Transparency rail: the fee is the business model, so its balance is public.
   getBalance on the treasury — cheap, keyless, honest. */
async function fetchTreasury() {
  try {
    const bal = await connection.getBalance(new PublicKey(FEE_PUBKEY_STR));
    el.statTreasury.textContent = fmtCook(bal);
    el.statTreasury.title = `${bal.toLocaleString()} lamports`;
  } catch (_) {
    el.statTreasury.textContent = "–"; // transient RPC errors must not break the page
  }
}

/* ---------- Premium upgrade (monetization mechanism #7) ---------- */
/* One-time 100 COOK fee paid to protocol treasury; verified on-chain via SPL Memo.
   Upgraded jars get: custom hero, custom colors, custom CTA, analytics dashboard, no "powered by" badge. */

async function checkPremiumStatus() {
  if (!JAR.personal) return;
  
  try {
    // Fetch signatures for the treasury looking for premium upgrade memos
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(FEE_PUBKEY_STR),
      { limit: 100 }
    );
    
    for (const s of sigs) {
      const tx = await connection.getTransaction(s.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta) continue;
      
      // Check for memo with premium upgrade for this jar
      for (const ins of tx.transaction.message.instructions) {
        if (ins.programId && ins.programId.toBase58 && ins.programId.toBase58() === MEMO_PROGRAM_ID_STR && ins.data) {
          try {
            const memo = new TextDecoder("utf-8").decode(ins.data);
            if (memo.startsWith(PREMIUM_MEMO_PREFIX)) {
              const parts = memo.split(":");
              // cookie-crumbs:premium:upgrade:<jar_address>
              // cookie-crumbs:premium:customize:<jar_address>:<json_config>
              if (parts.length >= 4 && parts[2] === PREMIUM_MEMO_UPGRADE && parts[3] === JAR.address) {
                jarIsPremium = true;
                jarOwner = tx.transaction.message.accountKeys[0].toBase58();
                applyPremiumUI();
                break;
              }
            }
          } catch (_) {}
        }
      }
      if (jarIsPremium) break;
    }
  } catch (e) {
    console.warn("premium status check error", e);
  }
}

function applyPremiumUI() {
  // Remove "powered by" badge
  const poweredBy = document.querySelector(".fineprint:has(a[href*='github'])");
  if (poweredBy) poweredBy.style.display = "none";
  
  // Custom hero styling
  const hero = document.querySelector(".hero h1");
  if (hero) {
    hero.style.background = "linear-gradient(135deg, #ffd700, #ff8c42, #ffd700)";
    hero.style.backgroundSize = "200% 200%";
    hero.style.webkitBackgroundClip = "text";
    hero.style.webkitTextFillColor = "transparent";
    hero.style.animation = "shimmer 3s linear infinite";
  }
  
  // Add premium badge
  const jarHead = document.querySelector(".jar-head");
  if (jarHead && !jarHead.querySelector(".premium-badge")) {
    const badge = document.createElement("span");
    badge.className = "premium-badge";
    badge.style.cssText = "margin-left:8px;padding:2px 8px;background:linear-gradient(135deg,#ffd700,#ff8c42);color:#2b1608;border-radius:999px;font:600 11px system-ui;animation:pulse 2s infinite";
    badge.textContent = "✨ PREMIUM";
    jarHead.appendChild(badge);
  }
  
  // Add custom CTA in the tip form
  const form = document.getElementById("tip-form");
  if (form && !form.querySelector(".premium-cta")) {
    const cta = document.createElement("p");
    cta.className = "fineprint premium-cta";
    cta.style.cssText = "color:#ffd700;text-align:center;margin-top:12px";
    cta.innerHTML = `🎨 This jar is <strong>Premium</strong> — custom branding & analytics enabled. <a href="#" id="customize-link">Customize yours →</a>`;
    form.appendChild(cta);
    
    const customizeLink = document.getElementById("customize-link");
    if (customizeLink) {
      customizeLink.onclick = (e) => {
        e.preventDefault();
        if (walletPubkey && walletPubkey.toBase58() === jarOwner) {
          openCustomizeModal();
        } else {
          toast("Only the jar owner can customize.", "err");
        }
      };
    }
  }
  
  // Add CSS animations
  if (!document.getElementById("premium-css")) {
    const style = document.createElement("style");
    style.id = "premium-css";
    style.textContent = `
      @keyframes shimmer { 0% {background-position: 0% 50%;} 50% {background-position: 100% 50%;} 100% {background-position: 0% 50%;} }
      @keyframes pulse { 0% {box-shadow: 0 0 0 0 rgba(255,215,0,0.4);} 70% {box-shadow: 0 0 0 10px rgba(255,215,0,0);} 100% {box-shadow: 0 0 0 0 rgba(255,215,0,0);} }
    `;
    document.head.appendChild(style);
  }
}

async function sendUpgrade() {
  if (!walletPubkey) {
    await connectWallet();
    if (!walletPubkey) return;
  }
  
  if (!JAR.personal) {
    toast("Premium upgrades are only for personal tip pages.", "err");
    return;
  }
  
  if (walletPubkey.toBase58() !== jarOwner && jarIsPremium) {
    toast("Only the jar owner can upgrade.", "err");
    return;
  }
  
  setBusy(true);
  clearStatus();
  
  try {
    setStatus("building upgrade transaction…", "info");
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    
    // Premium upgrade fee goes to protocol treasury
    const feeLamports = PREMIUM_UPGRADE_FEE;
    const memo = `${PREMIUM_MEMO_PREFIX}${PREMIUM_MEMO_UPGRADE}:${JAR.address}`;
    
    const tx = new Transaction({
      feePayer: walletPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: walletPubkey,
        toPubkey: new PublicKey(FEE_PUBKEY_STR),
        lamports: feeLamports,
      })
    ).add({
      programId: new PublicKey(MEMO_PROGRAM_ID_STR),
      keys: [{ pubkey: walletPubkey, isSigner: true, isWritable: false }],
      data: new TextEncoder().encode(memo),
    });
    
    setStatus("waiting for signature — approve in your wallet…", "info");
    let signed;
    if (typeof wallet.signAndSendTransaction === "function") {
      const resp = await wallet.signAndSendTransaction(tx);
      signed = resp.signature || resp.sig || resp;
    } else if (typeof wallet.signTransaction === "function") {
      const stx = await wallet.signTransaction(tx);
      setStatus("broadcasting to Cookie Chain…", "info");
      signed = await connection.sendRawTransaction(stx.serialize(), { skipPreflight: false, maxRetries: 3 });
    } else {
      throw new Error("wallet cannot sign transactions");
    }
    
    setStatus(`confirming <span class="mono">${shortAddr(signed, 8)}</span> …`, "info");
    const confirmed = await Promise.race([
      connection.confirmTransaction(
        { signature: signed, blockhash, lastValidBlockHeight },
        "confirmed"
      ),
      new Promise((_, rej) => setTimeout(() => rej(new Error("confirmation timed out after 60s — check the explorer")), CONFIRM_TIMEOUT_MS)),
    ]);
    
    if (confirmed && confirmed.value && confirmed.value.err) {
      throw new Error(`transaction failed on-chain: ${JSON.stringify(confirmed.value.err)}`);
    }
    
    jarIsPremium = true;
    jarOwner = walletPubkey.toBase58();
    applyPremiumUI();
    
    setStatus(
      `✨ Premium unlocked! tx <a class="mono" href="${EXPLORER}/tx/${signed}" target="_blank" rel="noopener noreferrer">${signed}</a>`,
      "ok"
    );
    toast("🎉 Jar upgraded to Premium! Custom branding active.", "ok");
    
  } catch (e) {
    console.warn("upgrade failed", e);
    setStatus(`❌ ${humanError(e)}`, "err");
    toast(`Upgrade failed: ${humanError(e)}`, "err", 8000);
  } finally {
    setBusy(false);
  }
}

function openCustomizeModal() {
  // Simple modal for premium customization
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.8);
    display: flex; align-items: center; justify-content: center; padding: 20px;
  `;
  modal.innerHTML = `
    <div style="background: #1a1a1a; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; color: #fff; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
      <h2 style="margin: 0 0 24px; font: 700 24px system-ui;">Customize Premium Jar</h2>
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div>
          <label style="display:block;font:500 13px system-ui;margin-bottom:8px;color:#ccc">Hero Title</label>
          <input id="premium-hero" type="text" value="This jar takes crumbs. Tip it directly on-chain." style="width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font:14px system-ui;box-sizing:border-box" />
        </div>
        <div>
          <label style="display:block;font:500 13px system-ui;margin-bottom:8px;color:#ccc">Hero Subtitle</label>
          <textarea id="premium-sub" rows="3" style="width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font:14px system-ui;box-sizing:border-box;resize:vertical">You're viewing a personal tip page for ${shortAddr(JAR.address, 6)} — tips go straight to this address; a 0.75% protocol fee keeps Cookie Crumbs running.</textarea>
        </div>
        <div>
          <label style="display:block;font:500 13px system-ui;margin-bottom:8px;color:#ccc">CTA Text (button label)</label>
          <input id="premium-cta" type="text" value="Send a crumb 🍪" style="width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0d0d0d;color:#fff;font:14px system-ui;box-sizing:border-box" />
        </div>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <button id="premium-save" style="flex:1;padding:14px;border-radius:8px;border:0;background:linear-gradient(135deg,#ffb347,#ff8a3d);color:#2b1608;font:600 15px system-ui;cursor:pointer">Save Customization</button>
          <button id="premium-cancel" style="flex:1;padding:14px;border-radius:8px;border:1px solid #333;background:transparent;color:#ccc;font:600 15px system-ui;cursor:pointer">Cancel</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const close = () => modal.remove();
  document.getElementById("premium-cancel").onclick = close;
  document.getElementById("premium-save").onclick = async () => {
    const hero = document.getElementById("premium-hero").value.trim().slice(0, 120);
    const sub = document.getElementById("premium-sub").value.trim().slice(0, 300);
    const cta = document.getElementById("premium-cta").value.trim().slice(0, 40);
    
    if (!walletPubkey || walletPubkey.toBase58() !== jarOwner) {
      toast("Only the jar owner can customize.", "err");
      return;
    }
    
    modal.querySelectorAll("button").forEach(b => b.disabled = true);
    
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      
      const config = JSON.stringify({ hero, sub, cta });
      const memo = `${PREMIUM_MEMO_PREFIX}${PREMIUM_MEMO_CUSTOMIZE}:${JAR.address}:${config}`;
      
      const tx = new Transaction({
        feePayer: walletPubkey,
        blockhash,
        lastValidBlockHeight,
      }).add({
        programId: new PublicKey(MEMO_PROGRAM_ID_STR),
        keys: [{ pubkey: walletPubkey, isSigner: true, isWritable: false }],
        data: new TextEncoder().encode(memo),
      });
      
      let signed;
      if (typeof wallet.signAndSendTransaction === "function") {
        const resp = await wallet.signAndSendTransaction(tx);
        signed = resp.signature || resp.sig || resp;
      } else if (typeof wallet.signTransaction === "function") {
        const stx = await wallet.signTransaction(tx);
        signed = await connection.sendRawTransaction(stx.serialize(), { skipPreflight: false, maxRetries: 3 });
      } else {
        throw new Error("wallet cannot sign transactions");
      }
      
      const confirmed = await Promise.race([
        connection.confirmTransaction({ signature: signed, blockhash, lastValidBlockHeight }, "confirmed"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("confirmation timed out")), CONFIRM_TIMEOUT_MS)),
      ]);
      
      if (confirmed && confirmed.value && confirmed.value.err) {
        throw new Error(`transaction failed: ${JSON.stringify(confirmed.value.err)}`);
      }
      
      // Apply customization locally immediately
      const h = document.querySelector(".hero h1");
      if (h) h.innerHTML = hero;
      const s = document.querySelector(".hero-sub");
      if (s) s.innerHTML = sub;
      const submitBtn = document.getElementById("tip-submit");
      if (submitBtn) submitBtn.textContent = cta;
      
      toast("Customization saved on-chain!", "ok");
      close();
    } catch (e) {
      console.warn("customize failed", e);
      toast(`Customize failed: ${humanError(e)}`, "err");
      modal.querySelectorAll("button").forEach(b => b.disabled = false);
    }
  };
  
  modal.onclick = (e) => { if (e.target === modal) close(); };
}

async function refreshFeed() {
  try {
    const rows = await fetchTips();
    feedCache = rows;
    renderFeed(rows);
    renderStats(rows);
    renderSponsorBanner(rows);
    renderGoal(rows); // tip-goal bar reads the same rows — one RPC pass for both
    fetchTreasury(); // fire-and-forget: feed latency must not gate the treasury tile
  } catch (e) {
    console.warn("feed refresh failed", e);
    el.feed.innerHTML = `<div class="feed-empty">couldn't load feed: ${humanError(e)}</div>`;
  }
}

/* ---------- tip goals (monetization mechanism #9) ---------- */
/* A jar page can carry a fundraising goal: progress bar + label, fed by the
   SAME tip rows the feed already computes. Setting a goal costs GOAL_FEE paid
   to the treasury with memo `cookie-crumbs:goal:<jar>:<goalLamports>[:label]`
   — the fee IS the goal-setting, verified 100% on-chain (no backend, no
   accounts). Newer goal memo wins, so updating a target costs another fee.
   Anyone may pay to set a goal on a personal page (fundraising-for-a-friend);
   griefing costs 2 COOK per try and the owner can override with a newer memo. */

/* Pure: parse `cookie-crumbs:goal:<jar>:<lamports>[:label]` -> {lamports,label}
   or null. The form strips ":" from labels so the format stays unambiguous;
   the parser still tolerates labels containing ":" by joining the remainder. */
function parseGoalMemo(memo, jarAddress) {
  if (typeof memo !== "string" || !memo.startsWith(GOAL_MEMO_PREFIX)) return null;
  const parts = memo.slice(GOAL_MEMO_PREFIX.length).split(":");
  if (parts[0] !== jarAddress) return null;
  const lamports = Number(parts[1]);
  if (!Number.isFinite(lamports) || !Number.isInteger(lamports) || lamports <= 0) return null;
  const label = parts[2] ? parts.slice(2).join(":").slice(0, 32) : "";
  return { lamports, label };
}

/* Pure: newest valid goal memo from feed rows. Rows are NOT strictly
   newest-first (boosted tips sort to the top), so "newest" is decided by
   blockTime — taking the first match would let an old goal override a new one. */
function findGoalMemos(rows, jarAddress) {
  let best = null;
  for (const r of rows || []) {
    const g = parseGoalMemo(r.message, jarAddress);
    if (!g) continue;
    const bt = typeof r.blockTime === "number" ? r.blockTime : 0;
    if (!best || bt >= best.blockTime) best = { ...g, blockTime: bt, sig: r.sig };
  }
  return best;
}

/* Pure: progress toward a goal. Clamps 0..100; >=100 is "hit". */
function computeGoalProgress(raisedLamports, goalLamports) {
  if (!Number.isFinite(raisedLamports) || !Number.isFinite(goalLamports) || goalLamports <= 0) {
    return { pct: 0, hit: false };
  }
  const pct = Math.max(0, Math.min(100, Math.floor((raisedLamports * 100) / goalLamports)));
  return { pct, hit: raisedLamports >= goalLamports };
}

/* ---------- tip splits (monetization mechanism #11) ---------- */
/* A shared tip jar with automatic revenue sharing, done with zero contracts.
   The tipper writes `split:<bps>:<recipient>` as the tip memo and the SAME
   transaction pays the recipient bps/10000 of the jar's proceeds. The jar owner
   can register a default split once (`cookie-crumbs:split:<jar>:<recipient>:<bps>`)
   and every future tipper inherits it by leaving a normal message. */

/* Pure: validate a split memo -> {bps,recipient} or null. Guards the two ways
   this could go wrong: pointing the split at the jar itself (meaningless) or at
   the protocol treasury (would double-count fee revenue). */
function parseSplitMemo(memo, jarAddress) {
  if (typeof memo !== "string" || !memo.startsWith(SPLIT_MEMO_PREFIX)) return null;
  const parts = memo.slice(SPLIT_MEMO_PREFIX.length).split(":");
  const bps = Number(parts[0]);
  const raw = (parts[1] || "").trim();
  if (!Number.isInteger(bps) || bps < SPLIT_MIN_BPS || bps > SPLIT_MAX_BPS) return null;
  try {
    const recipient = new PublicKey(raw).toBase58();
    if (recipient === jarAddress) return null;        // split to the jar is a no-op
    if (recipient === FEE_PUBKEY_STR) return null;    // treasury already takes the fee
    return { bps, recipient };
  } catch (_) {
    return null;
  }
}

/* Pure: how a tip's jar-side proceeds divide between jar and split recipient.
   Never changes what the tipper pays — only where the jar's cut lands. */
function computeSplit(jarLamports, bps) {
  if (!Number.isFinite(jarLamports) || jarLamports <= 0) return { jar: 0, recipient: 0 };
  const recipient = Math.floor((jarLamports * bps) / 10_000);
  return { jar: jarLamports - recipient, recipient };
}

/* Pure: parse an owner-registered default split
   `cookie-crumbs:split:<jar>:<recipient>:<bps>[:label]`. */
function parseSplitConfigMemo(memo, jarAddress) {
  if (typeof memo !== "string" || !memo.startsWith(SPLIT_CONFIG_PREFIX)) return null;
  const parts = memo.slice(SPLIT_CONFIG_PREFIX.length).split(":");
  if (parts[0] !== jarAddress) return null;
  const raw = (parts[1] || "").trim();
  const bps = Number(parts[2]);
  if (!Number.isInteger(bps) || bps < SPLIT_MIN_BPS || bps > SPLIT_MAX_BPS) return null;
  try {
    const recipient = new PublicKey(raw).toBase58();
    if (recipient === jarAddress || recipient === FEE_PUBKEY_STR) return null;
    return { bps, recipient, label: parts[3] ? parts.slice(3).join(":").slice(0, 32) : "" };
  } catch (_) {
    return null;
  }
}

/* Pure: the split a page should advertise — an explicit per-tip memo wins over
   the owner's registered default. */
function resolveSplit(message, defaultSplit, jarAddress) {
  return parseSplitMemo(message, jarAddress) || defaultSplit || null;
}

/* Effective split for one tip: memo split > owner-registered default. */
async function effectiveSplit(message) {
  return parseSplitMemo(message, JAR.address) || jarDefaultSplit;
}

/* Resolve the owner-registered default split for this jar (runs on page load,
   reads the treasury history like the premium check does). Fail-open to null. */
let jarDefaultSplit = null;
async function loadDefaultSplit() {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(FEE_PUBKEY_STR),
      { limit: 100 }
    );
    for (const s of sigs) {
      const tx = await connection.getTransaction(s.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta) continue;
      for (const ins of tx.transaction.message.instructions) {
        if (!ins.programId || !ins.programId.toBase58 || ins.programId.toBase58() !== MEMO_PROGRAM_ID_STR || !ins.data) continue;
        try {
          const cfg = parseSplitConfigMemo(new TextDecoder("utf-8").decode(ins.data), JAR.address);
          if (cfg) {
            jarDefaultSplit = { ...cfg, owner: tx.transaction.message.accountKeys[0].toBase58(), sig: s.signature, blockTime: tx.blockTime || 0 };
            renderSplitConfig();
            return;
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.warn("default split lookup skipped", e); // fail-open: tipping never blocked
  }
}

/* Owner action: register the default split on-chain. A 0.001 COOK tip to the
   treasury carries the config memo, so the record lives in the tx history the
   same way premium upgrades and goals do. */
async function sendSplitConfigTx(recipient, bps) {
  if (!walletPubkey) {
    await connectWallet();
    if (!walletPubkey) return false;
  }
  if (!JAR.personal) {
    toast("A default split needs your own tip page — make one first.", "err");
    return false;
  }
  if (jarDefaultSplit && walletPubkey.toBase58() !== jarDefaultSplit.owner) {
    toast("Only the jar that registered this split can change it.", "err");
    return false;
  }
  setBusy(true);
  clearStatus();
  try {
    setStatus("building split config…", "info");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const memo = `${SPLIT_CONFIG_PREFIX}${JAR.address}:${recipient}:${bps}`;
    const tx = new Transaction({ feePayer: walletPubkey, blockhash, lastValidBlockHeight })
      .add(
        SystemProgram.transfer({
          fromPubkey: walletPubkey,
          toPubkey: new PublicKey(FEE_PUBKEY_STR),
          lamports: SPLIT_CONFIG_TIP,
        })
      )
      .add({
        programId: new PublicKey(MEMO_PROGRAM_ID_STR),
        keys: [{ pubkey: walletPubkey, isSigner: true, isWritable: false }],
        data: new TextEncoder().encode(memo),
      });
    setStatus("waiting for signature — approve in your wallet…", "info");
    let signed;
    if (typeof wallet.signAndSendTransaction === "function") {
      const resp = await wallet.signAndSendTransaction(tx);
      signed = resp.signature || resp.sig || resp;
    } else if (typeof wallet.signTransaction === "function") {
      const stx = await wallet.signTransaction(tx);
      setStatus("broadcasting to Cookie Chain…", "info");
      signed = await connection.sendRawTransaction(stx.serialize(), { skipPreflight: false, maxRetries: 3 });
    } else {
      throw new Error("wallet cannot sign transactions");
    }
    setStatus(`confirming <span class="mono">${shortAddr(signed, 8)}</span> …`, "info");
    const confirmed = await Promise.race([
      connection.confirmTransaction({ signature: signed, blockhash, lastValidBlockHeight }, "confirmed"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("confirmation timed out after 60s — check the explorer")), CONFIRM_TIMEOUT_MS)),
    ]);
    if (confirmed && confirmed.value && confirmed.value.err) {
      throw new Error(`transaction failed on-chain: ${JSON.stringify(confirmed.value.err)}`);
    }
    jarDefaultSplit = { bps, recipient, label: "", owner: walletPubkey.toBase58(), sig: signed, blockTime: Math.floor(Date.now() / 1000) };
    renderSplitConfig();
    setStatus(`✅ default split registered — <span class="mono">${(bps / 100).toFixed(0)}%</span> of every tip now routes to <span class="mono">${shortAddr(recipient, 6)}</span>`, "ok");
    toast("Revenue split live on-chain 🍪", "ok");
    await refreshFeed();
    return true;
  } catch (e) {
    console.warn("split config failed", e);
    setStatus(`❌ ${humanError(e)}`, "err");
    toast(`Split config failed: ${humanError(e)}`, "err", 8000);
    return false;
  } finally {
    setBusy(false);
  }
}

/* What the page tells tippers about the active split. Disclosure, not config:
   it stays visible in the embed widget too — a tipper should always be able to
   see where their tip goes before they sign. */
function renderSplitConfig() {
  const note = document.getElementById("split-note");
  if (!note) return;
  if (!jarDefaultSplit) {
    note.classList.add("hidden");
    note.textContent = "";
    return;
  }
  note.textContent = `💸 ${(jarDefaultSplit.bps / 100).toFixed(0)}% of every tip routes to ${shortAddr(jarDefaultSplit.recipient, 6)} — verifiable on-chain`;
  note.classList.remove("hidden");
}

function updateSplitSection() {
  const set = document.getElementById("split-set-section");
  if (!set) return;
  const inEmbed = document.documentElement.classList.contains("cc-embed");
  const isOwner = walletPubkey && (!jarDefaultSplit || walletPubkey.toBase58() === jarDefaultSplit.owner);
  if (JAR.personal && walletPubkey && isOwner && !inEmbed) set.classList.remove("hidden");
  else set.classList.add("hidden");
}

(function initSplitForm() {
  const btn = document.getElementById("split-set-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const addrEl = document.getElementById("split-addr-input");
    const bpsEl = document.getElementById("split-bps-input");
    let recipient;
    try { recipient = new PublicKey((addrEl.value || "").trim()).toBase58(); }
    catch { toast("That's not a valid base58 recipient address.", "err"); return; }
    if (recipient === JAR.address) { toast("Pick an address other than the jar itself.", "err"); return; }
    if (recipient === FEE_PUBKEY_STR) { toast("The treasury already takes the protocol fee.", "err"); return; }
    const pct = Number(bpsEl.value);
    if (!Number.isFinite(pct) || pct < SPLIT_MIN_BPS / 100 || pct > SPLIT_MAX_BPS / 100) {
      toast(`Enter a share between ${SPLIT_MIN_BPS / 100}% and ${SPLIT_MAX_BPS / 100}%.`, "err");
      return;
    }
    await sendSplitConfigTx(recipient, Math.round(pct * 100));
  });
})();

async function sendGoalTx(goalLamports, goalLabel) {
  if (!walletPubkey) {
    await connectWallet();
    if (!walletPubkey) return false;
  }
  if (!JAR.personal) {
    toast("Tip goals are only for personal tip pages — make your own first.", "err");
    return false;
  }
  if (jarIsPremium && walletPubkey.toBase58() !== jarOwner) {
    toast("This jar's owner must set its goal.", "err");
    return false;
  }
  setBusy(true);
  clearStatus();
  try {
    setStatus("building goal transaction…", "info");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const memo = `${GOAL_MEMO_PREFIX}${JAR.address}:${goalLamports}${goalLabel ? ":" + goalLabel : ""}`;
    const tx = new Transaction({ feePayer: walletPubkey, blockhash, lastValidBlockHeight })
      .add(
        SystemProgram.transfer({
          fromPubkey: walletPubkey,
          toPubkey: new PublicKey(FEE_PUBKEY_STR),
          lamports: GOAL_FEE,
        })
      )
      .add({
        programId: new PublicKey(MEMO_PROGRAM_ID_STR),
        keys: [{ pubkey: walletPubkey, isSigner: true, isWritable: false }],
        data: new TextEncoder().encode(memo),
      });
    setStatus("waiting for signature — approve in your wallet…", "info");
    let signed;
    if (typeof wallet.signAndSendTransaction === "function") {
      const resp = await wallet.signAndSendTransaction(tx);
      signed = resp.signature || resp.sig || resp;
    } else if (typeof wallet.signTransaction === "function") {
      const stx = await wallet.signTransaction(tx);
      setStatus("broadcasting to Cookie Chain…", "info");
      signed = await connection.sendRawTransaction(stx.serialize(), { skipPreflight: false, maxRetries: 3 });
    } else {
      throw new Error("wallet cannot sign transactions");
    }
    setStatus(`confirming <span class="mono">${shortAddr(signed, 8)}</span> …`, "info");
    const confirmed = await Promise.race([
      connection.confirmTransaction({ signature: signed, blockhash, lastValidBlockHeight }, "confirmed"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("confirmation timed out after 60s — check the explorer")), CONFIRM_TIMEOUT_MS)),
    ]);
    if (confirmed && confirmed.value && confirmed.value.err) {
      throw new Error(`transaction failed on-chain: ${JSON.stringify(confirmed.value.err)}`);
    }
    setStatus(
      `🎯 goal set! tx <a class="mono" href="${EXPLORER}/tx/${signed}" target="_blank" rel="noopener noreferrer">${signed}</a>`,
      "ok"
    );
    toast("Goal is live — every tip now moves the bar 🎯", "ok");
    await refreshFeed();
    return true;
  } catch (e) {
    console.warn("goal set failed", e);
    setStatus(`❌ ${humanError(e)}`, "err");
    toast(`Goal failed: ${humanError(e)}`, "err", 8000);
    return false;
  } finally {
    setBusy(false);
  }
}

/* Pure: lamports raised since a goal was set. Only tips at or after the goal's
   own tx count — without this, a goal set later would credit every tip that came
   before it (the goal tx itself is a treasury payment, so it never inflates). */
function sumTipsSince(rows, sinceBlockTime) {
  return (rows || []).reduce(
    (a, r) => (r && typeof r.blockTime === "number" && r.blockTime >= sinceBlockTime ? a + (r.lamports || 0) : a),
    0
  );
}

function renderGoal(rows) {
  const section = document.getElementById("goal-section");
  if (!section) return;
  const goal = findGoalMemos(rows, JAR.address);
  if (!goal) {
    section.classList.add("hidden");
    return;
  }
  // The goal ledger must total every tip since the goal was set, not just the
  // rows the feed renders — hence the wider scan in fetchTips (FEED_SCAN_LIMIT).
  const raised = sumTipsSince(rows, goal.blockTime); // memo txs move 0 to the jar
  const { pct, hit } = computeGoalProgress(raised, goal.lamports);
  const label = document.getElementById("goal-label");
  const amounts = document.getElementById("goal-amounts");
  const fill = document.getElementById("goal-fill");
  const status = document.getElementById("goal-status");
  const bar = section.querySelector(".goal-bar");
  label.textContent = `🎯 ${goal.label || "Tip goal"}`;
  amounts.textContent = `${fmtCook(raised)} / ${fmtCook(goal.lamports)} COOK`;
  fill.style.width = `${pct}%`;
  bar.setAttribute("aria-valuenow", String(pct));
  const scannedOut = rows.length >= FEED_SCAN_LIMIT && rows[rows.length - 1].blockTime > goal.blockTime;
  const tail = scannedOut ? ` (totals cover the last ${FEED_SCAN_LIMIT} txs)` : "";
  status.textContent = (hit ? `goal hit — ${fmtCook(raised)} COOK raised 🎉` : `${pct}% there — share this page to move the bar`) + tail;
  section.classList.remove("hidden");
}

function updateGoalSection() {
  const set = document.getElementById("goal-set-section");
  if (!set) return;
  const inEmbed = document.documentElement.classList.contains("cc-embed");
  // Community jar: no goal (keep the landing page clean). Embed widget: the
  // host controls their page, so goal-setting stays on the hosted page only.
  if (JAR.personal && walletPubkey && !inEmbed) {
    set.classList.remove("hidden");
  } else {
    set.classList.add("hidden");
  }
}

(function initGoalForm() {
  const btn = document.getElementById("goal-set-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const amountEl = document.getElementById("goal-amount-input");
    const labelEl = document.getElementById("goal-label-input");
    const parsed = validateAmount(amountEl.value);
    // validateAmount returns { ok:false, err } on bad input — it never returns
    // null, and an unguarded property read threw a TypeError on empty input.
    if (!parsed || !parsed.ok || parsed.lamports <= 0) {
      toast("Enter a goal amount in COOK (e.g. 100).", "err");
      return;
    }
    const label = (labelEl.value || "").trim().replace(/:/g, " ").slice(0, 32);
    await sendGoalTx(parsed.lamports, label);
  });
})();

/* ---------- share this tip page (viral loop) ---------- */
/* Pure + testable: shareable URL for the current page, with the sharer's own
   ?via= attached when they're connected (they earn the fee share, the page's
   existing via — a promoter's link — is preserved for anonymous visitors). */
function buildShareUrl(current, jar, sharer) {
  const u = new URL(current);
  u.searchParams.set("jar", jar);
  u.searchParams.delete("via");
  u.hash = "";
  if (sharer && sharer !== jar) u.searchParams.set("via", sharer);
  return u.toString();
}
function renderShareRow() {
  const row = document.getElementById("share-row");
  if (!row) return;
  const url = buildShareUrl(location.href, JAR.address, walletPubkey ? walletPubkey.toBase58() : null);
  const text = JAR.personal
    ? "Tip this jar on Cookie Chain 🍪"
    : "Cookie Crumbs — the on-chain tip jar for Cookie Chain 🍪";
  const copyBtn = document.getElementById("share-copy");
  const x = document.getElementById("share-x");
  const tg = document.getElementById("share-tg");
  if (copyBtn) copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(walletPubkey ? "Referral link copied — you earn a fee share on every tip through it 🍪" : "Link copied — share it anywhere 🍪", "ok");
    } catch { toast(url, "info", 9000); }
  };
  if (x) x.href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text + "\n" + url);
  if (tg) tg.href = "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text);
}
renderShareRow();

/* ---------- embed this jar (widget distribution rail) ---------- */
/* Pure + testable: the <script> snippet a webmaster pastes to put a Tip button
   (and therefore the protocol's fee rail) on their own site. Personal pages get
   their own jar embedded; community page embeds the community jar.
   Premium features: data-wallet for subscription verification, data-premium,
   data-theme, data-analytics. */
function buildEmbedSnippet(jar, originBase) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const attrs = jar ? `\n  data-jar="${esc(jar)}"` : "";
  // Premium embed: host pastes their wallet — a 1 COOK/month on-chain payment
  // from that wallet to the treasury unlocks 50% referral share + analytics.
  const premiumAttrs = `\n  data-premium="true"\n  data-wallet="PASTE_HOST_WALLET_HERE"\n  data-theme="auto"\n  data-analytics="true"`;
  return `<script src="${esc(originBase)}embed.js"${attrs}${premiumAttrs}><\/script>`;
}
function renderEmbedCard() {
  const snippetEl = document.getElementById("embed-snippet");
  if (!snippetEl) return;
  const jar = JAR.personal ? JAR.address : null; // community jar = loader default
  snippetEl.textContent = buildEmbedSnippet(jar, "https://aaron11998.github.io/cookie-crumbs/");
  const copyBtn = document.getElementById("embed-copy");
  if (copyBtn) copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(snippetEl.textContent);
      toast("Embed snippet copied — the Tip 🍪 button now tips YOUR jar 🍪", "ok");
    } catch { toast(snippetEl.textContent, "info", 9000); }
  };
}
renderEmbedCard();

/* ---------- premium embed subscription ---------- */
/* Host sites pay 1 COOK/month to the treasury to unlock premium features:
   - 50% referral share (vs 30% standard) — every tip from their widget pays them more
   - analytics postMessage events (tip:open / tip:confirm / tip:error)
   Verification is fully on-chain: checkPremiumEmbed(hostWallet) scans recent
   payments to the treasury FROM THAT WALLET for one >= SUB_LAMPORTS within the
   last 30 days. Self-serve: the host pays with any wallet (a single SOL transfer
   in Phantom/Nightly), pastes its address into the snippet, done. The payment IS
   the subscription — no accounts, no backend. Recurring because verification
   expires every 30 days, so hosts who want the 50% share keep paying. Never
   grants premium based on payments from some OTHER wallet. */
const PREMIUM_CHECK_WINDOW_S = 30 * 86400;
async function checkPremiumEmbed(hostWalletStr) {
  if (!hostWalletStr) return false;
  let hostPk;
  try { hostPk = new PublicKey(hostWalletStr); } catch { return false; }
  try {
    const subPk = new PublicKey(FEE_PUBKEY_STR); // subscription payments land in the treasury
    const sigs = await connection.getSignaturesForAddress(subPk, { limit: 200 });
    const cutoff = Date.now() / 1000 - PREMIUM_CHECK_WINDOW_S;
    for (const s of sigs) {
      if (s.blockTime && s.blockTime < cutoff) break; // sigs are newest-first
      if (s.err) continue;
      const tx = await connection.getTransaction(s.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta) continue;
      const numReq = (tx.transaction.message.header && tx.transaction.message.header.numRequiredSignatures) || 1;
      const keys = tx.transaction.message.accountKeys.map((k) => k.toBase58());
      if (numReq < 1 || keys[0] !== hostPk.toBase58()) continue; // must come FROM the host wallet
      const idx = keys.indexOf(subPk.toBase58());
      if (idx === -1) continue;
      const gained = (tx.meta.postBalances[idx] || 0) - (tx.meta.preBalances[idx] || 0);
      if (gained >= SUB_LAMPORTS) return true;
    }
    return false;
  } catch (e) {
    console.warn("premium embed check failed", e);
    return false; // fail-closed: RPC trouble never fakes a subscription
  }
}

/* Get referral share % based on premium status */
function getReferralSharePct(isPremium) {
  return isPremium ? PREMIUM_REFERRAL_SHARE_PCT : REFERRAL_SHARE_PCT;
}

/* ---------- premium widget state ---------- */
/* ?embed=1&premium=1&host_wallet=<base58> (set by embed.js from the data-premium /
   data-wallet attrs) asks for premium. The verify result is cached for the
   widget page's lifetime; reloading the widget re-verifies (i.e. monthly). */
let premiumActive = false;
(async function initPremium() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("embed") !== "1" || q.get("premium") !== "1") return;
    const hostWallet = q.get("host_wallet");
    const ok = await checkPremiumEmbed(hostWallet);
    if (!ok) {
      console.info("[cookie-crumbs] premium requested but subscription not found for", hostWallet);
      return; // standard 30% share applies; fail-closed
    }
    premiumActive = true;
    console.info("[cookie-crumbs] premium embed active — 50% referral share for host");
  } catch (e) {
    console.warn("premium init skipped", e);
  }
})();

/* Premium analytics: verified premium embeds get tip events posted to the host
   page (host listens for window "message" events with data.type "cookie-crumbs:*").
   Only fires when premiumActive — free embeds get no analytics. */
function premiumEvent(type, detail) {
  if (!premiumActive) return;
  try {
    parent.postMessage({ type: "cookie-crumbs:" + type, detail: detail || null }, "*");
  } catch {}
}

/* ---------- sponsor slot (rented banner) ---------- */
/* Pure + testable. The community jar's tip history doubles as the sponsorship
   ledger: the newest tx of >= SPONSOR_LAMPORTS whose memo starts with
   "sponsor:" bought SPONSOR_HOURS of banner time starting at its blockTime.
   Expired slots are invisible — renewing is the recurring-revenue loop. */
function findActiveSponsor(rows, nowSec) {
  for (const r of rows) {
    if (r.lamports < SPONSOR_LAMPORTS) continue;
    const msg = typeof r.message === "string" ? r.message : "";
    if (!msg.startsWith(SPONSOR_PREFIX)) continue;
    const start = r.blockTime || 0;
    if (nowSec < start || nowSec >= start + SPONSOR_HOURS * 3600) continue;
    return { label: msg.slice(SPONSOR_PREFIX.length).trim().slice(0, 32), sig: r.sig, start, until: start + SPONSOR_HOURS * 3600 };
  }
  return null;
}
function renderSponsorBanner(rows) {
  const banner = document.getElementById("sponsor-banner");
  if (!banner) return;
  const slot = JAR.personal ? null : findActiveSponsor(rows, Math.floor(Date.now() / 1000));
  const label = document.getElementById("sponsor-banner-label");
  const link = document.getElementById("sponsor-banner-link");
  if (!slot) {
    banner.classList.add("hidden");
    if (label) label.textContent = "";
    if (link) { link.textContent = ""; link.removeAttribute("href"); }
    return;
  }
  const hrs = Math.max(1, Math.ceil((slot.until - Date.now() / 1000) / 3600));
  banner.classList.remove("hidden");
  if (label) label.textContent = slot.label || "anonymous sponsor";
  if (link) {
    link.textContent = `rented · ${hrs}h left`;
    link.href = `${EXPLORER}/tx/${slot.sig}`;
    link.title = "Sponsor slot is verifiable on-chain — this link opens the renting transaction";
  }
}

/* ---------- embed mode (?embed=1): the app renders as a widget ---------- */
/* Loaded inside the widget iframe by embed.js: chrome hidden via CSS, modal
   bits that are useless in an iframe (share row, own/embed cards, banners,
   "make your own" flows) stay hidden, closing is POSTmessaged to the host. */
if (new URLSearchParams(location.search).get("embed") === "1") {
  document.documentElement.classList.add("cc-embed");
  window.addEventListener("message", (e) => {
    if (e.origin !== "https://aaron11998.github.io") return;
    if (e.data === "cookie-crumbs-close") {
      try { window.close(); } catch {}
    }
  });
}

/* ---------- make-your-own tip page ---------- */
function validBase58Addr(s) {
  try { return new PublicKey(s.trim()).toBase58(); } catch { return null; }
}
const ownInput = document.getElementById("own-address");
const ownPreview = document.getElementById("own-preview");
if (ownInput && ownPreview) {
  ownInput.addEventListener("input", () => {
    const addr = validBase58Addr(ownInput.value);
    ownPreview.textContent = addr
      ? `${location.origin}${location.pathname}?jar=${addr}`
      : "";
  });
  document.getElementById("own-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const addr = validBase58Addr(ownInput.value);
    if (!addr) { toast("That's not a valid base58 address — paste a wallet address.", "err", 6000); return; }
    location.href = `${location.origin}${location.pathname}?jar=${addr}`;
  });
  const copyBtn = document.getElementById("own-copy");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    const u = new URL(`${location.origin}${location.pathname}`);
    if (JAR.personal) u.searchParams.set("jar", JAR.address);
    if (walletPubkey) u.searchParams.set("via", walletPubkey.toBase58()); // your referral link
    const url = u.toString();
    try {
      await navigator.clipboard.writeText(url);
      toast(walletPubkey ? "Referral link copied — you earn a fee share on every tip 🍪" : "Link copied — share it anywhere 🍪", "ok");
    } catch {
      toast(url, "info", 9000);
    }
  });
}

/* ---------- misc ---------- */
el.connectBtn.addEventListener("click", () => (walletPubkey ? disconnectWallet() : connectWallet()));
el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendTip();
});
el.refresh.addEventListener("click", refreshFeed);
document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    el.amount.value = chip.dataset.amt;
  })
);
window.addEventListener("resize", () => renderStats(feedCache));

/* Premium upgrade section visibility */
function updatePremiumSection() {
  const section = document.getElementById("premium-upgrade-section");
  if (!section) return;
  
  // Show for personal pages when wallet is connected AND not already premium
  if (JAR.personal && walletPubkey && !jarIsPremium) {
    section.classList.remove("hidden");
  } else {
    section.classList.add("hidden");
  }
}

// Override connectWallet to update premium + goal + split sections
const originalConnectWallet = connectWallet;
async function connectWallet() {
  await originalConnectWallet();
  updatePremiumSection();
  updateGoalSection();
  updateSplitSection();
}

// Override disconnectWallet to update premium + goal + split sections
const originalDisconnectWallet = disconnectWallet;
function disconnectWallet() {
  originalDisconnectWallet();
  updatePremiumSection();
  updateGoalSection();
  updateSplitSection();
}

// Override applyPremiumUI to hide upgrade section
const originalApplyPremiumUI = applyPremiumUI;
function applyPremiumUI() {
  originalApplyPremiumUI();
  updatePremiumSection();
}

el.bannerDismiss.addEventListener("click", () => el.noWallet.classList.add("hidden"));
el.connectBtn.addEventListener("click", () => (walletPubkey ? disconnectWallet() : connectWallet()));
el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendTip();
});
el.refresh.addEventListener("click", refreshFeed);
document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    el.amount.value = chip.dataset.amt;
  })
);
window.addEventListener("resize", () => renderStats(feedCache));

/* init */
(async function init() {
  try {
    const v = await connection.getVersion();
    console.log("cookie chain rpc version", v);
    el.netBadge.title = `cookie chain · ${JSON.stringify(v)}`;
  } catch (e) {
    console.warn("rpc unreachable", e);
    toast("Cookie Chain RPC unreachable — check your connection.", "err", 8000);
  }
  const provs = getWalletProviders();
  if (!provs.length) el.noWallet.classList.remove("hidden");
  else if (!window.solana || !window.solana.isNightly) {
    // keep banner only if nightly is truly missing and nothing else is present
    if (!provs.some((p) => /nightly/i.test(p.name))) {
      // other wallet exists; still show subtle hint
      el.noWallet.querySelector("div").innerHTML =
        "<strong>Nightly not detected.</strong> The bounty prefers Nightly — install it from <a href='https://nightly.app' target='_blank' rel='noopener noreferrer'>nightly.app</a> and switch to Cookie Chain. Other standard wallets will still work.";
    }
  }
  refreshFeed();
  setInterval(refreshFeed, 30_000); // keep the feed fresh
  // Owner-registered default revenue split (mechanism #11) — loaded once at boot
  // so tippers see it before the first tip. Fail-open: a miss just means no split.
  loadDefaultSplit().then(() => updateSplitSection()).catch(() => {});
})();
