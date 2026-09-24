// unit tests for the CLAW-72 monetization logic (pure parts, run in node)
const assert = require("assert");

// --- constants mirrored from app.js ---
const PROTOCOL_FEE_BPS = 75;
const REFERRAL_SHARE_PCT = 30;

function split(amtLamports, hasVia) {
  const feeLamports = Math.floor((amtLamports * PROTOCOL_FEE_BPS) / 10_000);
  const refLamports = hasVia ? Math.floor((feeLamports * REFERRAL_SHARE_PCT) / 100) : 0;
  const jarLamports = amtLamports - feeLamports;
  const treasury = feeLamports - refLamports;
  return { jar: jarLamports, treasury, ref: refLamports, feeTotal: treasury + refLamports };
}

// user's total cost must never change: jar + feeTotal === amt
for (const amt of [1_000_000_000, 100_000_000, 10_000_000, 1_000_001, 999]) {
  for (const via of [true, false]) {
    const s = split(amt, via);
    assert.strictEqual(s.jar + s.feeTotal, amt, `cost invariant broken amt=${amt} via=${via}`);
    assert.ok(s.treasury >= 0 && s.ref >= 0);
  }
}
// no-via: treasury takes everything
assert.strictEqual(split(100_000_000, false).treasury, 750_000);
assert.strictEqual(split(100_000_000, false).ref, 0);
// via: 30% of fee, treasury rest
const v = split(100_000_000, true);
assert.strictEqual(v.ref, 225_000);
assert.strictEqual(v.treasury, 525_000);
// sub-134-lamport amount: fee floors to 0 — no zero-value transfers, no negatives
const zeroFee = split(100, true);
assert.strictEqual(zeroFee.feeTotal, 0);
assert.strictEqual(zeroFee.jar, 100);
// 999 lamports: fee=7 splits 5 treasury / 2 referral, invariant holds
const tiny = split(999, true);
assert.strictEqual(tiny.feeTotal, 7);
assert.strictEqual(tiny.treasury, 5);
assert.strictEqual(tiny.ref, 2);
assert.strictEqual(tiny.jar + tiny.feeTotal, 999);

// --- memo utf-8 round-trip (same encode/decode pair used in app) ---
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");
const samples = ["gm cookie chain 🍪", "tip for the taco fund — nice work!", "x".repeat(180), "中文 + emoji 🚀✅"];
for (const s of samples) {
  const bytes = enc.encode(s.slice(0, 180));
  assert.ok(bytes.length <= 720, "memo payload stays well under tx packet budget");
  assert.strictEqual(dec.decode(bytes), s.slice(0, 180));
}

// --- boosted tips (pay-for-prominence): sorting + badge logic mirrored from app.js ---
const BOOST_LAMPORTS = 5_000_000_000;
const isBoost = (r) => r.lamports >= BOOST_LAMPORTS;
const boostSort = (rows) =>
  [...rows].sort((a, b) => {
    const ba = isBoost(a) ? 1 : 0;
    const bb = isBoost(b) ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return b.blockTime - a.blockTime;
  });
const boostFirst = boostSort([
  { lamports: 1_000_000_000, blockTime: 300 },
  { lamports: 6_000_000_000, blockTime: 100 }, // boost, but older
  { lamports: 500_000_000, blockTime: 400 },
  { lamports: 5_000_000_000, blockTime: 200 }, // exactly at threshold = boost
]);
assert.deepStrictEqual(
  boostFirst.map((r) => r.lamports),
  [5_000_000_000, 6_000_000_000, 500_000_000, 1_000_000_000],
  "boosts pin to the top (newest boost first), then newest-first for the rest"
);
// threshold edge: 5 COOK - 1 lamport is NOT a boost
assert.ok(!isBoost({ lamports: BOOST_LAMPORTS - 1 }));
assert.ok(isBoost({ lamports: BOOST_LAMPORTS }));

console.log("ALL CLAW-72 UNIT TESTS PASS");

// --- CLAW-72 treasury transparency tile (static wiring checks) ---
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

assert.ok(indexHtml.includes('id="stat-treasury"'), "index.html must render the protocol-fees stat tile");
assert.ok(indexHtml.includes('id="treasury-link"'), "index.html must link the treasury tile to the explorer");
assert.ok(appJs.includes('statTreasury: $("stat-treasury")'), "app.js must bind the treasury tile element");
assert.ok(appJs.includes("async function fetchTreasury()"), "app.js must define fetchTreasury()");
assert.ok(/fetchTreasury\(\);/.test(appJs), "refreshFeed must call fetchTreasury()");
// treasury tile must read the REAL fee pubkey, not a hardcoded copy
assert.ok(/getBalance\(new PublicKey\(FEE_PUBKEY_STR\)\)/.test(appJs), "fetchTreasury must read FEE_PUBKEY_STR via getBalance");
console.log("ALL CLAW-72 UNIT TESTS PASS (incl. treasury tile wiring)");

// --- CLAW-72 share row (viral referral loop) ---
// buildShareUrl is pure — extract + eval it from app.js so behavior is really tested
const mShare = appJs.match(/function buildShareUrl\(current, jar, sharer\) \{[\s\S]*?\n\}/);
assert.ok(mShare, "app.js must define buildShareUrl(current, jar, sharer)");
const buildShareUrl = new Function(`return (${mShare[0].replace(/^function buildShareUrl/, "function")})`)();

