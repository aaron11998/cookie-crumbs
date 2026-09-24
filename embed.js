/* Cookie Crumbs — embeddable tip widget loader
 * One <script> tag puts a "Tip 🍪" button on any page; clicking it opens the
 * full Cookie Crumbs tip page for that jar in a modal iframe. Tips (and the
 * 0.75% protocol fee rail) flow exactly as on the hosted page — the widget is
 * a distribution surface, not a fork. The host site never touches keys,
 * RPC, or transaction bytes.
 *
 * Usage:
 *   <script src="https://aaron11998.github.io/cookie-crumbs/embed.js"
 *           data-jar="<base58 wallet or jar address>"
 *           data-via="<optional promoter address>"
 *           data-label="<optional button label, default 'Tip 🍪'>"
 *           data-wallet="<optional host wallet address for premium verification>"
 *           data-premium="<true|false, forces premium features if sub verified>"
 *           data-theme="<optional: 'light'|'dark'|'auto', default 'auto'>"
 *           data-analytics="<true|false, default true for premium>"></script>
 *
 *   - data-jar absent  -> community jar
 *   - data-label       -> custom CTA text (trimmed, capped at 32 chars;
 *                         rendered via textContent so it can never inject HTML)
 *   - data-wallet      -> host site's wallet address for premium subscription check
 *   - data-premium     -> if true, widget attempts to verify premium subscription
 *   - data-theme       -> button theme (host-site controlled)
 *   - data-analytics   -> fires postMessage with tip events to host page
 *   - ?cookie_crumbs=popup on the HOST page opens the widget immediately
 *     (lets a host site deep-link straight into the tipping flow)
 *   - data-via credits a promoter's referral share on tips from the widget
 *
 * Premium features (require verified 1 COOK/month subscription to SUB_PUBKEY_STR):
 *   - 50% referral share (vs 30% standard) — host earns more on every tip
 *   - Custom branding via data-theme
 *   - Analytics events via postMessage (tip:open, tip:confirm, tip:error)
 *
 * Everything is namespaced under window.CookieCrumbs and styled via a shadow
 * DOM host so host-site CSS can't clash with the button.
 */
"use strict";

