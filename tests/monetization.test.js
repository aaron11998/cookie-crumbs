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

console.log("ALL CLAW-72 UNIT TESTS PASS");