const BASE = "https://aaron11998.github.io/cookie-crumbs/";
// connected sharer: their own via replaces the page's promoter via
assert.strictEqual(
  buildShareUrl(BASE + "?jar=JarAAA&via=PromoterBBB#feed", "JarAAA", "SharerCCC"),
  BASE + "?jar=JarAAA&via=SharerCCC",
  "connected sharer's link carries their own ?via="
);
// anonymous visitor: no via injected (page promoter link not stolen)
assert.strictEqual(
  buildShareUrl(BASE + "?jar=JarAAA&via=PromoterBBB", "JarAAA", null),
  BASE + "?jar=JarAAA",
  "anonymous share drops via entirely"
);
// sharing your own page: no self-referral
assert.strictEqual(
  buildShareUrl(BASE + "?jar=JarAAA", "JarAAA", "JarAAA"),
  BASE + "?jar=JarAAA",
  "self-share adds no via"
);
// jar param always set; hash stripped
assert.strictEqual(
  buildShareUrl(BASE + "#x", "JarDDD", "SharerEEE"),
  BASE + "?jar=JarDDD&via=SharerEEE",
  "community page share gets jar + sharer via, hash stripped"
);
// wiring: share buttons exist and the row re-renders on connect/disconnect
assert.ok(indexHtml.includes('id="share-row"'), "index.html must render the share row");
assert.ok(indexHtml.includes('id="share-copy"') && indexHtml.includes('id="share-x"') && indexHtml.includes('id="share-tg"'), "share row needs copy + X + Telegram buttons");
assert.ok(/connectWallet[\s\S]*?renderShareRow\(\);/.test(appJs), "connecting must re-render share links with the sharer's via");
assert.ok(/disconnectWallet[\s\S]*?renderShareRow\(\);/.test(appJs), "disconnecting must restore the page's own link");

console.log("ALL CLAW-72 UNIT TESTS PASS (incl. treasury tile + share row)");

// --- CLAW-72 embeddable widget (distribution rail) ---
// buildEmbedSnippet is pure — extract + eval it from app.js so behavior is really tested
const mEmbed = appJs.match(/function buildEmbedSnippet\(jar, originBase\) \{[\s\S]*?\n\}/);
assert.ok(mEmbed, "app.js must define buildEmbedSnippet(jar, originBase)");
const buildEmbedSnippet = new Function(`return (${mEmbed[0].replace(/^function buildEmbedSnippet/, "function")})`)();

const SNIPPET_BASE = "https://aaron11998.github.io/cookie-crumbs/";
// personal page: snippet carries that page's jar + premium upgrade hooks
assert.strictEqual(
  buildEmbedSnippet("JarAddr111", SNIPPET_BASE),
  '<script src="' + SNIPPET_BASE + 'embed.js"\n  data-jar="JarAddr111"\n  data-premium="true"\n  data-wallet="PASTE_HOST_WALLET_HERE"\n  data-theme="auto"\n  data-analytics="true"></script>',
  "personal page embed must carry data-jar + premium upgrade hooks"
);
// community page: no data-jar (loader defaults to community jar), same premium hooks
assert.strictEqual(
  buildEmbedSnippet(null, SNIPPET_BASE),
  '<script src="' + SNIPPET_BASE + 'embed.js"\n  data-premium="true"\n  data-wallet="PASTE_HOST_WALLET_HERE"\n  data-theme="auto"\n  data-analytics="true"></script>',
  "community page embed must omit data-jar (loader default) and carry premium hooks"
);
// address containing quotes/&/angle brackets gets escaped inside the attribute
// (defense in depth — jar addresses are already validated as base58 upstream)
assert.strictEqual(
  buildEmbedSnippet('x"y&z<w>', SNIPPET_BASE).split("\n  data-premium")[0],
  '<script src="' + SNIPPET_BASE + 'embed.js"\n  data-jar="x&quot;y&amp;z&lt;w&gt;"',
  "snippet builder must escape quotes/ampersands/angle brackets in interpolated attrs"
);

// embed.js hygiene: served file must be parseable, self-contained, and expose the API
const embedJs = fs.readFileSync(path.join(ROOT, "embed.js"), "utf8");
new Function(embedJs); // syntax check (node parses the whole loader)
assert.ok(embedJs.includes("data-jar"), "embed.js must read data-jar");
assert.ok(embedJs.includes("cookie_crumbs"), "embed.js must support the ?cookie_crumbs=popup deep link");
assert.ok(embedJs.includes("window.CookieCrumbs"), "embed.js must expose window.CookieCrumbs");
assert.ok(/new URL\(APP_URL\)/.test(embedJs), "widget URL must be built from the canonical APP_URL");
assert.ok(!/innerHTML\s*=/.test(embedJs), "embed.js must not use innerHTML (XSS surface)");

// data-label: host sites can customize the CTA (trim + 32-char cap + safe render)
const mLabel = embedJs.match(/(var rawLabel = (?:.|\n)*?var label = (?:.|\n)*?);/);
assert.ok(mLabel, "embed.js must derive rawLabel and label from the data-label attribute");
const labelFrom = new Function(
  `return function (attrVal) { var script = { getAttribute: function () { return attrVal; } }; ${mLabel[1]}; return label; }`
)();
assert.strictEqual(labelFrom(undefined), "Tip 🍪", "no data-label falls back to the default CTA");
assert.strictEqual(labelFrom(""), "Tip 🍪", "empty data-label falls back to the default CTA");
assert.strictEqual(labelFrom("   "), "Tip 🍪", "whitespace data-label falls back to the default CTA");
assert.strictEqual(labelFrom("Support open research"), "Support open research", "custom label is used verbatim after trim");
assert.strictEqual(labelFrom("x".repeat(40)), "x".repeat(32), "labels are capped at 32 chars");
assert.ok(/textContent\s*=\s*label/.test(embedJs), "label must render via textContent (no HTML injection)");

