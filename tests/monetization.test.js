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

const BASE = "https://altaranexus-ship-it.github.io/cookie-crumbs/";
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

const SNIPPET_BASE = "https://altaranexus-ship-it.github.io/cookie-crumbs/";
// personal page: snippet carries that page's jar
assert.strictEqual(
  buildEmbedSnippet("JarAddr111", SNIPPET_BASE),
  '<script src="' + SNIPPET_BASE + 'embed.js"\n  data-jar="JarAddr111"></script>',
  "personal page embed must carry data-jar"
);
// community page: no data-jar (loader defaults to community jar)
assert.strictEqual(
  buildEmbedSnippet(null, SNIPPET_BASE),
  '<script src="' + SNIPPET_BASE + 'embed.js"></script>',
  "community page embed must omit data-jar (loader default)"
);
// address containing quotes/&/angle brackets gets escaped inside the attribute
// (defense in depth — jar addresses are already validated as base58 upstream)
assert.strictEqual(
  buildEmbedSnippet('x"y&z<w>', SNIPPET_BASE),
  '<script src="' + SNIPPET_BASE + 'embed.js"\n  data-jar="x&quot;y&amp;z&lt;w&gt;"></script>',
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
assert.ok(indexHtml.includes('href="https://github.com/altaranexus-ship-it/cookie-crumbs#embed-on-your-site"'), "embed card must link the embed docs");
assert.ok(/function renderEmbedCard\(\)/.test(appJs), "app.js must render the embed card");
assert.ok(/renderEmbedCard\(\);/.test(appJs), "renderEmbedCard must be invoked at startup");
assert.ok(/classList\.add\("cc-embed"\)/.test(appJs), "embed mode must tag <html> with cc-embed");
assert.ok(/e\.origin !== "https:\/\/altaranexus-ship-it\.github\.io"/.test(appJs), "iframe close listener must check message origin");
const stylesCss = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
assert.ok(/html\.cc-embed \.topbar[\s\S]*?display: none/.test(stylesCss), "embed mode CSS must hide the topbar chrome");
assert.ok(stylesCss.includes(".embed-snippet"), "styles.css must style the embed snippet");

console.log("ALL CLAW-72 UNIT TESTS PASS (incl. treasury tile + share row + embed widget)");
