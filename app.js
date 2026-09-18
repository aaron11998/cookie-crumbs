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
// Boosted tips: a tip >= BOOST_LAMPORTS is a "boost" — it renders pinned at the
// top of the feed with a badge. Pay-for-prominence: jar owners/promoters tip big
// to be seen first. Amount-based, so it is verifiable on-chain from the same
// balance-delta the feed already computes (no trusted backend needed).
const BOOST_LAMPORTS = 5_000_000_000; // 5 COOK
// SPL Memo v2 — verified deployed + executable on Cookie Chain (getAccountInfo,
// slot ~25.7M). Lets tip messages live ON-CHAIN instead of only in the browser.
const MEMO_PROGRAM_ID_STR = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const REPO_URL = "https://github.com/altaranexus-ship-it/cookie-crumbs";
const LAMPORTS_PER_COOK = 1_000_000_000;
const FEED_LIMIT = 25;
const CONFIRM_TIMEOUT_MS = 60_000;

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
    const u = new URL("https://altaranexus-ship-it.github.io/cookie-crumbs/");
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
if (JAR.personal) {
  document.title = `Cookie Crumbs — tip this jar on Cookie Chain`;
  const hero = document.querySelector(".hero h1");
  const sub = document.querySelector(".hero-sub");
  if (hero) hero.innerHTML = `This jar takes <span class="accent">crumbs</span>.<br/>Tip it directly on-chain.`;
  if (sub) {
    sub.innerHTML = `You're viewing a <strong>personal tip page</strong> for <span class="mono">${shortAddr(JAR.address, 6)}</span> — ` +
      `<a href="${EXPLORER}/address/${JAR.address}" target="_blank" rel="noopener noreferrer">view on explorer</a>. ` +
      `Tips go straight to this address; a 0.75% protocol fee keeps Cookie Crumbs running. ` +
      `Anyone can make a page like this: append <code>?jar=&lt;any address&gt;</code> to the app URL.`;
  }
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
  try {
    setStatus("building transaction…", "info");

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    // Protocol fee (0.75%) routes to the org treasury on every tip — recurring revenue.
    // A referral link's ?via= address earns a share of that fee at no cost to the tipper.
    const feeLamports = Math.floor((amt.lamports * PROTOCOL_FEE_BPS) / 10_000);
    const refLamports = viaPubkey ? Math.floor((feeLamports * REFERRAL_SHARE_PCT) / 100) : 0;
    const jarLamports = amt.lamports - feeLamports;
    const tx = new Transaction({
      feePayer: walletPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(
      SystemProgram.transfer({
        fromPubkey: walletPubkey,
        toPubkey: jarPubkey,
        lamports: jarLamports,
      })
    );
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
    const msg = el.message.value.trim().slice(0, 180);
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
    toast("Tip confirmed on Cookie Chain 🍪", "ok");
    lastKnownTip = el.amount.value;
    localStorage.setItem("cc_last_tip", el.amount.value);
    el.message.value = "";
    await refreshFeed();
  } catch (e) {
    console.warn("tip failed", e);
    setStatus(`❌ ${humanError(e)}`, "err");
    toast(`Tip failed: ${humanError(e)}`, "err", 8000);
  } finally {
    setBusy(false);
  }
}

/* ---------- feed + stats (all from RPC) ---------- */
let feedCache = [];

async function fetchTips() {
  const sigs = await connection.getSignaturesForAddress(jarPubkey, { limit: 50 });
  const ok = sigs.filter((s) => !s.err);
  const rows = await Promise.all(
    ok.slice(0, FEED_LIMIT).map(async (s) => {
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

async function refreshFeed() {
  try {
    const rows = await fetchTips();
    feedCache = rows;
    renderFeed(rows);
    renderStats(rows);
    fetchTreasury(); // fire-and-forget: feed latency must not gate the treasury tile
  } catch (e) {
    console.warn("feed refresh failed", e);
    el.feed.innerHTML = `<div class="feed-empty">couldn't load feed: ${humanError(e)}</div>`;
  }
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
})();