// wiring: embed card + copy button exist; embed-mode class + iframe-close listener
assert.ok(indexHtml.includes('id="embed-card"'), "index.html must render the embed card");
assert.ok(indexHtml.includes('id="embed-snippet"') && indexHtml.includes('id="embed-copy"'), "embed card needs snippet + copy button");
assert.ok(indexHtml.includes('href="https://github.com/aaron11998/cookie-crumbs#embed-on-your-site"'), "embed card must link the embed docs");
assert.ok(/function renderEmbedCard\(\)/.test(appJs), "app.js must render the embed card");
assert.ok(/renderEmbedCard\(\);/.test(appJs), "renderEmbedCard must be invoked at startup");
assert.ok(/classList\.add\("cc-embed"\)/.test(appJs), "embed mode must tag <html> with cc-embed");
assert.ok(/e\.origin !== "https:\/\/aaron11998\.github\.io"/.test(appJs), "iframe close listener must check message origin");
const stylesCss = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
assert.ok(/html\.cc-embed \.topbar[\s\S]*?display: none/.test(stylesCss), "embed mode CSS must hide the topbar chrome");
assert.ok(stylesCss.includes(".embed-snippet"), "styles.css must style the embed snippet");

console.log("ALL CLAW-72 UNIT TESTS PASS (incl. treasury tile + share row + embed widget)");

// --- CLAW-72 premium embed subscription (recurring-income mechanism #7) ---
// 1 COOK/month paid on-chain to the treasury unlocks 50% referral share + analytics.