(function () {
  if (window.CookieCrumbs && window.CookieCrumbs.loaded) return;

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf("embed.js") !== -1) return all[i];
      }
      return null;
    })();

  var APP_ORIGIN = "https://aaron11998.github.io";
  var APP_PATH = "/cookie-crumbs/";
  var APP_URL = APP_ORIGIN + APP_PATH;

  // accept an explicit base58 jar, else fall back to the community jar page
  function jarFromAttr(raw) {
    var s = (raw || "").trim();
    // base58 alphabet only, 32..44 chars — anything else falls back to the
    // community jar rather than producing a broken tip page
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return s;
    return null;
  }

  function buildWidgetUrl(jar, via, current, ref, premium, hostWallet, theme, analytics) {
    var u = new URL(APP_URL);
    if (jar) u.searchParams.set("jar", jar);
    if (via) u.searchParams.set("via", via);
    if (ref) u.searchParams.set("ref", ref);
    if (premium) u.searchParams.set("premium", "1");
    if (hostWallet) u.searchParams.set("host_wallet", hostWallet);
    if (theme && theme !== "auto") u.searchParams.set("theme", theme);
    if (analytics) u.searchParams.set("analytics", "1");
    u.searchParams.set("embed", "1");
    return u.toString();
  }

  var CSS =
    ".ccw-btn{display:inline-flex;align-items:center;gap:8px;font:600 15px/1 system-ui,-apple-system,sans-serif;" +
    "background:linear-gradient(135deg,#ffb347,#ff8a3d);color:#2b1608;border:0;border-radius:999px;" +
    "padding:12px 20px;cursor:pointer;box-shadow:0 2px 10px rgba(255,138,61,.35);transition:transform .12s ease,box-shadow .12s ease}" +
    ".ccw-btn:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(255,138,61,.5)}" +
    ".ccw-btn:active{transform:translateY(0)}" +
    ".ccw-btn:focus-visible{outline:2px solid #ff8a3d;outline-offset:2px}";

  var MODAL_CSS =
    ".ccw-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(20,10,4,.66);" +
    "display:flex;align-items:center;justify-content:center;padding:16px}" +
    ".ccw-modal{position:relative;width:420px;max-width:100%;max-height:92vh;display:flex}" +
    ".ccw-frame{flex:1;border:0;border-radius:16px;background:#fff;box-shadow:0 12px 48px rgba(0,0,0,.4)}" +
    "@media (max-width:480px){.ccw-overlay{padding:0}.ccw-modal{width:100%;max-height:100vh;height:100%}.ccw-frame{border-radius:0}}" +
    ".ccw-close{position:absolute;top:-14px;right:-14px;width:32px;height:32px;border-radius:50%;" +
    "border:0;background:#2b1608;color:#ffb347;font:700 16px/1 system-ui;cursor:pointer;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.4)}" +
    ".ccw-close:hover{background:#4a2708}" +
    ".ccw-open-out{position:absolute;bottom:-40px;left:50%;transform:translateX(-50%);" +
    "font:500 12px system-ui;color:#ffd9a8;text-decoration:none;white-space:nowrap}";

  function injectStyle(doc, css, id) {
    if (doc.getElementById(id)) return;
    var s = doc.createElement("style");
    s.id = id;
    s.textContent = css;
    doc.head.appendChild(s);
  }

  function openModal(url) {
    if (document.getElementById("ccw-overlay")) return;
    injectStyle(document, MODAL_CSS, "ccw-modal-css");
    var overlay = document.createElement("div");
    overlay.className = "ccw-overlay";
    overlay.id = "ccw-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Cookie Crumbs tip page");
    var modal = document.createElement("div");
    modal.className = "ccw-modal";
    var frame = document.createElement("iframe");
    frame.className = "ccw-frame";
    frame.setAttribute("title", "Tip with Cookie Crumbs");
    frame.setAttribute("allow", "clipboard-write");
    frame.src = url;
    var close = document.createElement("button");
    close.className = "ccw-close";
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Close tip widget");
    close.textContent = "✕";
    var openOut = document.createElement("a");
    openOut.className = "ccw-open-out";
    openOut.href = url;
    openOut.target = "_blank";
    openOut.rel = "noopener noreferrer";
    openOut.textContent = "wallet not working in the widget? open the full tip page ↗";
    function dismiss() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") dismiss();
    }
    close.addEventListener("click", dismiss);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener("keydown", onKey);
    modal.appendChild(frame);
    modal.appendChild(close);
    modal.appendChild(openOut);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function mountButton(scriptEl, jar, via, label) {
    var host = document.createElement("div");
    host.id = "ccw-host-" + Math.random().toString(36).slice(2, 8);
    var shadow = host.attachShadow({ mode: "open" });
    injectStyle(shadow, CSS, "ccw-btn-css");
    var btn = document.createElement("button");
    btn.className = "ccw-btn";
    btn.setAttribute("type", "button");
    btn.textContent = label;
    btn.title = "Tip with Cookie Crumbs — fully on-chain";
    btn.addEventListener("click", function () {
      openModal(buildWidgetUrl(jar, via, location.href, ref, premium, hostWallet, theme, analytics));
    });
    shadow.appendChild(btn);
    if (scriptEl && scriptEl.parentNode) {
      scriptEl.parentNode.insertBefore(host, scriptEl.nextSibling);
    } else {
      document.body.appendChild(host);
    }
    return host;
  }

  var jar = jarFromAttr(script && script.getAttribute("data-jar"));
  var via = jarFromAttr(script && script.getAttribute("data-via"));
  var rawLabel = ((script && script.getAttribute("data-label")) || "").trim();
  var label = rawLabel.slice(0, 32) || "Tip 🍪";
  var hostWallet = jarFromAttr(script && script.getAttribute("data-wallet"));
  var premium = ((script && script.getAttribute("data-premium")) || "").toLowerCase() === "true";
  var theme = ((script && script.getAttribute("data-theme")) || "auto").toLowerCase();
  var analytics = ((script && script.getAttribute("data-analytics")) || "").toLowerCase() === "true";
  // default analytics to true for premium
  if (premium && ((script && script.getAttribute("data-analytics")) === null)) {
    analytics = true;
  }
  var currentHref = location.href;
  var ref = null;
  try {
    if (currentHref && new URL(currentHref).host && currentHref.indexOf("http") === 0) {
      ref = new URL(currentHref).host;
    }
  } catch (e) {
    /* non-URL current — skip ref */
  }
  var host = mountButton(script, jar, via, label);

  window.CookieCrumbs = {
    loaded: true,
    open: function (jarOverride, viaOverride) {
      openModal(buildWidgetUrl(
        jarFromAttr(jarOverride) || jar,
        viaOverride || via,
        location.href,
        ref,
        premium,
        hostWallet,
        theme,
        analytics
      ));
    },
    close: function () {
      var o = document.getElementById("ccw-overlay");
      if (o && o.parentNode) o.parentNode.removeChild(o);
    },
    buttonHost: host,
    version: 2, // premium embed support
  };

  // deep link: host page loaded with ?cookie_crumbs=popup opens the widget now
  try {
    var q = new URLSearchParams(location.search);
    if ((q.get("cookie_crumbs") || "").toLowerCase() === "popup") {
      window.CookieCrumbs.open();
    }
  } catch (e) {
    /* older browsers without URLSearchParams — skip the deep link */
  }
})();
