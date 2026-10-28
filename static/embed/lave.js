/*
 * LAVE OS embeds for lavelondon.com
 *
 *   <lave-booking api="https://os.lavelondon.com" token="…" login-url="…" account-url="…"></lave-booking>
 *   <lave-account api="https://os.lavelondon.com" token="…" login-url="…"></lave-account>
 *
 * `token` is the short-lived SSO token minted by the LAVE OS Connector WordPress plugin
 * for the signed-in WordPress user. Without it the embed shows a sign-in prompt.
 */
(() => {
  "use strict";

  const CSS = `
  :host { all: initial; display: block; container-type: inline-size;
    --ink: #192033; --muted: #686c78; --line: #e2e3e6; --panel: #f9f9f9; --btn: #f3f3f3;
    --ok: #3d7a21; --err: #a8322a; --sel: #192033;
    --font: "Century Gothic", "Questrial", "Didact Gothic", Futura, "Trebuchet MS", Arial, sans-serif;
    font: 400 0.875rem/1.6 var(--font); color: var(--ink); }
  *, *::before, *::after { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  [hidden] { display: none !important; }
  @media (max-width: 600px) { input, select, textarea { font-size: max(1rem, 16px) !important; } }
  .wrap { max-width: 1180px; margin: 0 auto; display: grid; gap: 40px; }
  .eyebrow { font-size: 0.75rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0; }
  h2 { font-size: 0.8125rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; margin: 0; }
  h3 { font-size: 0.8125rem; font-weight: 600; margin: 0; }
  p { margin: 0; }
  .center { text-align: center; }
  .stack { display: grid; gap: 14px; }
  .muted { color: var(--muted); }
  .small { font-size: 0.75rem; }
  .card { border: 1px solid var(--line); background: #fff; padding: 32px clamp(18px, 4vw, 56px); box-shadow: 0 1px 2px rgba(25,32,51,.04); }
  .section-head { display: grid; gap: 6px; justify-items: center; text-align: center; }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 26px;
    border: 0; background: var(--btn); color: var(--ink); font-weight: 600; font-size: 0.75rem; letter-spacing: .06em;
    text-transform: uppercase; cursor: pointer; text-decoration: none; transition: background .15s, color .15s; }
  .btn:hover { background: #e8e8ea; }
  .btn.primary { background: var(--ink); color: #fff; }
  .btn.primary:hover { background: #2a3352; }
  .btn.ghost { background: transparent; border: 1px solid var(--line); }
  .btn.link { background: none; min-height: 0; padding: 0; text-transform: none; letter-spacing: 0; font-weight: 400; text-decoration: underline; text-underline-offset: 3px; }
  .btn[disabled] { opacity: .45; cursor: not-allowed; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .row.between { justify-content: space-between; }
  .row.center { justify-content: center; }

  .tabs { display: flex; justify-content: center; gap: 4px 28px; flex-wrap: wrap; border-bottom: 0; }
  .tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 10px 6px; font-weight: 600; font-size: 0.75rem;
    letter-spacing: .06em; text-transform: uppercase; color: var(--muted); cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
  .tab[aria-selected="true"] { color: var(--ink); border-color: var(--ink); }
  .tab svg { width: 16px; height: 16px; }

  .check { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; background: var(--ok); color: #fff; align-items: center; justify-content: center; flex: none; }
  .check svg { width: 11px; height: 11px; }
  .chosen { display: flex; gap: 10px; align-items: center; justify-content: center; font-weight: 600; }
  .addr-line { text-align: center; padding: 14px 0; border-bottom: 1px solid var(--line); font-size: 0.8125rem; letter-spacing: .02em; }
  .addr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .addr { text-align: left; border: 1px solid var(--line); background: #fff; padding: 14px 16px; min-height: 120px; cursor: pointer; line-height: 1.7; }
  .addr[aria-pressed="true"] { border-color: var(--ok); box-shadow: inset 0 0 0 1px var(--ok); }
  .addr.add { border-style: dashed; color: var(--ink); }
  .addr[disabled] { cursor: not-allowed; background: var(--panel); color: var(--muted); }

  form.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
  form.grid .full { grid-column: 1 / -1; }
  @container (max-width: 560px) { form.grid { grid-template-columns: 1fr; } }
  label { display: grid; gap: 6px; font-size: 0.75rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
  input, select, textarea { border: 0; border-bottom: 1px solid #c9cbd1; background: transparent; padding: 9px 2px; font-size: 0.8125rem;
    text-transform: none; letter-spacing: 0; font-weight: 400; border-radius: 0; }
  textarea { border: 1px solid #c9cbd1; padding: 10px 12px; min-height: 96px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--ink); }

  .slot-nav { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; }
  .slot-nav .mid { justify-self: center; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; font-size: 0.75rem; }
  .grid-scroll { overflow-x: auto; }
  table.slots { width: 100%; border-collapse: separate; border-spacing: 14px 10px; min-width: 640px; font-variant-numeric: tabular-nums; }
  table.slots th { font-weight: 600; font-size: 0.7812rem; padding: 0 0 4px; white-space: nowrap; }
  table.slots th.time { text-align: right; padding-right: 6px; width: 1%; }
  .cell { width: 100%; height: 44px; border: 1px solid #cfd1d6; background: #fff; cursor: pointer; font-size: 0.7812rem; }
  .cell:hover:not([disabled]) { border-color: var(--ink); }
  .cell[aria-pressed="true"] { border: 2px solid var(--sel); font-weight: 700; background: #fff; }
  .cell[disabled] { background: var(--panel); color: #b9bbc2; border-color: #eceef1; cursor: not-allowed; }
  .day-pills { display: none; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
  .pill { flex: none; border: 1px solid var(--line); background: #fff; padding: 8px 14px; cursor: pointer; font-weight: 600; font-size: 0.75rem; text-align: center; line-height: 1.3; }
  .pill[aria-pressed="true"] { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
  .list-slots { display: none; gap: 8px; }
  .list-slots .cell { display: flex; justify-content: space-between; align-items: center; padding: 0 16px; }
  @container (max-width: 700px) {
    .grid-scroll { display: none; }
    .day-pills { display: flex; }
    .list-slots { display: grid; }
    .slot-nav .btn { padding: 0 12px; font-size: 0.75rem; }
    .slot-nav .mid { text-align: center; font-size: 0.75rem; }
  }

  .chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  .chip { border: 1px solid var(--line); background: #fff; padding: 9px 16px; cursor: pointer; font-size: 0.75rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .chip[aria-pressed="true"] { background: var(--ink); color: #fff; border-color: var(--ink); }

  .summary { display: grid; grid-template-columns: max-content 1fr; gap: 10px 28px; max-width: 640px; margin: 0 auto; width: 100%; }
  .summary dt { font-weight: 600; font-size: 0.75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding-top: 1px; }
  .summary dd { margin: 0; }
  @container (max-width: 520px) { .summary { grid-template-columns: 1fr; gap: 2px; } .summary dd { margin-bottom: 10px; } }

  .notice { padding: 12px 16px; background: var(--panel); border-left: 2px solid var(--ink); }
  .error { padding: 12px 16px; background: #fbf0ef; border-left: 2px solid var(--err); color: var(--err); }
  .success { display: grid; gap: 14px; justify-items: center; text-align: center; padding: 20px 0; }
  .ref { font-size: 1.219rem; letter-spacing: .14em; font-weight: 600; }
  .loading { color: var(--muted); text-align: center; padding: 24px 0; }

  /* Account */
  .orders { display: grid; gap: 12px; }
  .order-row { display: grid; grid-template-columns: 1.1fr 1fr 1fr auto; gap: 12px; align-items: center; padding: 18px 20px; border: 1px solid var(--line);
    background: #fff; cursor: pointer; text-align: left; width: 100%; }
  .order-row:hover { border-color: var(--ink); }
  @container (max-width: 620px) { .order-row { grid-template-columns: 1fr auto; } .order-row .hide-sm { display: none; } }
  .status { display: inline-block; padding: 3px 10px; font-size: 0.75rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; background: var(--btn); white-space: nowrap; }
  .status.done { background: #e9f1e4; color: var(--ok); }
  .status.warn { background: #fbf0ef; color: var(--err); }
  .tracker { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0; list-style: none; padding: 0; margin: 0; counter-reset: s; }
  .tracker li { position: relative; padding-top: 22px; font-size: 0.75rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); text-align: center; }
  .tracker li::before { content: ""; position: absolute; top: 5px; left: 50%; width: 10px; height: 10px; border-radius: 50%; background: #fff; border: 2px solid #c9cbd1; transform: translateX(-50%); z-index: 1; }
  .tracker li::after { content: ""; position: absolute; top: 10px; left: -50%; width: 100%; height: 2px; background: #e2e3e6; }
  .tracker li:first-child::after { display: none; }
  .tracker li.on { color: var(--ink); }
  .tracker li.on::before { background: var(--ink); border-color: var(--ink); }
  .tracker li.on::after { background: var(--ink); }
  @container (max-width: 620px) {
    .tracker { grid-template-columns: 1fr; gap: 10px; }
    .tracker li { text-align: left; padding: 0 0 0 26px; }
    .tracker li::before { left: 6px; top: 4px; }
    .tracker li::after { display: none; }
  }
  table.items { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  table.items th, table.items td { text-align: left; padding: 11px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.items th { font-size: 0.75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  table.items td.num, table.items th.num { text-align: right; }
  .timeline { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
  .timeline li { display: grid; grid-template-columns: 150px 1fr; gap: 12px; }
  @container (max-width: 520px) { .timeline li { grid-template-columns: 1fr; gap: 0; } }
  .vault-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
  .vault-card { border: 1px solid var(--line); padding: 16px; display: grid; gap: 6px; background: #fff; cursor: pointer; text-align: left; }
  .vault-card[aria-pressed="true"] { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
  .vault-card[disabled] { cursor: default; background: var(--panel); }
  .tag { font-size: 0.75rem; letter-spacing: .1em; color: var(--muted); font-variant-numeric: tabular-nums; }
  .plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
  .plan { border: 1px solid var(--line); padding: 22px; display: grid; gap: 10px; align-content: start; text-align: center; background: #fff; }
  .plan .price { font-size: 0.9375rem; font-weight: 700; }
  .plan-includes { list-style: none; margin: 0; padding: 0; text-align: left; font-size: 0.75rem; display: grid; gap: 6px; border-top: 1px solid var(--line); padding-top: 10px; }
  .back { justify-self: start; }
  .wardrobe-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 22px 16px; }
  .wardrobe-card { display: grid; gap: 10px; align-content: start; }
  .wardrobe-pick { position: relative; display: block; width: 100%; padding: 0; border: 1px solid var(--line); background: var(--panel); cursor: pointer; }
  .wardrobe-pick[aria-pressed="true"] { border-color: var(--ink); box-shadow: inset 0 0 0 2px var(--ink); }
  .wardrobe-pick[disabled] { cursor: default; }
  .wardrobe-img { display: block; aspect-ratio: 3 / 4; }
  .wardrobe-img img { width: 100%; height: 100%; object-fit: contain; padding: 10%; }
  .wardrobe-pick .status { position: absolute; top: 10px; left: 10px; background: #fff; }
  .wardrobe-pick .tick { position: absolute; top: 10px; right: 10px; width: 22px; height: 22px; border: 1px solid #c9cbd1; background: #fff; display: grid; place-items: center; color: transparent; }
  .wardrobe-pick .tick svg { width: 12px; height: 12px; }
  .wardrobe-pick[aria-pressed="true"] .tick { background: var(--ink); border-color: var(--ink); color: #fff; }
  .wardrobe-card.busy .wardrobe-img { opacity: .55; }
  .wardrobe-body { display: grid; gap: 3px; }
  .wardrobe-body .row { gap: 14px; margin-top: 4px; }
  .rename { display: grid; gap: 8px; }
  .pieces { max-width: 640px; margin: 0 auto; width: 100%; display: grid; gap: 10px; }
  .piece-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .piece-list li { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
  `;

  const ICON = {
    check: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4v4.3l2.6 1.6" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
    pound: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 3.6A3 3 0 0 0 5.6 5.5V13M4 8.4h5.2M4 13h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  };

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (p) => "£" + (p / 100).toFixed(p % 100 ? 2 : 0);
  const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const DAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const parse = (iso) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  const hour = (iso) => { const d = parse(iso); const h = d.getHours(), m = d.getMinutes(); const hh = h % 12 || 12; return hh + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? "am" : "pm"); };
  const range = (a, b) => `${hour(a)} – ${hour(b)}`;
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addHours = (iso, h) => { const d = parse(iso); d.setHours(d.getHours() + h); return isoDay(d) + "T" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":00"; };
  const when = (b) => `${DAY_LONG.format(parse(b.starts_at))}, ${range(b.starts_at, b.ends_at)}`;

  /* Session: one per API + WordPress token, shared by every embed on the page. */
  const sessions = new Map();
  function session(api, wpToken) {
    const key = api + "|" + wpToken;
    if (!sessions.has(key)) {
      sessions.set(key, (async () => {
        const cacheKey = "lave-os:" + wpToken.slice(-24);
        try {
          const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
          if (cached && cached.exp > Date.now()) return cached;
        } catch (_) { /* storage unavailable */ }
        const res = await fetch(api + "/api/auth/wp-exchange", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: wpToken }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.detail || "We couldn't sign you in. Refresh the page.");
        const s = { token: body.token, client: body.client, exp: Date.now() + 11 * 3600e3 };
        try { sessionStorage.setItem(cacheKey, JSON.stringify(s)); } catch (_) { /* ignore */ }
        return s;
      })());
    }
    return sessions.get(key);
  }

  function errorText(body, status) {
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) return "Check the highlighted details and try again.";
    return status >= 500 ? "Something went wrong on our side. Try again in a moment." : "That didn't work. Try again.";
  }

  class LaveBase extends HTMLElement {
    connectedCallback() {
      if (this.root) return;
      this.root = this.attachShadow({ mode: "open" });
      this.api = (this.getAttribute("api") || "").replace(/\/$/, "");
      this.loginUrl = this.getAttribute("login-url") || "/my-account/";
      this.accountUrl = this.getAttribute("account-url") || "/my-account/";
      this.state = {};
      this.root.innerHTML = `<style>${CSS}</style><div class="wrap"><p class="loading">Loading…</p></div><slot name="card"></slot>`;
      this.view = this.root.querySelector(".wrap");
      this.boot();
    }

    async boot() {
      try {
        this.config = await this.call("GET", "/api/config", null, false);
        if (this.hasAttribute("same-origin")) {
          // On lavelondon.com itself: the httpOnly session cookie authenticates every call.
          this.sameOrigin = true;
          try { this.client = await this.call("GET", "/api/me"); }
          catch (e) { if (e.status === 401) return this.renderGuest(); throw e; }
          return await this.start();
        }
        const wpToken = this.getAttribute("token");
        if (!wpToken) return this.renderGuest();
        const s = await session(this.api, wpToken);
        this.token = s.token;
        this.client = s.client;
        this.client = await this.call("GET", "/api/me");
        await this.start();
      } catch (e) {
        this.view.innerHTML = `<div class="error">${esc(e.message)}</div>`;
      }
    }

    renderGuest() {
      this.view.innerHTML = `<div class="card stack center">
        <p class="eyebrow">LAVE Atelier</p>
        <h2>Sign in to continue</h2>
        <p class="muted">Sign in to your LAVE account to book a collection and follow your orders.</p>
        <div class="row center"><a class="btn primary" href="${esc(this.loginUrl)}">Sign in or register</a></div>
      </div>`;
    }

    async call(method, path, body, auth = true) {
      const headers = { "Content-Type": "application/json" };
      if (auth && this.token) headers.Authorization = "Bearer " + this.token;
      const res = await fetch(this.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined,
        credentials: this.sameOrigin ? "same-origin" : "omit" });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(errorText(data, res.status)), { status: res.status });
      return data;
    }

    /* What collection & delivery costs this client (labels for slot cells, notes under the pickers). */
    async loadTerms() {
      try { this.terms = await this.call("GET", "/api/me/delivery-terms"); }
      catch (_) { this.terms = { labels: {}, amounts: { saver: 0, hour: 0 } }; }
      return this.terms;
    }

    slotLabel(windowType) { return this.terms?.labels?.[windowType] || "Book"; }

    $(sel) { return this.root.querySelector(sel); }
    $$(sel) { return [...this.root.querySelectorAll(sel)]; }

    on(sel, evt, fn) { this.$$(sel).forEach((el) => el.addEventListener(evt, (e) => fn(e, el))); }

    async loadStripe() {
      if (!this.config.stripe_publishable_key) return null;
      if (!window.Stripe) {
        await new Promise((ok, fail) => {
          const s = document.createElement("script");
          s.src = "https://js.stripe.com/v3/";
          s.onload = ok; s.onerror = () => fail(new Error("Card form couldn't load. Check your connection and refresh."));
          document.head.appendChild(s);
        });
      }
      return window.Stripe(this.config.stripe_publishable_key);
    }

    /* Card form. Stripe Elements can't render inside a shadow root, so it mounts into a light-DOM slot. */
    async mountCard(container) {
      const stripe = await this.loadStripe();
      if (!stripe) return null;
      const { client_secret } = await this.call("POST", "/api/me/payment/setup-intent");
      let host = this.querySelector('[slot="card"]');
      if (!host) { host = document.createElement("div"); host.slot = "card"; this.appendChild(host); }
      host.innerHTML = "";
      host.style.cssText = "display:block;max-width:560px;margin:0 auto;";
      const elements = stripe.elements({ clientSecret: client_secret, appearance: {
        theme: "flat", variables: { colorText: "#192033", colorPrimary: "#192033", fontFamily: "Century Gothic, Arial, sans-serif", borderRadius: "0px", colorBackground: "#f9f9f9" },
      } });
      const el = elements.create("payment", { layout: "tabs" });
      el.mount(host);
      // Place the slot where the card belongs in the flow (re-renders may have removed it).
      let slot = this.root.querySelector('slot[name="card"]');
      if (!slot) { slot = document.createElement("slot"); slot.name = "card"; }
      container.appendChild(slot);
      return {
        confirm: async () => {
          const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
          if (error) throw new Error(error.message);
          this.client = await this.call("POST", "/api/me/payment/card-saved", { setup_intent_id: setupIntent.id });
        },
        unmount: () => { el.destroy(); host.remove(); },
      };
    }
  }

  /* Week grid of slots, shared by booking and Vault returns. */
  class SlotPicker {
    constructor(owner, el, { mode, windowType = "hour", after = null, onPick, allowWindowChoice = true, note = () => "", priced = true }) {
      Object.assign(this, { owner, el, mode, windowType, after, onPick, allowWindowChoice, note, priced });
      const base = after ? parse(after) : new Date();
      this.weekStart = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      this.selected = null;
      this.mobileDay = null;
      this.load();
    }

    async load() {
      this.el.innerHTML = `<p class="loading">Finding available times…</p>`;
      const q = new URLSearchParams({ start: isoDay(this.weekStart), days: "5", window: this.windowType, mode: this.mode });
      if (this.after) q.set("after", this.after);
      try {
        this.slots = await this.owner.call("GET", "/api/slots?" + q, null, false);
      } catch (e) {
        this.el.innerHTML = `<div class="error">${esc(e.message)}</div>`;
        return;
      }
      this.render();
    }

    render() {
      const days = [...Array(5)].map((_, i) => addDays(this.weekStart, i));
      const byKey = new Map(this.slots.map((s) => [s.day + "|" + s.starts_at.slice(11, 16), s]));
      const times = [...new Set(this.slots.map((s) => s.starts_at.slice(11, 16) + "|" + s.ends_at.slice(11, 16)))].sort();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const horizon = addDays(today, this.owner.config.booking_horizon_days);
      const canPrev = this.weekStart > today && (!this.after || this.weekStart > parse(this.after.slice(0, 10)));
      const canNext = addDays(this.weekStart, 5) <= horizon;
      const sel = this.selected;
      const isSel = (s) => sel && sel.template_id === s.template_id && sel.day === s.day;
      // A return is covered by the booking's single charge, so its cells don't repeat a price (the notes explain).
      const price = this.priced ? this.owner.slotLabel(this.windowType) : "Available";
      const cell = (s, label) => s
        ? `<button class="cell" data-key="${s.template_id}|${s.day}" aria-pressed="${isSel(s)}" ${s.available ? "" : "disabled"}
             aria-label="${esc(DAY_LONG.format(parse(s.day)) + ", " + range(s.starts_at, s.ends_at) + (s.available ? ", " + price : ", full"))}">${label ?? (s.available ? esc(price) : "Full")}</button>`
        : `<button class="cell" disabled aria-label="Not available">–</button>`;

      const windowTabs = this.allowWindowChoice && this.mode === "lave_collects" ? `
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-window="hour" aria-selected="${this.windowType === "hour"}">${ICON.clock} 1 hour</button>
          <button class="tab" role="tab" data-window="saver" aria-selected="${this.windowType === "saver"}">${ICON.pound} Saver</button>
        </div>
        <p class="center muted">${this.windowType === "hour"
          ? "Perfect if you need us within a one-hour window. On the day, we'll text you when the driver is close."
          : this.priced ? "A wider three-hour window, free from £45. We'll text you when the driver is close."
            : "A wider three-hour window. We'll text you when the driver is close."}</p>` : "";

      const visibleDays = days.filter((d) => d <= horizon);
      if (!this.mobileDay || !visibleDays.some((d) => isoDay(d) === this.mobileDay)) {
        const firstWithSlot = visibleDays.find((d) => this.slots.some((s) => s.day === isoDay(d) && s.available));
        this.mobileDay = isoDay(firstWithSlot || visibleDays[0] || days[0]);
      }
      const mobileSlots = this.slots.filter((s) => s.day === this.mobileDay);

      this.el.innerHTML = `
        ${windowTabs}
        <div class="slot-nav">
          <button class="btn" data-nav="-1" ${canPrev ? "" : "disabled"}>&lt; Previous</button>
          <span class="mid">${DAY.format(days[0])} – ${DAY.format(days[4])}</span>
          <button class="btn" data-nav="1" ${canNext ? "" : "disabled"}>Next &gt;</button>
        </div>
        ${times.length ? `
        <div class="grid-scroll">
          <table class="slots">
            <thead><tr><th class="time"><span hidden>Time</span></th>${days.map((d) => `<th scope="col">${DAY.format(d)}</th>`).join("")}</tr></thead>
            <tbody>${times.map((t) => {
              const [a, b] = t.split("|");
              const rowSlot = this.slots.find((s) => s.starts_at.slice(11, 16) === a);
              return `<tr><th class="time" scope="row">${range(rowSlot.starts_at, rowSlot.ends_at)}</th>${days.map((d) => `<td>${cell(byKey.get(isoDay(d) + "|" + a))}</td>`).join("")}</tr>`;
            }).join("")}</tbody>
          </table>
        </div>
        <div class="day-pills">${visibleDays.map((d) => `<button class="pill" data-day="${isoDay(d)}" aria-pressed="${isoDay(d) === this.mobileDay}">${DAY.format(d).replace(" ", "<br>")}</button>`).join("")}</div>
        <div class="list-slots">${mobileSlots.length ? mobileSlots.map((s) => cell(s, `<span>${range(s.starts_at, s.ends_at)}</span><span>${s.available ? esc(price) : "Full"}</span>`)).join("") : `<p class="muted center">No times left on this day.</p>`}</div>`
        : `<p class="notice center">No times are open this week. Try the next week.</p>`}
        ${this.note(this.windowType) ? `<div class="stack center">${this.note(this.windowType)}</div>` : ""}
      `;

      this.el.querySelectorAll("[data-window]").forEach((b) => b.addEventListener("click", () => {
        this.windowType = b.dataset.window; this.selected = null; this.onPick(null); this.load();
      }));
      this.el.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => {
        this.weekStart = addDays(this.weekStart, 5 * Number(b.dataset.nav)); this.mobileDay = null; this.load();
      }));
      this.el.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => { this.mobileDay = b.dataset.day; this.render(); }));
      this.el.querySelectorAll(".cell[data-key]").forEach((b) => b.addEventListener("click", () => {
        const [tid, day] = b.dataset.key.split("|");
        this.selected = this.slots.find((s) => s.template_id === Number(tid) && s.day === day);
        this.render();
        this.onPick(this.selected);
      }));
    }
  }

  const BAG = [
    ["laundry", "Laundry"], ["dry_cleaning", "Dry cleaning"], ["pressing", "Pressing"], ["home", "Bedding & home"],
    ["delicates", "Delicates"], ["vault", "Vault storage"], ["repairs", "Repairs"],
  ];

  /* Address chooser with inline add form. Only addresses in LAVE's area can be chosen; others offer the waitlist. */
  const inZone = (a) => a && a.in_zone !== false;

  function addressBlock(owner, el, { selectedId, onChange, purpose = "collect" }) {
    const verb = purpose === "deliver" ? "deliver" : "collect";
    let open = false, adding = false, waitlist = null;
    const draw = () => {
      const list = owner.client.addresses;
      const chosen = list.find((a) => a.id === selectedId && inZone(a));
      if (waitlist) return drawWaitlist();
      el.innerHTML = `
        ${chosen ? `<p class="chosen"><span class="check">${ICON.check}</span> The address where we'll ${verb} your items</p>
          <p class="addr-line">${esc(chosen.one_line)}</p>
          <div class="row center"><button class="btn link" data-toggle aria-expanded="${open}">Change address ▾</button></div>`
        : `<p class="center muted">Add the address where we should ${verb} your items.</p>`}
        ${(open || !chosen) && !adding ? `<div class="addr-grid">
          ${list.map((a) => `<button class="addr" data-addr="${a.id}" aria-pressed="${a.id === selectedId && inZone(a)}" ${inZone(a) ? "" : "disabled"}><strong>${esc(a.label)}</strong><br>${esc(a.line1)}${a.line2 ? ", " + esc(a.line2) : ""}<br>${esc(a.city)}, ${esc(a.postcode)}${inZone(a) ? "" : `<br><span class="small">Not yet in our area</span>`}</button>`).join("")}
          <button class="addr add" data-add>+ Add an address</button></div>` : ""}
        ${adding ? `<form class="grid" novalidate>
          <label>Label<input name="label" value="Home" maxlength="60"></label>
          <label>Postcode<input name="postcode" required autocomplete="postal-code" maxlength="12"></label>
          <label class="full">Address line 1<input name="line1" required autocomplete="address-line1"></label>
          <label class="full">Address line 2<input name="line2" autocomplete="address-line2"></label>
          <label>City<input name="city" value="London" autocomplete="address-level2"></label>
          <label class="full">Access notes for the driver<textarea name="instructions" placeholder="Concierge, door code, safe place…"></textarea></label>
          <div class="full row"><button class="btn primary" type="submit">Save address</button><button class="btn ghost" type="button" data-cancel>Cancel</button></div>
          <p class="full error" hidden></p>
        </form>` : ""}`;
      el.querySelector("[data-toggle]")?.addEventListener("click", () => { open = !open; draw(); });
      el.querySelectorAll("[data-addr]").forEach((b) => b.addEventListener("click", () => {
        selectedId = Number(b.dataset.addr); open = false; draw(); onChange(selectedId);
      }));
      el.querySelector("[data-add]")?.addEventListener("click", () => { adding = true; draw(); el.querySelector("input[name=postcode]").focus(); });
      el.querySelector("[data-cancel]")?.addEventListener("click", () => { adding = false; draw(); });
      el.querySelector("form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const body = Object.fromEntries(f.entries());
        const err = e.target.querySelector(".error");
        if (!body.line1.trim() || !body.postcode.trim()) { err.textContent = "Enter the first line of the address and the postcode."; err.hidden = false; return; }
        try {
          const a = await owner.call("POST", "/api/me/addresses", body);
          owner.client = await owner.call("GET", "/api/me");
          adding = false; open = false;
          if (!inZone(a)) {
            const check = await owner.call("GET", "/api/area/check?postcode=" + encodeURIComponent(a.postcode), null, false);
            waitlist = { postcode: a.postcode, message: check.message, services: [] };
            return draw();
          }
          selectedId = a.id; draw(); onChange(selectedId);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
    const drawWaitlist = () => {
      const c = owner.client, w = waitlist;
      el.innerHTML = w.done
        ? `<p class="notice center">${esc(w.done)}</p><div class="row center"><button class="btn link" data-back>Choose another address</button></div>`
        : `<p class="notice">${esc(w.message)}</p>
          <form class="grid" novalidate>
            <label>Name<input name="name" required value="${esc(c.full_name || "")}" autocomplete="name"></label>
            <label>Email<input name="email" type="email" required value="${esc(c.email || "")}" autocomplete="email"></label>
            <label>Phone<input name="phone" value="${esc(c.phone || "")}" autocomplete="tel"></label>
            <label>Postcode<input name="postcode" required value="${esc(w.postcode)}" autocomplete="postal-code"></label>
            <div class="full stack"><span class="small muted">What would you like us to care for?</span>
              <div class="chips">${BAG.map(([k, l]) => `<button type="button" class="chip" data-svc="${l}" aria-pressed="${w.services.includes(l)}">${l}</button>`).join("")}</div></div>
            <div class="full row"><button class="btn primary" type="submit">Join the waitlist</button><button class="btn ghost" type="button" data-back>Choose another address</button></div>
            <p class="full error" hidden></p>
          </form>`;
      el.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { waitlist = null; draw(); }));
      el.querySelectorAll("[data-svc]").forEach((b) => b.addEventListener("click", () => {
        const v = b.dataset.svc;
        w.services = w.services.includes(v) ? w.services.filter((x) => x !== v) : [...w.services, v];
        b.setAttribute("aria-pressed", String(w.services.includes(v)));
      }));
      el.querySelector("form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = { ...Object.fromEntries(new FormData(e.target).entries()), services: w.services };
        try { w.done = (await owner.call("POST", "/api/area/waitlist", body, false)).message; drawWaitlist(); }
        catch (ex) { const err = e.target.querySelector(".error"); err.textContent = ex.message; err.hidden = false; }
      });
    };
    draw();
  }

  /* Under the return calendar: one charge covers both legs, so say what (if anything) the return changes. */
  function returnChargeNote(t, collectedHour, windowType, knowSaver = true) {
    const saver = t.amounts?.saver || 0, hour = t.amounts?.hour || 0;
    if (collectedHour || windowType !== "hour" || hour === saver) return "One charge covers both collection and return, so your return adds nothing.";
    const instead = !knowSaver ? "" : saver ? ` instead of ${money(saver)}` : t.level ? " instead of being included with your membership" : " instead of free";
    return `A one-hour return makes your single collection and delivery charge ${money(hour)}${instead}, once for both.`;
  }

  const DATE_HOURS = (d) => `${DAY_LONG.format(parse(d.day))}, ${hour(d.day + "T" + d.opens)}–${hour(d.day + "T" + d.closes)}`;

  class LaveBooking extends LaveBase {
    async start() {
      await this.loadTerms();
      this.ateliers = this.terms.dropoff ? await this.call("GET", "/api/me/ateliers?days=" + this.config.booking_horizon_days).catch(() => []) : [];
      // Minimum order: a list under the home minimum can still go to a drop-off if it reaches that minimum.
      // (Wardrobe pieces sent again also count, so with those the server checks.)
      const m = this.terms.minimum || {}, sending = !!this.getAttribute("items");
      this.homeShort = m.applies && !sending ? m.home_short_pence || 0 : 0;
      const dropShort = m.applies && !sending ? m.dropoff_short_pence || 0 : 0;
      if (this.homeShort && (!this.ateliers.length || dropShort)) {
        this.view.innerHTML = `<div class="card stack center"><p class="notice">${esc(this.shortText(this.homeShort, "home"))}</p>
          <div class="row center"><a class="btn primary" href="/atelier/list/">Add to your list</a></div></div>`;
        return;
      }
      const usable = this.client.addresses.filter(inZone);
      const def = usable.find((a) => a.is_default) || usable[0];
      const wantsDropoff = (this.getAttribute("mode") === "drop_off" || this.homeShort) && this.ateliers.length;
      this.state = { mode: wantsDropoff ? "atelier" : "lave_collects", addressId: def?.id ?? null, collection: null,
                     dropoff: null, ready: null, delivery: null, arrangeLater: false,
                     returnPref: this.terms.longer_items?.length ? "together" : "", bag: [], notes: "", pieces: [] };
      const wanted = (this.getAttribute("items") || "").split(",").map(Number).filter(Boolean);
      if (wanted.length) {
        try {
          const wardrobe = await this.call("GET", "/api/me/wardrobe");
          this.state.pieces = wardrobe.filter((w) => wanted.includes(w.id));
        } catch (_) { /* booking still works without them */ }
      }
      this.renderFlow();
    }

    get collected() { return this.state.mode === "atelier" ? !!this.state.dropoff?.day : !!this.state.collection; }

    shortText(short, mode) {
      const m = this.terms.minimum;
      return mode === "home"
        ? `Add ${money(short)} more to your list to book a home collection: the minimum order is ${money(m.home_pence)}.`
        : `Add ${money(short)} more to your list to book a drop-off: the minimum order is ${money(m.dropoff_pence)}.`;
    }

    /* Booked without a list: the minimum order is charged at review if the counted items come to less. */
    minimumText() {
      const m = this.terms.minimum || {};
      if (!m.applies || m.has_list) return "";
      const min = money(this.state.mode === "atelier" ? m.dropoff_pence : m.home_pence);
      return `Minimum order ${min}: if your items come to less once our atelier has counted them, we'll charge ${min} for them.`;
    }

    renderFlow() {
      const s = this.state, t = this.terms;
      const needsCard = !!this.config.stripe_publishable_key && !this.client.has_card_on_file;
      const atelier = s.mode === "atelier";
      this.view.innerHTML = `
        <div class="card stack">
          ${this.ateliers.length ? `<div class="tabs" role="tablist" aria-label="How should we receive your items?">
            <button class="tab" role="tab" data-mode="lave_collects" aria-selected="${!atelier}">LAVE collects</button>
            <button class="tab" role="tab" data-mode="atelier" aria-selected="${atelier}">Drop off at a LAVE atelier</button>
          </div>` : ""}
          <div id="address" ${atelier ? "hidden" : ""}></div>
          <p class="center muted" ${atelier ? "" : "hidden"}>Leave your items with us at a time that suits you. Choose a location and day, and we'll deliver everything back to you.</p>
        </div>
        <section class="stack">
          <div class="section-head"><p class="eyebrow">${atelier ? "Drop-off" : "Collection"}</p><p>${atelier ? "Choose an atelier and a day." : "Select a convenient time for LAVE to pick up your items."}</p></div>
          <div id="collect" class="stack"></div>
        </section>
        <section class="stack" id="return-section" ${this.collected ? "" : "hidden"}>
          <div class="section-head"><p class="eyebrow">Return</p><p>When should we bring everything back?</p></div>
          ${t.longer_items?.length ? `<p class="notice">${esc(t.longer_note)}</p>
          <div class="chips">
            <button class="chip" data-pref="together" aria-pressed="${s.returnPref === "together"}">Return together</button>
            <button class="chip" data-pref="split" aria-pressed="${s.returnPref === "split"}">Split return</button>
          </div>` : ""}
          <div id="return-address" ${atelier ? "" : "hidden"}></div>
          <div class="tabs" role="tablist" id="return-tabs">
            <button class="tab" role="tab" data-return="lave_collects" aria-selected="${!s.arrangeLater}">LAVE delivers</button>
            <button class="tab" role="tab" data-return="later" aria-selected="${s.arrangeLater}">Arrange later</button>
          </div>
          <div id="deliver" class="stack"></div>
        </section>
        <section class="stack" id="details" ${this.collected ? "" : "hidden"}>
          <div class="section-head"><p class="eyebrow">Your items</p><p>What are you sending? This helps us prepare. We itemise and price everything when it arrives.</p></div>
          ${s.pieces.length ? `<div class="pieces" id="pieces"></div>` : ""}
          <div class="chips">${BAG.map(([k, l]) => `<button class="chip" data-bag="${k}" aria-pressed="${s.bag.includes(k)}">${l}</button>`).join("")}</div>
          ${this.client.phone ? "" : `<label style="max-width:640px;margin:0 auto;width:100%">Your mobile number
            <input id="phone" type="tel" autocomplete="tel" placeholder="07700 900123" value="${esc(s.phone || "")}" required></label>
            <p class="center muted small">We text you when your driver is on the way.</p>`}
          <label style="max-width:640px;margin:0 auto;width:100%">Notes for the atelier
            <textarea id="notes" maxlength="2000" placeholder="Stains, delicate trims, a date you need something back by…">${esc(s.notes)}</textarea></label>
        </section>
        <section class="stack" id="pay" ${this.collected && needsCard ? "" : "hidden"}>
          <div class="section-head"><p class="eyebrow">Payment</p><p>Add a card for your booking. We keep it safely with Stripe for any difference after our atelier has checked your items.</p></div>
          <div id="card-mount"></div>
        </section>
        <section class="stack" id="confirm" ${this.collected ? "" : "hidden"}>
          <dl class="summary" id="summary"></dl>
          <p class="center muted small" style="max-width:640px;margin:0 auto">${esc(t.booking_wording || "")}${this.minimumText() ? " " + esc(this.minimumText()) : ""}</p>
          ${t.start_now_wording ? `<p class="center muted small" style="max-width:640px;margin:0 auto">${esc(t.start_now_wording)} <a href="/policies/cancellation/">Cancellation policy</a></p>` : ""}
          <p class="error" id="book-error" hidden></p>
          <div class="row center"><button class="btn primary" id="book">Confirm booking</button></div>
        </section>`;

      this.on("[data-mode]", "click", (_, b) => {
        if (s.mode === b.dataset.mode) return;
        Object.assign(s, { mode: b.dataset.mode, collection: null, dropoff: null, ready: null, delivery: null });
        this.renderFlow();
      });
      this.on("[data-return]", "click", (_, b) => {
        s.arrangeLater = b.dataset.return === "later";
        s.delivery = null;
        this.$$("[data-return]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        this.drawDelivery();
        this.drawSummary();
      });
      this.on("[data-pref]", "click", (_, b) => {
        s.returnPref = b.dataset.pref; s.delivery = null;
        this.$$("[data-pref]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this.drawDelivery();
        this.drawSummary();
      });
      this.on("[data-bag]", "click", (_, b) => {
        const k = b.dataset.bag;
        s.bag = s.bag.includes(k) ? s.bag.filter((x) => x !== k) : [...s.bag, k];
        b.setAttribute("aria-pressed", String(s.bag.includes(k)));
      });
      this.$("#notes").addEventListener("input", (e) => { s.notes = e.target.value; });
      this.$("#phone")?.addEventListener("input", (e) => { s.phone = e.target.value; });
      if (s.pieces.length) this.drawPieces();
      this.$("#book").addEventListener("click", () => this.submit());

      const onAddress = (id) => { s.addressId = id; this.drawSummary(); };
      if (atelier) {
        addressBlock(this, this.$("#return-address"), { selectedId: s.addressId, purpose: "deliver", onChange: onAddress });
        this.drawDropoff();
      } else {
        addressBlock(this, this.$("#address"), { selectedId: s.addressId, onChange: onAddress });
        if (this.homeShort) {
          this.$("#collect").innerHTML = `<p class="notice center">${esc(this.shortText(this.homeShort, "home"))} Or drop off at a LAVE atelier.</p>
            <div class="row center"><a class="btn" href="/atelier/list/">Add to your list</a></div>`;
          return;
        }
        this.collectPicker = new SlotPicker(this, this.$("#collect"), {
          mode: "lave_collects", onPick: (slot) => { s.collection = slot; this.collectionChanged(); },
        });
      }
      if (this.collected) { this.drawDelivery(); this.drawSummary(); }
    }

    /* Atelier drop-off: a location card, then a day it's open, then how many bags. */
    drawDropoff() {
      const s = this.state, el = this.$("#collect");
      const loc = this.ateliers.find((a) => a.id === s.dropoff?.atelier_id);
      const date = loc?.dates.find((d) => d.day === s.dropoff?.day);
      el.innerHTML = `
        <div class="addr-grid">${this.ateliers.map((a) => `<button class="addr" data-atelier="${a.id}" aria-pressed="${a.id === loc?.id}">
          <strong>${esc(a.name)}</strong><br>${esc(a.address)}${a.postcode ? ", " + esc(a.postcode) : ""}<br><span class="muted small">Open ${esc(a.hours_text)}</span></button>`).join("")}</div>
        ${loc ? `<div class="day-pills" style="display:flex;flex-wrap:wrap;justify-content:center">${loc.dates.map((d) => `<button class="pill" data-dday="${d.day}" aria-pressed="${d.day === date?.day}" ${d.full ? "disabled" : ""}>${DAY.format(parse(d.day)).replace(" ", "<br>")}${d.full ? "<br>Full" : ""}</button>`).join("")}</div>` : ""}
        ${date ? `<p class="notice">${esc(loc.name)} · ${esc(loc.address)}${loc.postcode ? ", " + esc(loc.postcode) : ""} · Open ${esc(DATE_HOURS(date))}${loc.access_instructions ? " · " + esc(loc.access_instructions) : ""}${loc.map_link ? ` · <a href="${esc(loc.map_link)}" target="_blank" rel="noopener">Map</a>` : ""}</p>
          <label style="max-width:240px;margin:0 auto;width:100%">Bags<select id="bags">${[...Array(10)].map((_, i) => `<option ${i + 1 === (s.dropoff.bags || 1) ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>
          <p class="center muted small">We'll give each bag its own label code when you confirm.</p>` : ""}`;
      el.querySelectorAll("[data-atelier]").forEach((b) => b.addEventListener("click", () => {
        s.dropoff = { atelier_id: Number(b.dataset.atelier), day: null, bags: s.dropoff?.bags || 1 };
        s.ready = null; s.delivery = null;
        this.drawDropoff(); this.showLater();
      }));
      el.querySelectorAll("[data-dday]").forEach((b) => b.addEventListener("click", () => {
        s.dropoff = { ...s.dropoff, day: b.dataset.dday };
        this.drawDropoff(); this.collectionChanged();
      }));
      el.querySelector("#bags")?.addEventListener("change", (e) => { s.dropoff.bags = Number(e.target.value); this.drawSummary(); });
    }

    async collectionChanged() {
      const s = this.state;
      s.delivery = null; s.ready = null;
      this.showLater();
      if (!this.collected) return;
      const q = s.mode === "atelier" ? `atelier_id=${s.dropoff.atelier_id}&day=${s.dropoff.day}` : `collection_end=${encodeURIComponent(s.collection.ends_at)}`;
      try { s.ready = await this.call("GET", "/api/me/earliest-return?" + q); }
      catch (_) { s.ready = null; }
      this.drawDelivery(); this.ensureCard(); this.drawSummary();
    }

    showLater() {
      const on = this.collected, needsCard = !!this.config.stripe_publishable_key && !this.client.has_card_on_file;
      ["#return-section", "#details", "#confirm"].forEach((id) => { this.$(id).hidden = !on; });
      this.$("#pay").hidden = !(on && needsCard);
    }

    drawPieces() {
      const s = this.state, el = this.$("#pieces");
      if (!el) return;
      const est = s.pieces.reduce((t, p) => t + (p.service?.price_pence || 0), 0);
      el.innerHTML = s.pieces.length ? `
        <p class="eyebrow center">From your Wardrobe</p>
        <ul class="piece-list">${s.pieces.map((p) => `<li><span>${esc(p.title)}<br><span class="muted small">${esc(p.service?.name || "")}</span></span>
          <span>${p.service ? money(p.service.price_pence) : ""} <button class="btn link" data-unpiece="${p.id}" aria-label="Remove ${esc(p.title)}">Remove</button></span></li>`).join("")}</ul>
        ${est ? `<p class="center muted small">About ${money(est)} at last visit's prices. We confirm the total after inspection.</p>` : ""}`
        : `<p class="center muted small">No Wardrobe pieces selected.</p>`;
      el.querySelectorAll("[data-unpiece]").forEach((b) => b.addEventListener("click", () => {
        s.pieces = s.pieces.filter((p) => p.id !== Number(b.dataset.unpiece)); this.drawPieces();
      }));
    }

    drawDelivery() {
      const s = this.state, t = this.terms, el = this.$("#deliver");
      if (!el || !this.collected) return;
      const together = s.returnPref === "together";
      this.$("#return-tabs").hidden = together;
      if (together) { el.innerHTML = `<p class="center muted">We'll bring everything back together once it's all ready, and confirm the date after we've inspected your items.</p>`; return; }
      if (s.arrangeLater) { el.innerHTML = `<p class="center muted">Book a return from your account once your order is ready.</p>`; return; }
      const collectedHour = s.mode === "lave_collects" && s.collection?.window_type === "hour";
      const note = (windowType) => [
        s.ready ? `<p class="muted">${esc(s.ready.text)}</p>` : "",
        s.returnPref === "split" ? `<p class="muted small">Your 48-hour items come back in this slot. We'll confirm a date for the rest after we've inspected them.</p>` : "",
        !t.level && windowType === "saver" && t.to_free_pence > 0 && !collectedHour ? `<p class="small">Add ${money(t.to_free_pence)} more for free Saver collection and delivery.</p>` : "",
        `<p class="muted small">${esc(returnChargeNote(t, collectedHour, windowType))}</p>`,
      ].join("");
      new SlotPicker(this, el, {
        mode: "lave_collects", after: s.ready?.earliest_return || null, note, priced: false,
        windowType: s.mode === "lave_collects" ? s.collection.window_type : "saver",
        onPick: (slot) => { s.delivery = slot; this.drawSummary(); },
      });
    }

    async ensureCard() {
      if (this.card || this.$("#pay").hidden) return;
      try {
        this.card = await this.mountCard(this.$("#card-mount"));
      } catch (e) {
        this.$("#card-mount").innerHTML = `<div class="error">${esc(e.message)}</div>`;
      }
    }

    chargePence() {
      const s = this.state, t = this.terms;
      const oneHour = (s.mode === "lave_collects" && s.collection?.window_type === "hour") || s.delivery?.window_type === "hour";
      return t.amounts?.[oneHour ? "hour" : "saver"] || 0;
    }

    chargeText() {
      const fee = this.chargePence();
      return fee ? money(fee) : this.terms.level ? "Included with your membership" : "Free";
    }

    /* Paid at booking: fixed-price items and the collection & delivery charge, less any LAVE account credit. */
    dueNow() {
      const t = this.terms, due = (t.items_fixed_pence || 0) + this.chargePence();
      const credit = Math.min(t.credit_pence || 0, due);
      return { credit, pay: due - credit };
    }

    drawSummary() {
      const s = this.state, t = this.terms, el = this.$("#summary");
      if (!el || !this.collected) return;
      const due = this.dueNow();
      const addr = this.client.addresses.find((a) => a.id === s.addressId && inZone(a));
      const loc = this.ateliers.find((a) => a.id === s.dropoff?.atelier_id);
      const date = loc?.dates.find((d) => d.day === s.dropoff?.day);
      const together = s.returnPref === "together";
      el.innerHTML = s.mode === "atelier"
        ? `<dt>Drop-off</dt><dd>${esc(loc.name)}<br><span class="muted small">${esc(DATE_HOURS(date))} · ${s.dropoff.bags} bag${s.dropoff.bags > 1 ? "s" : ""}</span></dd>`
        : `<dt>Collection</dt><dd>${esc(DAY_LONG.format(parse(s.collection.day)))}, ${range(s.collection.starts_at, s.collection.ends_at)}<br><span class="muted small">${esc(addr?.one_line || "Choose an address above")}</span></dd>`;
      el.innerHTML += `
        <dt>Return</dt><dd>${together ? "Together, once everything is ready" : s.arrangeLater ? "Arrange later" : s.delivery ? `${esc(DAY_LONG.format(parse(s.delivery.day)))}, ${range(s.delivery.starts_at, s.delivery.ends_at)}<br><span class="muted small">${esc(s.mode === "atelier" ? (addr?.one_line || "Choose an address above") : "Delivered to the same address")}</span>` : `<span class="muted">Choose a time above</span>`}</dd>
        ${t.items_fixed_pence || t.priced_later ? `<dt>Your items</dt><dd>${money(t.items_fixed_pence || 0)}${t.priced_later ? `<br><span class="muted small">plus ${t.priced_later} priced after inspection</span>` : ""}</dd>` : ""}
        <dt>Collection and delivery</dt><dd>${esc(this.chargeText())}</dd>
        ${due.credit ? `<dt>Account credit</dt><dd>−${money(due.credit)}</dd>` : ""}
        <dt>To pay now</dt><dd><strong>${money(due.pay)}</strong></dd>
        ${this.client.membership?.status === "active" ? `<dt>Membership</dt><dd>${esc(this.client.membership.plan_name)}</dd>` : ""}`;
      const btn = this.$("#book");
      if (btn && !btn.disabled) btn.textContent = due.pay ? `Pay ${money(due.pay)} and book` : "Confirm booking";
    }

    async submit() {
      const s = this.state, err = this.$("#book-error"), btn = this.$("#book");
      err.hidden = true;
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      const together = s.returnPref === "together";
      const withReturn = !together && !s.arrangeLater;
      if (s.mode === "lave_collects" && !s.addressId) return fail("Add the address where we should collect your items.");
      if (!this.client.phone && !(s.phone || "").trim()) return fail("Add your mobile number, so your driver can text you when they're on the way.");
      if (s.mode === "atelier" && !s.dropoff?.day) return fail("Choose an atelier and a day to drop off.");
      if (withReturn && !s.delivery) return fail("Choose a return time, or pick “Arrange later”.");
      if (withReturn && !s.addressId) return fail("Add the address for your delivery.");

      btn.disabled = true; btn.textContent = "Booking…";
      try {
        if (this.card && !this.client.has_card_on_file) await this.card.confirm();
        const order = await this.call("POST", "/api/me/bookings", {
          collection: s.mode === "lave_collects" ? { template_id: s.collection.template_id, day: s.collection.day } : null,
          dropoff: s.mode === "atelier" ? { atelier_id: s.dropoff.atelier_id, day: s.dropoff.day, bags: s.dropoff.bags || 1 } : null,
          delivery: withReturn ? { template_id: s.delivery.template_id, day: s.delivery.day } : null,
          address_id: s.addressId, return_preference: s.returnPref, requested_services: s.bag, notes: s.notes,
          wardrobe_item_ids: s.pieces.map((p) => p.id), phone: this.client.phone ? "" : (s.phone || ""),
        });
        let done = order;
        if (order.payment?.status === "requires_action") {
          // The bank wants to confirm the payment (3D Secure).
          btn.textContent = "Confirming with your bank…";
          const stripe = await this.loadStripe();
          const { error } = await stripe.handleNextAction({ clientSecret: order.payment.client_secret });
          done = await this.call("POST", `/api/me/orders/${encodeURIComponent(order.ref)}/booking-payment`);
          if (error && done.payment?.status !== "paid") throw new Error(error.message);
        }
        this.card?.unmount();
        this.card = null;
        this.renderDone(done);
      } catch (e) {
        btn.disabled = false;
        this.drawSummary();
        fail(e.message);
        if (e.status === 409 && this.collectPicker) this.collectPicker.load();
      }
    }

    renderDone(order) {
      const coll = order.bookings.find((b) => b.kind === "collection");
      const del = order.bookings.find((b) => b.kind === "delivery");
      const ready = this.state.ready;
      this.view.innerHTML = `<div class="card success">
        <span class="check" style="width:34px;height:34px">${ICON.check}</span>
        <p class="eyebrow">Booking confirmed</p>
        <p class="ref">${esc(order.ref)}</p>
        <dl class="summary">
          ${coll.atelier ? `<dt>Drop-off</dt><dd>${esc(coll.atelier.name)}<br><span class="muted small">${esc(when(coll))}</span></dd>
            <dt>Bag labels</dt><dd>${coll.bag_codes.map(esc).join(", ")}</dd>`
            : `<dt>Collection</dt><dd>${esc(when(coll))}</dd>`}
          <dt>Return</dt><dd>${del ? esc(when(del)) : order.return_preference === "together" ? "Together, once everything is ready" : "To arrange from your account"}</dd>
          <dt>Collection and delivery</dt><dd>${order.fees_pence ? money(order.fees_pence) : this.terms.level ? "Included with your membership" : "Free"}</dd>
          ${order.paid_pence ? `<dt>Paid now</dt><dd>${money(order.paid_pence)}</dd>` : ""}
          ${order.credit_used_pence ? `<dt>Account credit used</dt><dd>${money(order.credit_used_pence)}</dd>` : ""}
        </dl>
        <p class="muted">${coll.atelier ? `Label each bag with its code. ${ready ? esc(ready.text.replace(" Choose any time from then.", "")) : ""}`
          : "We'll text you on the day when the driver is close. You can follow every item from your account."}</p>
        <div class="row center"><a class="btn primary" href="${esc(this.accountUrl)}">View my orders</a><button class="btn" id="again">${coll.atelier ? "Book another drop-off" : "Book another collection"}</button></div>
      </div>`;
      this.$("#again").addEventListener("click", () => this.start());
    }
  }

  const STAGES = [
    ["awaiting_collection", "Booked"], ["collected", "Collected"], ["inspected", "Inspected"], ["in_care", "In care"],
    ["quality_check", "Quality check"], ["ready", "Ready"], ["delivered", "Delivered"],
  ];
  const stageIndex = (st) => st === "out_for_delivery" ? 5 : st === "awaiting_customer_call" ? 1 : STAGES.findIndex(([k]) => k === st);
  const statusClass = (st) => st === "delivered" ? "done" : st === "cancelled" ? "warn" : "";
  const PREFS = [
    ["shirts", "Shirts", ["Hung", "Folded"]],
    ["starch", "Starch", ["None", "Light", "Medium", "Firm"]],
    ["fragrance", "Fragrance", ["LAVE signature", "Unscented"]],
    ["detergent", "Detergent", ["Standard", "Sensitive skin", "Eco"]],
  ];

  class LaveAccount extends LaveBase {
    async start() {
      this.tab = this.getAttribute("tab") || (location.hash.match(/^#lave-(orders|bookings|vault|profile|about|membership|wardrobe)$/) || [])[1] || "orders";
      if (this.hasAttribute("hide-tabs")) {
        // The website draws its own account navigation around the embed.
        this.view.innerHTML = `<div id="panel" class="stack"></div>`;
        return this.show();
      }
      this.renderShell();
    }

    renderShell() {
      const tabs = [["orders", "Orders"], ["bookings", "Bookings"], ["vault", "Vault"], ["profile", "Profile"], ["about", "About you"], ["membership", "Membership"], ["wardrobe", "Wardrobe"]];
      this.view.innerHTML = `
        <div class="section-head"><p class="eyebrow">My LAVE</p><h2>${esc(this.client.first_name ? "Welcome back, " + this.client.first_name : "Your account")}</h2></div>
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${this.tab === k}">${l}</button>`).join("")}</div>
        <div id="panel" class="stack"></div>`;
      this.on("[data-tab]", "click", (_, b) => {
        this.tab = b.dataset.tab;
        try { history.replaceState(null, "", "#lave-" + this.tab); } catch (_) { /* ignore */ }
        this.$$("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        this.show();
      });
      this.show();
    }

    async show() {
      const panel = this.$("#panel");
      panel.innerHTML = `<p class="loading">Loading…</p>`;
      try { await this["tab_" + this.tab](panel); }
      catch (e) { panel.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
    }

    async tab_orders(panel) {
      const [orders, credit] = await Promise.all([this.call("GET", "/api/me/orders"), this.call("GET", "/api/me/credit").catch(() => null)]);
      const creditLine = credit?.balance_pence ? `<p class="notice center">LAVE account credit: <strong>${money(credit.balance_pence)}</strong>. We use it automatically on your next booking, or refund it to your card if you ask.</p>` : "";
      if (!orders.length) {
        panel.innerHTML = creditLine + `<div class="notice center">You haven't sent us anything yet. Book a collection and your orders will appear here.</div>`;
        return;
      }
      panel.innerHTML = creditLine + `<div class="orders">${orders.map((o) => `
        <button class="order-row" data-ref="${esc(o.ref)}">
          <span><strong>${esc(o.ref)}</strong><br><span class="muted small">${DAY.format(parse(o.created_at))}</span></span>
          <span class="hide-sm">${o.item_count ? o.item_count + (o.item_count === 1 ? " item" : " items") : "<span class='muted'>Not yet itemised</span>"}</span>
          <span class="hide-sm">${o.item_count ? money(o.total_pence) : ""}</span>
          <span class="status ${statusClass(o.status)}">${esc(o.status_label)}</span>
        </button>`).join("")}</div>`;
      this.on("[data-ref]", "click", (_, b) => this.orderDetail(panel, b.dataset.ref));
    }

    async orderDetail(panel, ref) {
      panel.innerHTML = `<p class="loading">Loading…</p>`;
      const o = await this.call("GET", "/api/me/orders/" + encodeURIComponent(ref));
      const idx = stageIndex(o.status);
      panel.innerHTML = `
        <button class="btn link back" id="back">← All orders</button>
        <div class="row between"><div><p class="eyebrow">Order</p><p class="ref">${esc(o.ref)}</p></div><span class="status ${statusClass(o.status)}">${esc(o.status_label)}</span></div>
        ${o.status === "cancelled" ? "" : `<ol class="tracker">${STAGES.map(([, l], i) => `<li class="${i <= idx ? "on" : ""}">${l}</li>`).join("")}</ol>`}
        ${o.items.length ? `<div class="grid-scroll" style="display:block"><table class="items">
          <thead><tr><th>Tag</th><th>Item</th><th>Service</th><th>Status</th><th class="num">Price</th></tr></thead>
          <tbody>${o.items.map((i) => `<tr><td class="tag">${esc(i.tag_code)}</td><td>${esc([i.colour, i.brand, i.description].filter(Boolean).join(" "))}${i.condition_notes ? `<br><span class="muted small">${esc(i.condition_notes)}</span>` : ""}</td>
            <td>${esc(i.service?.name || "")}</td><td>${i.status === "in_vault" ? "In the Vault" : esc(i.status.replace(/_/g, " "))}</td><td class="num">${money(i.price_pence)}</td></tr>`).join("")}</tbody>
          <tfoot>
            ${o.minimum_top_up_pence ? `<tr><td colspan="4">Minimum order ${money(o.minimum_pence)} <span class="muted small">your items came to less</span></td><td class="num">${money(o.minimum_top_up_pence)}</td></tr>` : ""}
            ${o.missed_visits_pence ? `<tr><td colspan="4">Missed visit <span class="muted small">see our terms, section 10</span></td><td class="num">${money(o.missed_visits_pence)}</td></tr>` : ""}
            ${o.fees_pence ? `<tr><td colspan="4">Collection and delivery</td><td class="num">${money(o.fees_pence)}</td></tr>` : ""}
            ${o.discount_pence ? `<tr><td colspan="4">Discount</td><td class="num">−${money(o.discount_pence)}</td></tr>` : ""}
            <tr><td colspan="4"><strong>Total</strong> <span class="muted small">${o.payment_status === "paid" ? "Settled" : o.payment_status === "waived" ? "No charge" : "Settled once our atelier has checked everything"}</span></td><td class="num"><strong>${money(o.total_pence)}</strong></td></tr>
            ${o.paid_pence ? `<tr><td colspan="4">Paid by card</td><td class="num">${money(o.paid_pence)}</td></tr>` : ""}
            ${o.credit_used_pence ? `<tr><td colspan="4">Account credit used</td><td class="num">${money(o.credit_used_pence)}</td></tr>` : ""}
            ${o.credited_pence ? `<tr><td colspan="4">Credited to your LAVE account</td><td class="num">${money(o.credited_pence)}</td></tr>` : ""}
          </tfoot></table></div>`
        : `<p class="notice">We'll list every item here, with its tag and price, once we've inspected your order.${o.paid_pence ? ` You've paid ${money(o.paid_pence)} so far.` : ""}</p>`}
        ${o.status === "awaiting_customer_call" ? `<p class="notice">Something in your order differs from your booking. We'll call you to agree it before anything else is charged.</p>` : ""}
        <div class="stack"><p class="eyebrow">Bookings</p>${o.bookings.map((b) => `<p>${b.atelier ? `Drop-off at ${esc(b.atelier.name)}` : b.kind === "collection" ? "Collection" : "Return"}: ${esc(when(b))} <span class="status ${b.status === "completed" ? "done" : b.status === "cancelled" ? "warn" : ""}">${esc(b.status)}</span>${b.bag_codes?.length ? `<br><span class="muted small">Bag labels: ${b.bag_codes.map(esc).join(", ")}</span>` : ""}</p>`).join("")}
          ${this.canBookReturn(o) ? `<div class="row"><button class="btn" id="book-return">Book your return</button></div><div id="return-box" class="stack" hidden></div>` : ""}</div>
        <div class="stack"><p class="eyebrow">History</p><ul class="timeline">${o.timeline.slice().reverse().map((e) => `<li><span class="muted small">${DAY.format(parse(e.at))}, ${hour(e.at)}</span><span>${esc(e.label)}${e.note ? ` <span class="muted">· ${esc(e.note)}</span>` : ""}</span></li>`).join("")}</ul></div>`;
      this.$("#back").addEventListener("click", () => this.show());
      this.$("#book-return")?.addEventListener("click", () => this.bookReturn(o));
    }

    canBookReturn(o) {
      const open = (b) => b.status === "scheduled" || b.status === "en_route";
      return !["delivered", "cancelled", "out_for_delivery"].includes(o.status)
        && !o.bookings.some((b) => b.kind === "delivery" && open(b)) && o.bookings.some((b) => b.kind === "collection" && b.status !== "cancelled");
    }

    /* A return left to arrange later: address, then a slot from when the items are ready. */
    async bookReturn(o) {
      const box = this.$("#return-box");
      box.hidden = false;
      this.$("#book-return").hidden = true;
      await this.loadTerms();
      const first = o.bookings.find((b) => b.kind === "collection" && b.status !== "cancelled");
      const q = first.atelier ? `atelier_id=${first.atelier.id}&day=${first.starts_at.slice(0, 10)}` : `collection_end=${encodeURIComponent(first.ends_at)}`;
      const ready = await this.call("GET", "/api/me/earliest-return?" + q).catch(() => null);
      let addressId = (this.client.addresses.filter(inZone).find((a) => a.is_default) || this.client.addresses.filter(inZone)[0])?.id ?? null, slot = null;
      box.innerHTML = `<div id="r-address"></div><div id="r-slots" class="stack"></div><p class="error" hidden></p>
        <div class="row center"><button class="btn primary" id="r-book" disabled>Book return</button></div>`;
      addressBlock(this, box.querySelector("#r-address"), { selectedId: addressId, purpose: "deliver", onChange: (id) => { addressId = id; } });
      new SlotPicker(this, box.querySelector("#r-slots"), { mode: "lave_collects", after: ready?.earliest_return || null, priced: false,
        note: (windowType) => (ready ? `<p class="muted">${esc(ready.text)}</p>` : "")
          + `<p class="muted small">${esc(returnChargeNote(this.terms, first.window_type === "hour" && !first.atelier, windowType, false))}</p>`,
        onPick: (s) => { slot = s; box.querySelector("#r-book").disabled = !s; } });
      box.querySelector("#r-book").addEventListener("click", async () => {
        const err = box.querySelector(".error");
        err.hidden = true;
        if (!addressId) { err.textContent = "Add the address for your delivery."; err.hidden = false; return; }
        try {
          await this.call("POST", `/api/me/orders/${encodeURIComponent(o.ref)}/return`, { slot: { template_id: slot.template_id, day: slot.day }, address_id: addressId });
          this.orderDetail(this.$("#panel"), o.ref);
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    }

    async tab_bookings(panel) {
      const list = await this.call("GET", "/api/me/bookings");
      if (!list.length) {
        panel.innerHTML = `<div class="notice center">No upcoming collections or deliveries.</div>`;
        return;
      }
      panel.innerHTML = `<div class="orders">${list.map((b) => `
        <div class="order-row" style="cursor:default">
          <span><strong>${b.atelier ? "Drop-off" : b.kind === "collection" ? "Collection" : "Return"}</strong><br><span class="muted small">${esc(b.order_ref || b.ref)}</span></span>
          <span class="hide-sm">${esc(when(b))}</span>
          <span class="hide-sm muted small">${b.atelier ? esc(b.atelier.name) + (b.bag_codes?.length ? "<br>Bags: " + b.bag_codes.map(esc).join(", ") : "") : b.address ? esc(b.address.one_line) : "At the atelier"}</span>
          <span class="row" data-cancel-wrap="${b.id}">${b.status === "scheduled" ? `${b.movable ? `<button class="btn ghost" data-move="${b.id}">Change time</button>` : ""}<button class="btn ghost" data-cancel="${b.id}">Cancel</button>`
            : b.status === "missed" ? `<span class="status warn">Missed</span>${b.movable ? `<button class="btn primary" data-move="${b.id}">Choose a new time</button>` : ""}`
            : `<span class="status">${esc(b.status.replace("_", " "))}</span>`}</span>
        </div>
        <div class="stack" data-move-panel="${b.id}" hidden></div>`).join("")}</div><p class="error" id="cancel-error" hidden></p>`;
      this.on("[data-move]", "click", (_, btn) => {
        const b = list.find((x) => String(x.id) === btn.dataset.move);
        const box = this.$(`[data-move-panel="${b.id}"]`);
        this.$$("[data-move-panel]").forEach((x) => { if (x !== box) { x.hidden = true; x.innerHTML = ""; } });
        box.hidden = false;
        box.innerHTML = `<p class="center muted">Choose a new ${b.kind === "collection" ? "collection" : "return"} time (${b.window_type === "hour" ? "one-hour" : "Saver"} window).</p>
          <div data-picker></div><p class="error" hidden></p>
          <div class="row center"><button class="btn primary" data-move-yes disabled>Move to this time</button><button class="btn ghost" data-move-no>Keep the current time</button></div>`;
        let chosen = null;
        const yes = box.querySelector("[data-move-yes]"), err = box.querySelector(".error");
        new SlotPicker(this, box.querySelector("[data-picker]"), { mode: "lave_collects", windowType: b.window_type, after: b.move_after,
          allowWindowChoice: false, priced: false, onPick: (slot) => { chosen = slot; yes.disabled = !slot; } });
        box.querySelector("[data-move-no]").addEventListener("click", () => this.show());
        yes.addEventListener("click", async () => {
          yes.disabled = true; err.hidden = true;
          try { await this.call("POST", `/api/me/bookings/${b.id}/move`, { template_id: chosen.template_id, day: chosen.day }); this.show(); }
          catch (e) { err.textContent = e.message; err.hidden = false; yes.disabled = false; }
        });
      });
      this.on("[data-cancel]", "click", (_, btn) => {
        const wrap = btn.parentElement;
        wrap.innerHTML = `<span class="small">Cancel this?</span>
          <select data-reason aria-label="Why are you cancelling? (optional)"><option value="">Why? (optional)</option>
            ${["Plans changed", "Booked the wrong time", "Price", "Using another service", "Something else"].map((r) => `<option>${r}</option>`).join("")}</select>
          <button class="btn primary" data-yes>Yes, cancel</button><button class="btn ghost" data-no>Keep</button>`;
        wrap.querySelector("[data-no]").addEventListener("click", () => this.show());
        wrap.querySelector("[data-yes]").addEventListener("click", async () => {
          try { await this.call("POST", `/api/me/bookings/${btn.dataset.cancel}/cancel`, { reason: wrap.querySelector("[data-reason]").value }); this.show(); }
          catch (e) { const el = this.$("#cancel-error"); el.textContent = e.message; el.hidden = false; }
        });
      });
    }

    async tab_wardrobe(panel) {
      const items = await this.call("GET", "/api/me/wardrobe");
      if (!items.length) {
        panel.innerHTML = `<div class="notice center">Your Wardrobe fills itself: every piece we clean for you appears here, so you can book the same care again in a couple of taps.</div>`;
        return;
      }
      const picked = new Set();
      const bookUrl = this.getAttribute("book-url") || "/book/";
      const lastLine = (w) => w.times_cleaned
        ? `Cared for ${w.times_cleaned === 1 ? "once" : w.times_cleaned + " times"}${w.last_cleaned ? " · last " + DAY.format(parse(w.last_cleaned)) : ""}`
        : "First visit in progress";
      panel.innerHTML = `
        <div class="row between"><p class="muted">${items.length} ${items.length === 1 ? "piece" : "pieces"}. Select the ones you'd like cared for again.</p>
          <button class="btn primary" id="rebook" disabled>Book these again</button></div>
        <div class="wardrobe-grid">${items.map((w) => {
          const busy = w.in_atelier || w.in_vault;
          return `<div class="wardrobe-card${busy ? " busy" : ""}">
            <button class="wardrobe-pick" data-pick="${w.id}" aria-pressed="false" ${busy ? "disabled" : ""} aria-label="Select ${esc(w.title)}">
              <span class="wardrobe-img">${w.image ? `<img src="${esc(w.image)}" alt="" loading="lazy">` : ""}</span>
              ${w.in_atelier ? `<span class="status">In the atelier</span>` : w.in_vault ? `<span class="status">In the Vault</span>` : `<span class="tick" aria-hidden="true">${ICON.check}</span>`}
            </button>
            <div class="wardrobe-body">
              <strong>${esc(w.title)}</strong>
              <span class="small">${esc(w.service?.name || "")}${w.service ? " · " + money(w.service.price_pence) : ""}</span>
              <span class="muted small">${lastLine(w)}</span>
              <span class="row"><button class="btn link small" data-rename="${w.id}">Rename</button><button class="btn link small" data-hide="${w.id}">Remove</button></span>
            </div>
          </div>`;
        }).join("")}</div>
        <p class="error" hidden id="w-error"></p>`;
      const rebook = this.$("#rebook");
      this.on("[data-pick]", "click", (_, b) => {
        const id = Number(b.dataset.pick);
        picked.has(id) ? picked.delete(id) : picked.add(id);
        b.setAttribute("aria-pressed", String(picked.has(id)));
        rebook.disabled = !picked.size;
        rebook.textContent = picked.size ? `Book ${picked.size === 1 ? "this" : "these " + picked.size} again` : "Book these again";
      });
      rebook.addEventListener("click", () => { location.href = bookUrl + "?items=" + [...picked].join(","); });
      const fail = (m) => { const el = this.$("#w-error"); el.textContent = m; el.hidden = false; };
      this.on("[data-rename]", "click", (_, b) => {
        const body = b.closest(".wardrobe-body");
        const w = items.find((x) => x.id === Number(b.dataset.rename));
        body.innerHTML = `<form class="rename"><input value="${esc(w.name)}" maxlength="200" aria-label="Name"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-cancel>Cancel</button></form>`;
        body.querySelector("[data-cancel]").addEventListener("click", () => this.show());
        body.querySelector("form").addEventListener("submit", async (e) => {
          e.preventDefault();
          try { await this.call("PATCH", `/api/me/wardrobe/${w.id}`, { name: e.target.querySelector("input").value }); this.show(); }
          catch (ex) { fail(ex.message); }
        });
      });
      this.on("[data-hide]", "click", (_, b) => {
        const row = b.parentElement;
        row.innerHTML = `<span class="small">Remove from your Wardrobe?</span><button class="btn link small" data-yes>Remove</button><button class="btn link small" data-no>Keep</button>`;
        row.querySelector("[data-no]").addEventListener("click", () => this.show());
        row.querySelector("[data-yes]").addEventListener("click", async () => {
          try { await this.call("PATCH", `/api/me/wardrobe/${b.dataset.hide}`, { hidden: true }); this.show(); }
          catch (ex) { fail(ex.message); }
        });
      });
    }

    async tab_vault(panel) {
      const items = await this.call("GET", "/api/me/vault");
      await this.loadTerms();
      if (!items.length) {
        panel.innerHTML = `<div class="notice center">Nothing in your Vault yet. Choose “Vault storage” when you book and we'll clean and store your pieces in climate-controlled conditions.</div>`;
        return;
      }
      const picked = new Set();
      panel.innerHTML = `
        <p class="center muted">Select the pieces you'd like back, then choose a delivery time.</p>
        <div class="vault-grid">${items.map((v) => `
          <button class="vault-card" data-item="${v.id}" aria-pressed="false" ${v.status !== "stored" ? "disabled" : ""}>
            <span class="tag">${esc(v.tag_code)}</span><strong>${esc(v.description)}</strong>
            <span class="muted small">Stored since ${DAY.format(parse(v.stored_at))}</span>
            ${v.status === "retrieval_requested" ? `<span class="status">Return booked · ${esc(when(v.retrieval))}</span>` : ""}
          </button>`).join("")}</div>
        <div id="retrieve" class="stack" hidden>
          <div id="v-address"></div><div id="v-slots" class="stack"></div>
          <p class="error" id="v-error" hidden></p>
          <div class="row center"><button class="btn primary" id="v-book" disabled>Book return</button></div>
        </div>`;
      let slot = null;
      let addressId = (this.client.addresses.filter(inZone).find((a) => a.is_default) || this.client.addresses.filter(inZone)[0])?.id ?? null;
      this.on("[data-item]", "click", (_, b) => {
        const id = Number(b.dataset.item);
        picked.has(id) ? picked.delete(id) : picked.add(id);
        b.setAttribute("aria-pressed", String(picked.has(id)));
        const box = this.$("#retrieve");
        if (picked.size && box.hidden) {
          box.hidden = false;
          addressBlock(this, this.$("#v-address"), { selectedId: addressId, purpose: "deliver", onChange: (id2) => { addressId = id2; } });
          new SlotPicker(this, this.$("#v-slots"), { mode: "lave_collects", onPick: (s) => { slot = s; this.$("#v-book").disabled = !s; } });
        }
        if (!picked.size) box.hidden = true;
      });
      this.$("#v-book").addEventListener("click", async () => {
        const err = this.$("#v-error");
        err.hidden = true;
        if (!addressId) { err.textContent = "Add the address for your delivery."; err.hidden = false; return; }
        try {
          await this.call("POST", "/api/me/vault/retrieve", { item_ids: [...picked], slot: { template_id: slot.template_id, day: slot.day }, address_id: addressId });
          this.show();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    }

    async tab_profile(panel) {
      const c = this.client, p = c.preferences || {};
      panel.innerHTML = `
        <form class="grid" id="profile" novalidate>
          <label>First name<input name="first_name" value="${esc(c.first_name)}" autocomplete="given-name"></label>
          <label>Last name<input name="last_name" value="${esc(c.last_name)}" autocomplete="family-name"></label>
          <label>Email<input value="${esc(c.email)}" disabled title="Change your email from your LAVE website account"></label>
          <label>Mobile<input name="phone" value="${esc(c.phone)}" autocomplete="tel" placeholder="We text you when the driver is close"></label>
          <p class="full eyebrow" style="margin-top:12px">Care preferences</p>
          ${PREFS.map(([k, l, opts]) => `<label>${l}<select name="pref_${k}"><option value="">No preference</option>${opts.map((o) => `<option ${p[k] === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>`).join("")}
          <div class="full row"><button class="btn primary" type="submit">Save changes</button><span class="muted small" id="saved" hidden>Saved</span></div>
          <p class="full error" hidden></p>
        </form>
        <div class="stack"><p class="eyebrow">Addresses</p><div id="addresses" class="addr-grid"></div></div>
        <div class="stack"><p class="eyebrow">Card</p>
          <p>${c.has_card_on_file ? "A card is saved for your orders." : "No card saved yet."}</p>
          ${this.config.stripe_publishable_key ? `<div class="row"><button class="btn" id="card-btn">${c.has_card_on_file ? "Replace card" : "Add a card"}</button></div><div id="card-box" class="stack" hidden><div id="card-mount"></div><p class="error" hidden id="card-error"></p><div class="row"><button class="btn primary" id="card-save">Save card</button></div></div>` : ""}
        </div>
        <div class="card stack" id="my-data">
          <p class="eyebrow">Your data</p>
          <p>Download a copy of everything we hold about you: your details, addresses, orders, Vault and Wardrobe.</p>
          <div class="row"><button class="btn" id="data-download">Download my data</button></div>
          ${c.deletion_requested_at
            ? `<p class="notice">You asked us to delete your account on ${esc(DAY_LONG.format(parse(c.deletion_requested_at)))}. We'll be in touch within one month.</p>`
            : `<p class="muted small">You can ask us to delete your account. If you have pieces with us or account credit, we'll be in touch first so nothing of yours is lost. We keep the order and payment records the law requires, without your name or contact details.</p>
          <div class="row" id="delete-wrap"><button class="btn ghost" id="delete-ask">Ask us to delete my account</button></div>`}
          <p class="error" hidden id="data-error"></p>
        </div>`;
      const form = this.$("#profile");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(form).entries());
        const preferences = {};
        PREFS.forEach(([k]) => { if (f["pref_" + k]) preferences[k] = f["pref_" + k]; });
        try {
          this.client = await this.call("PATCH", "/api/me", { first_name: f.first_name, last_name: f.last_name, phone: f.phone, preferences });
          this.$("#saved").hidden = false;
          setTimeout(() => { const s = this.$("#saved"); if (s) s.hidden = true; }, 2500);
        } catch (ex) { const el = form.querySelector(".error"); el.textContent = ex.message; el.hidden = false; }
      });
      const addrs = this.$("#addresses");
      addrs.innerHTML = c.addresses.map((a) => `<div class="addr" style="cursor:default"><strong>${esc(a.label)}</strong>${a.is_default ? ' <span class="status">Default</span>' : ""}<br>${esc(a.line1)}<br>${esc(a.city)}, ${esc(a.postcode)}${inZone(a) ? "" : `<br><span class="muted small">Not yet in our area</span>`}
        <div class="row" style="margin-top:8px">${a.is_default ? "" : `<button class="btn link" data-default="${a.id}">Make default</button>`}<button class="btn link" data-remove="${a.id}">Remove</button></div></div>`).join("")
        || `<p class="muted">No saved addresses. You can add one when you book.</p>`;
      this.on("[data-default]", "click", async (_, b) => { await this.call("PATCH", `/api/me/addresses/${b.dataset.default}`, { is_default: true }); this.client = await this.call("GET", "/api/me"); this.show(); });
      this.on("[data-remove]", "click", async (_, b) => { await this.call("DELETE", `/api/me/addresses/${b.dataset.remove}`); this.client = await this.call("GET", "/api/me"); this.show(); });
      this.$("#data-download").addEventListener("click", async () => {
        try {
          const data = await this.call("GET", "/api/me/export");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
          a.download = `lave-my-data-${isoDay(new Date())}.json`;
          document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { const el = this.$("#data-error"); el.textContent = e.message; el.hidden = false; }
      });
      this.$("#delete-ask")?.addEventListener("click", () => {
        const wrap = this.$("#delete-wrap");
        wrap.innerHTML = `<span class="small">Ask us to delete your account?</span><button class="btn primary" data-yes>Yes, ask LAVE</button><button class="btn ghost" data-no>Keep my account</button>`;
        wrap.querySelector("[data-no]").addEventListener("click", () => this.show());
        wrap.querySelector("[data-yes]").addEventListener("click", async () => {
          try { await this.call("POST", "/api/me/delete-request"); this.client = await this.call("GET", "/api/me"); this.show(); }
          catch (e) { const el = this.$("#data-error"); el.textContent = e.message; el.hidden = false; }
        });
      });
      this.$("#card-btn")?.addEventListener("click", async () => {
        this.$("#card-box").hidden = false;
        this.$("#card-btn").hidden = true;
        try { this.card = await this.mountCard(this.$("#card-mount")); }
        catch (e) { const el = this.$("#card-error"); el.textContent = e.message; el.hidden = false; }
      });
      this.$("#card-save")?.addEventListener("click", async () => {
        try { await this.card.confirm(); this.card.unmount(); this.card = null; this.show(); }
        catch (e) { const el = this.$("#card-error"); el.textContent = e.message; el.hidden = false; }
      });
    }

    /* "Tell us about you": everything optional, each with why we ask; theirs to change or delete. */
    async tab_about(panel) {
      const a = await this.call("GET", "/api/me/about");
      const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const why = (t) => `<span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">${t}</span>`;
      const person = (h = {}, i) => `<div class="full grid-3" data-person="${i}" style="display:grid;grid-template-columns:2fr 2fr 1fr auto;gap:10px;align-items:end">
          <label>Name<input name="h_name" value="${esc(h.name || "")}"></label>
          <label>Relation<input name="h_relation" value="${esc(h.relation || "")}" placeholder="Partner, daughter…"></label>
          <label>Age<input name="h_age" value="${esc(h.age || "")}" placeholder="Optional"></label>
          <button class="btn link" type="button" data-unperson>Remove</button></div>`;
      panel.innerHTML = `
        <div class="section-head"><p class="eyebrow">About you</p><h2>Tell us about you</h2>
          <p class="muted">So we can make your membership yours. Every answer is optional, and you can change or delete them at any time.</p></div>
        <form class="grid" id="about" novalidate>
          <label>What should we call you? ${why("The name we use when we write or call.")}<input name="preferred_name" value="${esc(a.preferred_name)}" autocomplete="nickname"></label>
          <div class="stack" style="gap:6px"><span class="small" style="font-weight:600;letter-spacing:.05em;text-transform:uppercase">Birthday ${why("Day and month only, so we can mark your day.")}</span>
            <div class="row"><select name="birthday_day" aria-label="Day"><option value="">Day</option>${[...Array(31)].map((_, i) => `<option ${a.birthday_day === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
            <select name="birthday_month" aria-label="Month"><option value="">Month</option>${MONTHS.map((m, i) => `<option value="${i + 1}" ${a.birthday_month === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></div></div>
          <label>How should we get in touch? ${why("For calls about your order and anything else.")}<select name="contact_channel">${Object.entries(a.channel_options).map(([k, l]) => `<option value="${k}" ${a.contact_channel === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>Best times ${why("When it suits you to hear from us.")}<input name="contact_times" value="${esc(a.contact_times)}" placeholder="Weekday evenings"></label>
          <label class="full">Pieces that matter most ${why("Heirlooms, couture, a favourite coat: we'll take extra care.")}<textarea name="special_pieces" placeholder="My mother's silk wedding dress; a vintage Burberry trench">${esc(a.special_pieces)}</textarea></label>
          <label class="full">Allergies or sensitive skin ${why("Only used to choose how we clean your pieces.")}<input name="allergies" value="${esc(a.allergies)}" placeholder="Fragrance-sensitive"></label>
          <div class="full stack"><span class="small" style="font-weight:600;letter-spacing:.05em;text-transform:uppercase">What you enjoy ${why("So we invite you to the member experiences you'll love.")}</span>
            <div class="chips" style="justify-content:flex-start">${a.interest_options.map((i) => `<button type="button" class="chip" data-interest="${esc(i)}" aria-pressed="${a.interests.includes(i)}">${esc(i)}</button>`).join("")}</div></div>
          <label class="full">Dietary needs ${why("For member events with food.")}<input name="dietary" value="${esc(a.dietary)}"></label>
          <div class="full stack"><span class="small" style="font-weight:600;letter-spacing:.05em;text-transform:uppercase">Your household ${why("So family experiences feel personal.")}</span>
            <div id="people" class="stack">${(a.household.length ? a.household : []).map(person).join("")}</div>
            <div><button class="btn link" type="button" id="add-person">+ Add someone</button></div></div>
          <label class="full" style="flex-direction:row;display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font-weight:400"><input type="checkbox" name="feature_ok" ${a.feature_ok ? "checked" : ""} style="width:auto"> I'm happy to be featured in LAVE's Journal (we'll always ask first)</label>
          <div class="full row"><button class="btn primary" type="submit">Save</button><span class="muted small" id="about-saved" hidden>Saved. Thank you.</span>
            <button class="btn link" type="button" id="forget">Delete everything here</button></div>
          <p class="full error" hidden></p>
        </form>
        <div class="stack"><p class="eyebrow">Something coming up?</p>
          <p class="muted small">A wedding, a gala, a move: tell us and we'll have your pieces ready.</p>
          ${a.occasions.length ? `<ul class="piece-list">${a.occasions.map((o) => `<li><span>${esc(o.title)}<br><span class="muted small">${esc(DAY_LONG.format(parse(o.day)))}${o.note ? " · " + esc(o.note) : ""}</span></span><button class="btn link" data-unoccasion="${o.id}">Remove</button></li>`).join("")}</ul>` : ""}
          <form class="grid" id="occasion" novalidate>
            <label>What is it?<input name="title" placeholder="Sister's wedding"></label>
            <label>Date<input name="day" type="date"></label>
            <label class="full">Anything we should know?<input name="note" placeholder="Navy suit and the silk dress"></label>
            <div class="full"><button class="btn" type="submit">Add occasion</button></div>
            <p class="full error" hidden></p>
          </form></div>`;
      const form = this.$("#about"), people = this.$("#people");
      const interests = new Set(a.interests);
      this.on("[data-interest]", "click", (_, b) => { const v = b.dataset.interest; interests.has(v) ? interests.delete(v) : interests.add(v); b.setAttribute("aria-pressed", String(interests.has(v))); });
      const wireRemove = () => people.querySelectorAll("[data-unperson]").forEach((b) => { b.onclick = () => b.closest("[data-person]").remove(); });
      wireRemove();
      this.$("#add-person").addEventListener("click", () => { people.insertAdjacentHTML("beforeend", person({}, people.children.length)); wireRemove(); });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(form).entries());
        const household = [...people.querySelectorAll("[data-person]")].map((row) => ({
          name: row.querySelector("[name=h_name]").value, relation: row.querySelector("[name=h_relation]").value, age: row.querySelector("[name=h_age]").value }));
        try {
          await this.call("PUT", "/api/me/about", { ...f, feature_ok: form.feature_ok.checked, interests: [...interests], household,
            birthday_day: f.birthday_day ? Number(f.birthday_day) : null, birthday_month: f.birthday_month ? Number(f.birthday_month) : null });
          this.$("#about-saved").hidden = false;
        } catch (ex) { const el = form.querySelector(".error"); el.textContent = ex.message; el.hidden = false; }
      });
      this.$("#forget").addEventListener("click", async (e) => {
        e.target.outerHTML = `<span class="small">Delete everything you've told us here? <button class="btn link" type="button" id="forget-yes">Yes, delete</button></span>`;
        this.$("#forget-yes").addEventListener("click", async () => { await this.call("DELETE", "/api/me/about"); this.show(); });
      });
      this.$("#occasion").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await this.call("POST", "/api/me/occasions", Object.fromEntries(new FormData(e.target).entries())); this.show(); }
        catch (ex) { const el = e.target.querySelector(".error"); el.textContent = ex.message; el.hidden = false; }
      });
      this.on("[data-unoccasion]", "click", async (_, b) => { await this.call("DELETE", `/api/me/occasions/${b.dataset.unoccasion}`); this.show(); });
    }

    async tab_membership(panel) {
      const m = this.client.membership;
      const returnUrl = location.href.split("#")[0] + "#lave-membership";
      if (m && m.status !== "cancelled") {
        const paused = m.status === "paused";
        panel.innerHTML = `<div class="plan" style="max-width:420px;margin:0 auto">
          <p class="eyebrow">Your membership</p><h2>${esc(m.plan_name)}</h2>
          <span class="status ${m.status === "active" ? "done" : "warn"}">${esc(m.status.replace("_", " "))}</span>
          ${paused ? `<p class="muted">No payments and no member benefits while paused.${m.resumes_at ? ` Resumes ${DAY_LONG.format(parse(m.resumes_at))}.` : ""}</p>
              <button class="btn primary" id="resume">Resume now</button>`
            : m.current_period_end ? `<p class="muted">Renews ${DAY_LONG.format(parse(m.current_period_end))}</p>` : ""}
          ${m.can_pause ? `<div class="stack" id="pause-box"><button class="btn" id="pause">Pause membership</button></div>` : ""}
          <button class="btn ${paused ? "" : "primary"}" id="portal">Card, invoices and cancelling</button><p class="error" hidden></p></div>`;
        const fail = (e) => { const el = panel.querySelector(".error"); el.textContent = e.message; el.hidden = false; };
        this.$("#pause")?.addEventListener("click", () => {
          this.$("#pause-box").innerHTML = `<p class="small">Pause for how long? You won't be charged, and benefits stop until it resumes.</p>
            <div class="row">${[1, 2, 3].map((n) => `<button class="btn" data-months="${n}">${n} month${n > 1 ? "s" : ""}</button>`).join("")}</div>`;
          this.on("[data-months]", "click", async (_, b) => {
            try { this.client = await this.call("POST", "/api/me/membership/pause", { months: Number(b.dataset.months) }); this.show(); }
            catch (e) { fail(e); }
          });
        });
        this.$("#resume")?.addEventListener("click", async () => {
          try { this.client = await this.call("POST", "/api/me/membership/resume"); this.show(); } catch (e) { fail(e); }
        });
        this.$("#portal").addEventListener("click", async () => {
          try { location.href = (await this.call("POST", "/api/me/membership/portal", { return_url: returnUrl })).url; }
          catch (e) { const el = panel.querySelector(".error"); el.textContent = e.message; el.hidden = false; }
        });
        return;
      }
      panel.innerHTML = `<p class="center muted">A monthly Refresh keeps garments and home textiles fresh, cared for and ready for life's moments.</p>
        <div class="plans">${this.config.plans.map((p) => `<div class="plan"><p class="eyebrow">Tier ${p.tier}</p><h3>${esc(p.name)}</h3>
          <p class="muted small">${esc(p.tagline || "")}</p>
          <p class="price">${money(p.price_pence)} <span class="muted small">a month</span></p>
          ${(p.includes || []).length ? `<ul class="plan-includes">${p.includes.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
          ${p.available ? `<button class="btn primary" data-plan="${p.code}" data-interval="month">Choose monthly</button>` : `<button class="btn" disabled>Coming soon</button>`}
          ${p.annual_available ? `<button class="btn" data-plan="${p.code}" data-interval="year">Choose annual · ${money(p.annual_pence)}</button>` : ""}
          </div>`).join("")}</div>
        <p class="center small"><a href="/memberships/#compare">Compare every benefit</a></p>
        ${this.config.start_now_membership ? `<p class="center muted small" style="max-width:640px;margin:0 auto">${esc(this.config.start_now_membership)} <a href="/policies/cancellation/">Cancellation policy</a></p>` : ""}
        <p class="error" hidden></p>`;
      this.on("[data-plan]", "click", async (_, b) => {
        try { location.href = (await this.call("POST", "/api/me/membership/checkout", { plan: b.dataset.plan, interval: b.dataset.interval || "month", return_url: returnUrl })).url; }
        catch (e) { const el = panel.querySelector(".error"); el.textContent = e.message; el.hidden = false; }
      });
    }
  }

  if (!customElements.get("lave-booking")) customElements.define("lave-booking", LaveBooking);
  if (!customElements.get("lave-account")) customElements.define("lave-account", LaveAccount);
})();