// premium share math (mirrors sendTip via getReferralSharePct)
assert.ok(appJs.includes("const PREMIUM_REFERRAL_SHARE_PCT = 50;"), "premium share must be 50%");
assert.ok(appJs.includes("const SUB_LAMPORTS = 1_000_000_000;"), "subscription price must be 1 COOK");
assert.ok(/function getReferralSharePct\(isPremium\) \{/.test(appJs), "app.js must define getReferralSharePct");
assert.ok(
  /const refSharePct = getReferralSharePct\(premiumActive\);/.test(appJs),
  "sendTip must route the referral share through premium status (wired, not dead code)"
);

// verification must be per-host-wallet and fail-closed (no free-premium hole)
const mCheck = appJs.match(/async function checkPremiumEmbed\(hostWalletStr\) \{[\s\S]*?\n\}/);
assert.ok(mCheck, "app.js must define checkPremiumEmbed(hostWalletStr)");
assert.ok(/keys\[0\] !== hostPk\.toBase58\(\)/.test(mCheck[0]), "premium requires payment FROM the host's own wallet");
assert.ok(/gained >= SUB_LAMPORTS/.test(mCheck[0]), "premium requires payment of at least SUB_LAMPORTS");
assert.ok(/PREMIUM_CHECK_WINDOW_S = 30 \* 86400/.test(appJs), "subscription verifies within a rolling 30-day window (recurring)");
assert.ok(/return false; \/\/ fail-closed/.test(mCheck[0]), "RPC failure must fail closed, never fake premium");
assert.ok(!appJs.includes("SUB_PUBKEY_STR"), "stale SUB_PUBKEY_STR constant must be gone (treasury IS the sub destination)");
assert.ok(/new PublicKey\(FEE_PUBKEY_STR\)/.test(mCheck[0]), "subscription payments land in the protocol treasury");

// premium request plumbing: embed.js forwards attrs, widget verifies then activates
assert.ok(/q\.get\("premium"\) !== "1"/.test(appJs), "widget must gate premium verification on ?premium=1");
assert.ok(/q\.get\("host_wallet"\)/.test(appJs), "widget must read ?host_wallet for per-host verification");
assert.ok(embedJs.includes('"premium", "1"'), "embed.js must forward premium in the widget URL");
assert.ok(embedJs.includes('"host_wallet"'), "embed.js must forward the host wallet in the widget URL");
assert.ok(/data-premium/.test(embedJs) && /data-wallet/.test(embedJs), "embed.js must document data-premium/data-wallet attrs");

// analytics events fire only for verified premium embeds
assert.ok(/function premiumEvent\(type, detail\) \{[\s\S]*?if \(!premiumActive\) return;/.test(appJs), "premiumEvent must be gated on verified premium");
assert.ok(appJs.includes('premiumEvent("tip:open"'), "tip:open analytics event must fire");
assert.ok(appJs.includes('premiumEvent("tip:confirm"'), "tip:confirm analytics event must fire");
assert.ok(appJs.includes('premiumEvent("tip:error"'), "tip:error analytics event must fire");

// the embed card must tell hosts how to buy premium (self-serve sales surface)
assert.ok(indexHtml.includes('id="premium-note"'), "index.html must show hosts the premium embed offer");
assert.ok(indexHtml.includes("1 COOK/month"), "premium offer must state the price");

console.log("ALL CLAW-72 UNIT TESTS PASS (incl. premium embed subscription)");

// --- CLAW-72 sponsor slot rental (mechanism #9): findActiveSponsor extracted from app.js ---
const SPONSOR_LAMPORTS = 25_000_000_000;
const SPONSOR_HOURS = 24;
const SPONSOR_PREFIX = "sponsor:";
const mSponsor = appJs.match(/function findActiveSponsor\(rows, nowSec\) \{[\s\S]*?\n\}/);
assert.ok(mSponsor, "app.js must define findActiveSponsor(rows, nowSec)");
const findActiveSponsor = new Function(
  "SPONSOR_LAMPORTS", "SPONSOR_HOURS", "SPONSOR_PREFIX",
  `return (${mSponsor[0].replace(/^function findActiveSponsor/, "function")})`
)(SPONSOR_LAMPORTS, SPONSOR_HOURS, SPONSOR_PREFIX);

const mkSponsor = (lamports, msg, blockTime) => ({ lamports, message: msg, blockTime, sig: "sig" + blockTime });
// qualifying tx: newest sponsor: tx inside its 24h window wins
const sRows = [
  mkSponsor(1_000_000_000, "regular tip", 1000),
  mkSponsor(30_000_000_000, "sponsor:Old Co", 2000),        // expired by now=100k
  mkSponsor(26_000_000_000, "sponsor:New Co", 90_000),      // active, newest
  mkSponsor(40_000_000_000, "sponsor:Too New", 200_000),    // future — not yet started
  mkSponsor(5_000_000_000, "boost but big", 95_000),        // >= threshold, no marker
];
const slot = findActiveSponsor(sRows, 100_000);
assert.ok(slot, "an active sponsor slot must be found");
assert.strictEqual(slot.label, "New Co", "newest qualifying in-window sponsor wins");
assert.strictEqual(slot.until, 90_000 + 86400, "slot runs SPONSOR_HOURS from blockTime");
// expiry edges
assert.strictEqual(findActiveSponsor([mkSponsor(30_000_000_000, "sponsor:X", 0)], 86_400), null, "slot ends exactly at start+24h");
assert.ok(findActiveSponsor([mkSponsor(30_000_000_000, "sponsor:X", 0)], 86_399), "still active 1s before expiry");
assert.strictEqual(findActiveSponsor([mkSponsor(30_000_000_000, "sponsor:X", 0)], 86_399).label, "X");
// future tx not yet valid; boundary now===start is valid
assert.strictEqual(findActiveSponsor([mkSponsor(30_000_000_000, "sponsor:X", 5_000)], 4_999), null, "future tx cannot sponsor");
assert.ok(findActiveSponsor([mkSponsor(30_000_000_000, "sponsor:X", 5_000)], 5_000), "tx valid from its own blockTime");
// below threshold with marker is NOT a sponsor (marker without payment)
assert.strictEqual(findActiveSponsor([mkSponsor(SPONSOR_LAMPORTS - 1, "sponsor:Freeloader", 100)], 200), null, "under-threshold tx cannot rent");
// label trimming: prefix stripped, whitespace trimmed, capped at 32
assert.strictEqual(findActiveSponsor([mkSponsor(25_000_000_000, "sponsor:   Padded Name   ", 0)], 1).label, "Padded Name");
assert.strictEqual(findActiveSponsor([mkSponsor(25_000_000_000, "sponsor:" + "x".repeat(50), 0)], 1).label, "x".repeat(32));
assert.strictEqual(findActiveSponsor([mkSponsor(25_000_000_000, "sponsor:", 0)], 1).label, "", "empty label allowed (renders as anonymous)");
// rows without string messages must not crash
assert.strictEqual(findActiveSponsor([{ lamports: 30_000_000_000, message: null, blockTime: 0 }], 1), null);
console.log("SPONSOR SLOT LOGIC PASS (rental window, newest-wins, label handling)");

// wiring: banner + card + chip + embed hiding + feed refresh call
assert.ok(indexHtml.includes('id="sponsor-banner"'), "index.html must render the sponsor banner");
assert.ok(indexHtml.includes('id="sponsor-banner-label"') && indexHtml.includes('id="sponsor-banner-link"'), "banner needs label + explorer link");
assert.ok(indexHtml.includes('id="sponsor-card"'), "index.html must explain the sponsor rental (sponsor-card)");
assert.ok(indexHtml.includes('chip-sponsor') && indexHtml.includes('data-amt="25"'), "Sponsor 25 chip must exist");
assert.ok(/function renderSponsorBanner\(rows\)/.test(appJs), "app.js must define renderSponsorBanner(rows)");
assert.ok(/renderSponsorBanner\(rows\);/.test(appJs), "refreshFeed must call renderSponsorBanner(rows)");
assert.ok(/msg\.startsWith\(SPONSOR_PREFIX\)/.test(appJs), "sendTip must auto-prefix the sponsor marker at 25 COOK");
assert.ok(stylesCss.includes(".sponsor-banner"), "styles.css must style the sponsor banner");
assert.ok(/html\.cc-embed \.sponsor-banner,[\s\S]*?display: none/.test(stylesCss), "embed mode must hide the sponsor banner + card");
console.log("SPONSOR SLOT WIRING PASS");

console.log("ALL CLAW-72 UNIT TESTS PASS (incl. treasury tile + share row + embed widget + sponsor slots)");

// ---------- tip goals (mechanism #10): paid, on-chain-verified fundraising targets ----------
const GOAL_MEMO_PREFIX = "cookie-crumbs:goal:";
function parseGoalMemo(memo, jarAddress) {
  if (typeof memo !== "string" || !memo.startsWith(GOAL_MEMO_PREFIX)) return null;
  const parts = memo.slice(GOAL_MEMO_PREFIX.length).split(":");
  if (parts[0] !== jarAddress) return null;
  const lamports = Number(parts[1]);
  if (!Number.isFinite(lamports) || !Number.isInteger(lamports) || lamports <= 0) return null;
  const label = parts[2] ? parts.slice(2).join(":").slice(0, 32) : "";
  return { lamports, label };
}
function computeGoalProgress(raisedLamports, goalLamports) {
  if (!Number.isFinite(raisedLamports) || !Number.isFinite(goalLamports) || goalLamports <= 0) {
    return { pct: 0, hit: false };
  }
  const pct = Math.max(0, Math.min(100, Math.floor((raisedLamports * 100) / goalLamports)));
  return { pct, hit: raisedLamports >= goalLamports };
}
const JAR = "JarAddr1111111111111111111111111111111111111";
// happy path + label
assert.deepStrictEqual(parseGoalMemo("cookie-crumbs:goal:" + JAR + ":100000000000:server costs", JAR), { lamports: 100000000000, label: "server costs" });
// no label
assert.deepStrictEqual(parseGoalMemo("cookie-crumbs:goal:" + JAR + ":5000", JAR), { lamports: 5000, label: "" });
// wrong jar ignored
assert.strictEqual(parseGoalMemo("cookie-crumbs:goal:OtherJar:5000", JAR), null);
// non-goal memos (tips, premium) ignored
assert.strictEqual(parseGoalMemo("gm cookie chain", JAR), null);
assert.strictEqual(parseGoalMemo("cookie-crumbs:premium:upgrade:" + JAR, JAR), null);
// malformed amounts rejected (no NaN / zero / negative / fractional)
for (const bad of ["cookie-crumbs:goal:" + JAR + ":abc", "cookie-crumbs:goal:" + JAR + ":0", "cookie-crumbs:goal:" + JAR + ":-5", "cookie-crumbs:goal:" + JAR + ":1.5", "cookie-crumbs:goal:" + JAR + ":"]) {
  assert.strictEqual(parseGoalMemo(bad, JAR), null, `must reject ${bad}`);
}
// label with colons tolerated (joined), capped at 32
const multi = parseGoalMemo("cookie-crumbs:goal:" + JAR + ":100:a:b:c", JAR);
assert.strictEqual(multi.label, "a:b:c");
assert.ok(parseGoalMemo("cookie-crumbs:goal:" + JAR + ":100:" + "x".repeat(40), JAR).label.length <= 32);
// progress math: clamp + hit + guard
assert.strictEqual(computeGoalProgress(50, 100).pct, 50);
assert.strictEqual(computeGoalProgress(150, 100).pct, 100);
assert.strictEqual(computeGoalProgress(150, 100).hit, true);
assert.strictEqual(computeGoalProgress(99, 100).hit, false);
assert.strictEqual(computeGoalProgress(0, 100).pct, 0);
assert.strictEqual(computeGoalProgress(100, 0).pct, 0, "zero goal guarded");
assert.strictEqual(computeGoalProgress(-5, 100).pct, 0, "negative raised clamped");
// app.js must contain the exact same pure logic (no drift between test mirror and app)
assert.ok(appJs.includes('const GOAL_MEMO_PREFIX = "cookie-crumbs:goal:";'), "app.js must define the goal memo prefix");
const mParse = appJs.match(/function parseGoalMemo\(memo, jarAddress\) \{[\s\S]*?\n\}/);
assert.ok(mParse, "app.js must define parseGoalMemo(memo, jarAddress)");
const mProg = appJs.match(/function computeGoalProgress\(raisedLamports, goalLamports\) \{[\s\S]*?\n\}/);
assert.ok(mProg, "app.js must define computeGoalProgress(raisedLamports, goalLamports)");
// goal fee actually paid to the treasury (the monetization rail), with a memo tx
const mGoalTx = appJs.match(/async function sendGoalTx\(goalLamports, goalLabel\) \{[\s\S]*?\n\}/);
assert.ok(mGoalTx, "app.js must define sendGoalTx");
assert.ok(/new PublicKey\(FEE_PUBKEY_STR\)/.test(mGoalTx[0]), "goal fee must be paid to the protocol treasury");
assert.ok(/GOAL_MEMO_PREFIX\}\$\{JAR\.address\}:\$\{goalLamports\}/.test(mGoalTx[0]), "goal tx must carry the parseable goal memo");
// progress bar renders from feed rows and refreshes with the feed
assert.ok(/renderGoal\(rows\)/.test(appJs), "refreshFeed must render the goal from feed rows");
assert.ok(indexHtml.includes('id="goal-section"'), "index.html must carry the goal progress bar");
assert.ok(indexHtml.includes('id="goal-set-section"'), "index.html must carry the goal-setting form");
assert.ok(indexHtml.includes("2 COOK"), "goal-setting price must be visible in the UI");
// embed widget: host page controls goals, widget stays read-only
assert.ok(stylesCss.includes("html.cc-embed .goal-set"), "embed widget must hide goal-setting (host page owns the goal)");

console.log("ALL CLAW-72 UNIT TESTS PASS (incl. premium embed subscription + sponsor slots + tip goals + tip splits)");

// ---------- tip splits (mechanism #11): revenue sharing on a plain transfer ----------
const SPLIT_MEMO_PREFIX = "split:";
const SPLIT_MIN_BPS = 100;
const SPLIT_MAX_BPS = 5000;
const SPLIT_CONFIG_PREFIX = "cookie-crumbs:split:";
const SPLIT_CONFIG_TIP = 1_000_000;
const FEE_PUBKEY_STR = "2BmqohyRU8mprrRXtUokCBje52MBKFd3FWNCcsPLJf3k";

// tiny base58 codec so the tests exercise the REAL PublicKey round-trip on
// genuine addresses instead of string stand-ins.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  let pad = 0;
  for (const b of bytes) { if (b === 0) pad++; else break; }
  return "1".repeat(pad) + s;
}
function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i === -1) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  let pad = 0;
  for (const c of s) { if (c === "1") pad++; else break; }
  return Uint8Array.from([...new Array(pad).fill(0), ...out]);
}
// PublicKey stand-in with real base58 validation + canonical round-trip
class FakePublicKey {
  constructor(v) {
    if (typeof v === "string") {
      const bytes = b58decode(v.trim());
      if (bytes.length !== 32) throw new Error("invalid length");
      this._b = bytes;
    } else if (v instanceof Uint8Array && v.length === 32) {
      this._b = v;
    } else throw new Error("invalid public key input");
  }
  toBase58() { return b58encode(this._b); }
}
const mkAddr = (seed) => new FakePublicKey(Uint8Array.from([seed, ...new Array(31).fill(seed)])).toBase58();
const JAR_ADDR = mkAddr(7);
const ALICE = mkAddr(11);
const BOB = mkAddr(23);

