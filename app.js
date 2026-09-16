/* Cookie Crumbs — tip jar cApp on Cookie Chain (SVM)
 * 100% client-side. Talks straight to the Cookie Chain RPC.
 * Wallet: any Solana wallet-standard injected wallet (Nightly supported).
 * Tips: plain system-program transfers, confirmed via polling.
 */
"use strict";

const RPC_URL = "https://rpc.cookiescan.io";
const EXPLORER = "https://cookiescan.io";
const JAR_PUBKEY_STR = "5E9GChFUkhz3UvpRhN4aftKGYdtYPNK9uX1SARAvUZe8";
const FEE_PUBKEY_STR = "7N1boz6k5iu6hVr6haCMPAkL8bF5WYEZbvbPgKM5h6Pu";
const PROTOCOL_FEE_BPS = 75; // 0.75% protocol fee on each tip -> org-owned wallet
const REPO_URL = "https://github.com/altaranexus-ship-it/cookie-crumbs";
const LAMPORTS_PER_COOK = 1_000_000_000;
const FEED_LIMIT = 25;
const CONFIRM_TIMEOUT_MS = 60_000;

const { Connection, PublicKey, SystemProgram, Transaction } = solanaWeb3;

const connection = new Connection(RPC_URL, { commitment: "confirmed" });
const jarPubkey = new PublicKey(JAR_PUBKEY_STR);

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
el.jarExplorer.href = `${EXPLORER}/address/${JAR_PUBKEY_STR}`;
el.jarExplorer.textContent = `${JAR_PUBKEY_STR.slice(0, 4)}…${JAR_PUBKEY_STR.slice(-4)}`;

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
  const msg = el.message.value.trim().slice(0, 180);
  setBusy(true);
  clearStatus();
  try {
    setStatus("building transaction…", "info");

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    // 0.75% protocol fee routes to the org's fee wallet on every tip — recurring revenue.
    const feeLamports = Math.floor((amt.lamports * PROTOCOL_FEE_BPS) / 10_000);
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
          lamports: feeLamports,
        })
      );
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
      `🍪 crumb delivered! tx <a class="mono" href="${EXPLORER}/tx/${signed}" target="_blank" rel="noopener noreferrer">${signed}</a>`,
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
        const idx = tx.transaction.message.accountKeys.findIndex((k) => k.toBase58() === JAR_PUBKEY_STR);
        if (idx === -1) return null;
        const pre = tx.meta.preBalances[idx] || 0;
        const post = tx.meta.postBalances[idx] || 0;
        const delta = post - pre;
        if (delta <= 0) return null; // jar -> someone (not a tip)
        // sender: the account whose balance dropped by delta (+ fee share); first non-jar account with drop >= delta
        let from = null;
        for (let i = 0; i < tx.transaction.message.accountKeys.length; i++) {
          if (i === idx) continue;
          const drop = (tx.meta.preBalances[i] || 0) - (tx.meta.postBalances[i] || 0);
          if (drop >= delta) { from = tx.transaction.message.accountKeys[i]; break; }
        }
        return {
          sig: s.signature,
          lamports: delta,
          from: from ? from.toBase58() : null,
          blockTime: tx.blockTime || (s.blockTime || 0),
        };
      } catch (_) {
        return null;
      }
    })
  );
  return rows.filter(Boolean).sort((a, b) => b.blockTime - a.blockTime);
}

function renderFeed(rows) {
  if (!rows.length) {
    el.feed.innerHTML = `<div class="feed-empty">no crumbs yet — be the first to feed the jar 🍪</div>`;
    return;
  }
  el.feed.innerHTML = rows
    .map(
      (r) => `
      <div class="crumbs">
        <span class="crumb-emoji">🍪</span>
        <div class="crumb-line">
          <div class="crumb-top">
            <span>
              <a class="crumb-from mono" href="${EXPLORER}/address/${r.from || ""}" target="_blank" rel="noopener noreferrer">${shortAddr(r.from || "?")}</a>
              <span class="crumb-time">${timeAgo(r.blockTime)}</span>
            </span>
            <span class="crumb-amount">+${fmtCook(r.lamports)} COOK</span>
          </div>
        </div>
      </div>`
    )
    .join("");
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

async function refreshFeed() {
  try {
    const rows = await fetchTips();
    feedCache = rows;
    renderFeed(rows);
    renderStats(rows);
  } catch (e) {
    console.warn("feed refresh failed", e);
    el.feed.innerHTML = `<div class="feed-empty">couldn't load feed: ${humanError(e)}</div>`;
  }
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