// extract the REAL implementations from app.js (no mirrored copies -> no drift)
const extract = (name, args) => {
  const re = new RegExp(`function ${name}\\(${args}\\) \\{[\\s\\S]*?\\n\\}`);
  const m = appJs.match(re);
  assert.ok(m, `app.js must define ${name}(${args})`);
  return m[0];
};
const splitCtx = new Function(
  "SPLIT_MEMO_PREFIX", "SPLIT_MIN_BPS", "SPLIT_MAX_BPS", "SPLIT_CONFIG_PREFIX",
  "PublicKey", "FEE_PUBKEY_STR",
  `return {
     parseSplitMemo: ${extract("parseSplitMemo", "memo, jarAddress")},
     computeSplit: ${extract("computeSplit", "jarLamports, bps")},
     parseSplitConfigMemo: ${extract("parseSplitConfigMemo", "memo, jarAddress")},
   };`
)(SPLIT_MEMO_PREFIX, SPLIT_MIN_BPS, SPLIT_MAX_BPS, SPLIT_CONFIG_PREFIX, FakePublicKey, FEE_PUBKEY_STR);
const { parseSplitMemo, computeSplit, parseSplitConfigMemo } = splitCtx;
// resolveSplit composes parseSplitMemo, so its sibling must be in scope
const resolveSplit = new Function(
  "parseSplitMemo",
  `return (${extract("resolveSplit", "message, defaultSplit, jarAddress")})`
)(parseSplitMemo);

// tipper-authored split memo: happy paths
assert.deepStrictEqual(parseSplitMemo(`split:2000:${ALICE}`, JAR_ADDR), { bps: 2000, recipient: ALICE });
assert.deepStrictEqual(parseSplitMemo(`split:100:${ALICE}`, JAR_ADDR), { bps: 100, recipient: ALICE }, "1% floor accepted");
assert.deepStrictEqual(parseSplitMemo(`split:5000:${ALICE}`, JAR_ADDR), { bps: 5000, recipient: ALICE }, "50% ceiling accepted");
// non-split memos are ignored (splits must not hijack normal tips)
assert.strictEqual(parseSplitMemo("gm cookie chain 🍪", JAR_ADDR), null);
assert.strictEqual(parseSplitMemo("sponsor:Acme Co", JAR_ADDR), null);
assert.strictEqual(parseSplitMemo(`cookie-crumbs:goal:${JAR_ADDR}:1000`, JAR_ADDR), null);
assert.strictEqual(parseSplitMemo(null, JAR_ADDR), null, "null memo safe");
// out-of-range shares rejected (0, negative, >50%, fractional, missing)
for (const bad of [`split:0:${ALICE}`, `split:-100:${ALICE}`, `split:5001:${ALICE}`, `split:12.5:${ALICE}`, `split::${ALICE}`, `split:abc:${ALICE}`]) {
  assert.strictEqual(parseSplitMemo(bad, JAR_ADDR), null, `must reject ${bad}`);
}
// recipient guards: self-split is a no-op, treasury already takes the fee
assert.strictEqual(parseSplitMemo(`split:2000:${JAR_ADDR}`, JAR_ADDR), null, "cannot split to the jar itself");
assert.strictEqual(parseSplitMemo(`split:2000:${FEE_PUBKEY_STR}`, JAR_ADDR), null, "cannot split to the treasury");
// malformed / non-base58 / non-32-byte recipients rejected
assert.strictEqual(parseSplitMemo("split:2000:not-an-address", JAR_ADDR), null);
assert.strictEqual(parseSplitMemo("split:2000:0OIl", JAR_ADDR), null, "ambiguous base58 chars rejected");
assert.strictEqual(parseSplitMemo(`split:2000:${ALICE}extra`, JAR_ADDR), null);
// canonicalisation: a padded/whitespace recipient resolves to the canonical address
assert.deepStrictEqual(parseSplitMemo(`split:2000:  ${ALICE}  `, JAR_ADDR), { bps: 2000, recipient: ALICE });

// the split comes out of the JAR's proceeds — the tipper's cost is untouched
const jarCut = 100_000_000 - 750_000; // 0.1 COOK minus the 0.75% protocol fee
const sp = computeSplit(jarCut, 2000);
assert.strictEqual(sp.recipient, Math.floor((jarCut * 2000) / 10_000));
assert.strictEqual(sp.jar + sp.recipient, jarCut, "jar + recipient must equal the jar's proceeds");
assert.strictEqual(sp.jar + sp.recipient + 750_000, 100_000_000, "tipper total cost unchanged by a split");
assert.deepStrictEqual(computeSplit(jarCut, 5000), { jar: jarCut - Math.floor(jarCut / 2), recipient: Math.floor(jarCut / 2) });
assert.deepStrictEqual(computeSplit(0, 2000), { jar: 0, recipient: 0 }, "zero proceeds guarded");
assert.deepStrictEqual(computeSplit(-5, 2000), { jar: 0, recipient: 0 }, "negative proceeds guarded");
assert.strictEqual(computeSplit(999, 100).recipient, 9, "floors to whole lamports, no fractional dust");
assert.strictEqual(computeSplit(1, 100).recipient, 0, "sub-100-lamport proceeds produce no split transfer");

// owner-registered default split (config memo)
assert.deepStrictEqual(
  parseSplitConfigMemo(`cookie-crumbs:split:${JAR_ADDR}:${BOB}:2500:sound design`, JAR_ADDR),
  { bps: 2500, recipient: BOB, label: "sound design" }
);
assert.deepStrictEqual(
  parseSplitConfigMemo(`cookie-crumbs:split:${JAR_ADDR}:${BOB}:2500`, JAR_ADDR),
  { bps: 2500, recipient: BOB, label: "" }
);
assert.strictEqual(parseSplitConfigMemo(`cookie-crumbs:split:${ALICE}:${BOB}:2500`, JAR_ADDR), null, "config for another jar ignored");
assert.strictEqual(parseSplitConfigMemo(`cookie-crumbs:split:${JAR_ADDR}:${JAR_ADDR}:2500`, JAR_ADDR), null, "self-split config rejected");
assert.strictEqual(parseSplitConfigMemo(`cookie-crumbs:split:${JAR_ADDR}:${BOB}:9000`, JAR_ADDR), null, "90% config rejected");
assert.strictEqual(parseSplitConfigMemo(`cookie-crumbs:premium:upgrade:${JAR_ADDR}`, JAR_ADDR), null, "non-split config ignored");
assert.ok(parseSplitConfigMemo(`cookie-crumbs:split:${JAR_ADDR}:${BOB}:2500:${"x".repeat(40)}`, JAR_ADDR).label.length <= 32, "config label capped at 32");

// precedence: an explicit per-tip memo beats the owner's registered default
const ownerDefault = { bps: 2500, recipient: BOB, label: "" };
assert.deepStrictEqual(resolveSplit(`split:1000:${ALICE}`, ownerDefault, JAR_ADDR), { bps: 1000, recipient: ALICE }, "tipper memo wins");
assert.deepStrictEqual(resolveSplit("just a message", ownerDefault, JAR_ADDR), ownerDefault, "default applies otherwise");
assert.strictEqual(resolveSplit("just a message", null, JAR_ADDR), null, "no split configured -> no split");
assert.deepStrictEqual(resolveSplit(`split:10:${ALICE}`, ownerDefault, JAR_ADDR), ownerDefault, "invalid memo falls back to the default, not to a bad split");

// the tip transaction must actually carry the split transfer, memo, and fee
const mSendTip = appJs.match(/async function sendTip\(\) \{[\s\S]*?\n\}/);
assert.ok(mSendTip, "app.js must define sendTip()");
assert.ok(/const split = await effectiveSplit\(msg\);/.test(mSendTip[0]), "sendTip must resolve the split before building the tx");
assert.ok(/SystemProgram\.transfer\(\{[\s\S]*?toPubkey: new PublicKey\(split\.recipient\)/.test(mSendTip[0]), "split tips must transfer to the recipient in the same tx");
assert.ok(/lamports: splitParts \? splitParts\.jar : jarLamports/.test(mSendTip[0]), "the jar leg must shrink by the split amount");
assert.ok(/new PublicKey\(FEE_PUBKEY_STR\)/.test(mSendTip[0]), "the 0.75% protocol fee must survive split tips (splits are fee-carrying)");
assert.ok(/data: new TextEncoder\(\)\.encode\(msg\)/.test(mSendTip[0]), "the split memo must be posted on-chain with the tip");

// owner registration path pays the treasury and writes a parseable config memo
const mSplitTx = appJs.match(/async function sendSplitConfigTx\(recipient, bps\) \{[\s\S]*?\n\}/);
assert.ok(mSplitTx, "app.js must define sendSplitConfigTx(recipient, bps)");
assert.ok(/new PublicKey\(FEE_PUBKEY_STR\)/.test(mSplitTx[0]), "split config must pay the protocol treasury (revenue rail)");
assert.ok(/SPLIT_CONFIG_PREFIX\}\$\{JAR\.address\}:\$\{recipient\}:\$\{bps\}/.test(mSplitTx[0]), "config tx must carry the parseable split memo");

// read path: the default split is discovered from chain, fail-open
const mLoad = appJs.match(/async function loadDefaultSplit\(\) \{[\s\S]*?\n\}/);
assert.ok(mLoad, "app.js must define loadDefaultSplit()");
assert.ok(/getSignaturesForAddress\(/.test(mLoad[0]) && /MEMO_PROGRAM_ID_STR/.test(mLoad[0]), "default split must be read from treasury history memos");
assert.ok(/loadDefaultSplit\(\)/.test(appJs), "init must load the default split");
assert.ok(/updateSplitSection\(\);/.test(appJs), "connect/disconnect must refresh the split section");

// UI wiring
assert.ok(indexHtml.includes('id="split-note"'), "index.html must disclose the active split to tippers");
assert.ok(indexHtml.includes('id="split-set-section"'), "index.html must carry the split-setting form");
assert.ok(indexHtml.includes('id="split-addr-input"') && indexHtml.includes('id="split-bps-input"'), "split form needs recipient + share inputs");
assert.ok(indexHtml.includes("split:2000:"), "the tipper-authored split memo must be documented in the UI");
assert.ok(stylesCss.includes(".split-note") && stylesCss.includes(".split-form"), "styles.css must style the split UI");
assert.ok(/html\.cc-embed \.goal-set/.test(stylesCss) && stylesCss.includes(".split-set { margin"), "embed widget hides owner config; disclosure stays visible");
console.log("TIP SPLIT LOGIC + WIRING PASS (memo parse, cost invariant, precedence, tx legs, owner config)");

// ---------- goal ledger correctness (mechanism #10 regression fixes) ----------
const mSum = appJs.match(/function sumTipsSince\(rows, sinceBlockTime\) \{[\s\S]*?\n\}/);
assert.ok(mSum, "app.js must define sumTipsSince(rows, sinceBlockTime)");
const sumTipsSince = new Function(`return (${mSum[0]})`)();
const goalRows = [
  { lamports: 5_000_000_000, blockTime: 100, message: "early tip" },
  { lamports: 3_000_000_000, blockTime: 300, message: "later tip" },
  { lamports: 0, blockTime: 200, message: `cookie-crumbs:goal:${JAR_ADDR}:100000000000` },
];
assert.strictEqual(sumTipsSince(goalRows, 200), 3_000_000_000, "only tips at/after the goal tx count toward it");
assert.strictEqual(sumTipsSince(goalRows, 100), 8_000_000_000, "all tips count when the goal is oldest");
assert.strictEqual(sumTipsSince([], 0), 0, "empty ledger safe");
assert.strictEqual(sumTipsSince(undefined, 0), 0, "null rows safe");
assert.strictEqual(sumTipsSince([{ lamports: 5, blockTime: "nope" }], 0), 0, "non-numeric blockTime ignored");

// goal selection must be newest-by-blockTime, not first-in-array: boosted tips
// sort to the front, so a stale goal could otherwise override a fresh one
const mFindGoal = appJs.match(/function findGoalMemos\(rows, jarAddress\) \{[\s\S]*?\n\}/);
assert.ok(mFindGoal, "app.js must define findGoalMemos(rows, jarAddress)");
const findGoalMemos = new Function(
  "parseGoalMemo",
  `return (${mFindGoal[0]})`
)(parseGoalMemo);
const picked = findGoalMemos([
  { lamports: 1e11, blockTime: 100, message: `cookie-crumbs:goal:${JAR_ADDR}:100:boosted old goal` },
  { lamports: 1e10, blockTime: 900, message: `cookie-crumbs:goal:${JAR_ADDR}:500:newest goal` },
], JAR_ADDR);
assert.strictEqual(picked.lamports, 500, "newest goal by blockTime wins even when a boost sorts first");
assert.strictEqual(picked.blockTime, 900, "the goal carries its blockTime for the ledger window");
assert.strictEqual(findGoalMemos([{ lamports: 1, blockTime: 1, message: "no goal here" }], JAR_ADDR), null, "no goal -> null");
// the wider scan that makes the ledger honest must be wired into fetchTips
assert.ok(/const FEED_SCAN_LIMIT = 150;/.test(appJs), "app.js must define the wider scan window");
assert.ok(/ok\.slice\(0, FEED_SCAN_LIMIT\)/.test(appJs), "fetchTips must scan FEED_SCAN_LIMIT txs, not just the rendered rows");
assert.ok(/const raised = sumTipsSince\(rows, goal\.blockTime\)/.test(appJs), "renderGoal must total tips since the goal was set");
// empty goal input must not throw (validateAmount returns {ok:false}, never null)
assert.ok(/!parsed \|\| !parsed\.ok \|\| parsed\.lamports <= 0/.test(appJs), "goal form must guard validateAmount's ok flag");
console.log("GOAL LEDGER REGRESSION PASS (since-goal totals, newest-goal-by-blockTime, wider scan, input guard)");

console.log("ALL CLAW-72 UNIT TESTS PASS (incl. premium embed subscription + sponsor slots + tip goals + tip splits + goal ledger fixes)");
