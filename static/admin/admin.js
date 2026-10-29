/* LAVE OS staff dashboard. Plain JS, hash-routed, talks to /api/staff with the session cookie. */
(() => {
  "use strict";

  const app = document.getElementById("app");
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (p) => "£" + ((p || 0) / 100).toFixed(2);
  const toPence = (v) => Math.round(parseFloat(String(v).replace(/[£,\s]/g, "")) * 100);
  const parse = (iso) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  const D = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const DT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const T = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const human = (s) => String(s || "").replace(/_/g, " ");
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const STATUS_LABEL = {
    awaiting_collection: "Awaiting collection", collected: "Collected", awaiting_customer_call: "Awaiting customer call", inspected: "Inspected", in_care: "In care",
    quality_check: "Quality check", ready: "Ready", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled",
  };
  // Mirrors app/services/orders.py TRANSITIONS; the server is the authority.
  const NEXT = {
    awaiting_collection: ["collected", "cancelled"], collected: ["inspected", "cancelled"], awaiting_customer_call: ["cancelled"], inspected: ["in_care"],
    in_care: ["quality_check"], quality_check: ["ready", "in_care"], ready: ["out_for_delivery", "delivered"],
    out_for_delivery: ["delivered", "ready"], delivered: [], cancelled: [],
  };
  const ACTION_LABEL = {
    collected: "Mark collected", inspected: "Mark inspected", in_care: "Start care", quality_check: "Send to quality check",
    ready: "Mark ready", out_for_delivery: "Out for delivery", delivered: "Mark delivered", cancelled: "Cancel order",
  };
  const PIPE = ["awaiting_collection", "collected", "awaiting_customer_call", "inspected", "in_care", "quality_check", "ready", "out_for_delivery"];

  const pill = (status) => {
    const cls = { delivered: "ok", paid: "ok", completed: "ok", stored: "ok", waived: "ok", cancelled: "err", failed: "err", missed: "err",
      unpaid: "warn", retrieval_requested: "warn", awaiting_customer_call: "warn", ready: "ink", en_route: "ink", dispatched: "ok", collected: "ok",
      pending_payment: "warn" }[status] || "";
    return `<span class="pill ${cls}">${esc(STATUS_LABEL[status] || human(status))}</span>`;
  };

  // Density rules (13–14 of the profitability rules): set by hand in Settings → Slots.
  const ROUTE_DAY_NOTE = `<section class="panel note-box"><h2>Route days: two rules you set here</h2>
    <p><strong>13. Only open slots on route days.</strong> At launch, keep collections to a few days (for example Tuesday, Thursday and Saturday) and set every other day's capacity to 0. Fuller days cost less per job: about £14 at 8 jobs a day, under £10 at 12.</p>
    <p><strong>14. Open another route day once each day averages about 12 jobs.</strong> A new day only pays once it can reach 8 jobs. Check <a href="#/profit">Profitability</a> for jobs per route day.</p>
    <p class="small muted">Route days must still support the 48-hour promise: with fewer days, some returns land later than 48 hours, never earlier.</p></section>`;

  let me = null;
  let services = [];

  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    if (res.status === 401 && !path.endsWith("/auth/login")) { me = null; renderLogin(); throw new Error("Signed out"); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? "Check the form: " + data.detail.map((d) => d.loc?.slice(-1)[0]).join(", ") : "Something went wrong. Try again.";
      throw new Error(msg);
    }
    return data;
  }

  function toast(msg, isErr = false) {
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 5000 : 2500);
  }

  // Run an action, report errors as a toast, then re-render the current route.
  const act = (fn, okMsg) => async (...args) => {
    try { await fn(...args); if (okMsg) toast(okMsg); route(); }
    catch (e) { if (e.message !== "Signed out") toast(e.message, true); }
  };

  /* Login & shell */

  function renderLogin() {
    app.innerHTML = `<div class="login"><form id="login">
      <div class="brand">LAVE<small style="display:block;font-size:11px;letter-spacing:.24em;margin-top:6px">Atelier OS</small></div>
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" hidden></p>
      <button class="btn primary" type="submit">Sign in</button>
      <button class="link small" type="button" id="forgot">Forgot password?</button>
    </form></div>`;
    document.getElementById("forgot").addEventListener("click", renderForgot);
    document.getElementById("login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      try {
        const r = await api("POST", "/api/staff/auth/login", f);
        if (r.two_step) { renderCode(r.pending); return; }
        me = { ...r.staff, setup_two_step: r.setup_two_step };
        route();
      } catch (ex) { const el = e.target.querySelector(".error"); el.textContent = ex.message; el.hidden = false; }
    });
  }

  // Two-step sign-in: the code from the authenticator app, after the password.
  function renderCode(pending) {
    app.innerHTML = `<div class="login"><form id="code-form">
      <div class="brand">LAVE<small style="display:block;font-size:11px;letter-spacing:.24em;margin-top:6px">Atelier OS</small></div>
      <p class="small">Enter the six-digit code from your authenticator app.</p>
      <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required autofocus></label>
      <p class="small muted">Lost your phone? Enter one of your recovery codes instead.</p>
      <p class="error" hidden></p>
      <button class="btn primary" type="submit">Sign in</button>
      <button class="link small" type="button" id="back">Back</button>
    </form></div>`;
    document.getElementById("back").addEventListener("click", renderLogin);
    document.getElementById("code-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        me = (await api("POST", "/api/staff/auth/login/code", { pending, code: e.target.code.value })).staff;
        route();
      } catch (ex) { const el = e.target.querySelector(".error"); el.textContent = ex.message; el.hidden = false; }
    });
  }

  // Set up two-step sign-in: scan the QR code, confirm with a code, keep the recovery codes.
  async function twoStepSetup(box, { forced = false } = {}) {
    const r = await api("POST", "/api/staff/auth/two-step/setup");
    box.innerHTML = `<section class="panel stack" style="max-width:520px">
      <h2>Turn on two-step sign-in</h2>
      ${forced ? `<p class="notice small">LAVE OS now asks everyone to use two-step sign-in. It takes a minute.</p>` : ""}
      <p class="small">1. Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or 1Password) and scan this code.</p>
      <div class="qr">${r.qr_svg}</div>
      <p class="small muted">Can't scan? Enter this key instead: <span class="tag">${esc(r.secret)}</span></p>
      <form id="enable" class="stack"><label>2. Enter the six-digit code it shows<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <p class="error" hidden></p><div><button class="btn primary">Turn on</button></div></form></section>`;
    box.querySelector("#enable").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const done = await api("POST", "/api/staff/auth/two-step/enable", { code: e.target.code.value });
        me = { ...me, ...done.staff, setup_two_step: false };
        box.innerHTML = `<section class="panel stack" style="max-width:520px"><h2>Two-step sign-in is on</h2>
          <p>Keep these recovery codes somewhere safe, such as your password manager. Each one works once, if you lose your phone. They won't be shown again.</p>
          <pre class="recovery">${done.recovery_codes.map(esc).join("\n")}</pre>
          <div class="row"><button class="btn primary" id="saved-codes">I've saved them</button></div></section>`;
        box.querySelector("#saved-codes").addEventListener("click", () => { location.hash = forced ? "#/today" : "#/settings?tab=security"; route(); });
      } catch (ex) { const el = e.target.querySelector(".error"); el.textContent = ex.message; el.hidden = false; }
    });
  }

  function renderForgot() {
    app.innerHTML = `<div class="login"><form id="forgot-form">
      <div class="brand">LAVE<small style="display:block;font-size:11px;letter-spacing:.24em;margin-top:6px">Atelier OS</small></div>
      <p class="small">Enter your staff email and we'll send you a link to choose a new password.</p>
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <p class="error" hidden></p><p class="small ok" hidden role="status"></p>
      <button class="btn primary" type="submit">Email me a link</button>
      <button class="link small" type="button" id="back">Back to sign in</button>
    </form></div>`;
    document.getElementById("back").addEventListener("click", renderLogin);
    document.getElementById("forgot-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, err = f.querySelector(".error"), ok = f.querySelector(".ok");
      try {
        await api("POST", "/api/staff/auth/forgot", { email: f.email.value });
        err.hidden = true; ok.hidden = false;
        ok.textContent = "If that email belongs to a staff account, a link is on its way. It works for one hour.";
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  }

  function renderReset(token) {
    app.innerHTML = `<div class="login"><form id="reset-form">
      <div class="brand">LAVE<small style="display:block;font-size:11px;letter-spacing:.24em;margin-top:6px">Atelier OS</small></div>
      <p class="small">Choose a new password (12 characters or more).</p>
      <label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label>
      <label>Type it again<input name="again" type="password" autocomplete="new-password" minlength="12" required></label>
      <p class="error" hidden></p>
      <button class="btn primary" type="submit">Save new password</button>
    </form></div>`;
    document.getElementById("reset-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, err = f.querySelector(".error");
      if (f.password.value !== f.again.value) { err.textContent = "The two passwords don't match."; err.hidden = false; return; }
      try {
        const r = await api("POST", "/api/staff/auth/reset", { token, password: f.password.value });
        history.replaceState(null, "", "/admin#/today");
        renderLogin();
        document.querySelector('#login input[name="email"]').value = r.email;
        const note = document.querySelector("#login .error");
        note.className = "small ok"; note.textContent = "Password changed. Sign in with your new password."; note.hidden = false;
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  }

  function shell(active, title, actionsHtml = "") {
    const isOps = me.role !== "driver";
    const links = [["today", "Today"], ...(isOps ? [["orders", "Orders"], ["clients", "Clients"], ["vault", "Vault"], ["shop", "Shop"], ...(me.role === "admin" ? [["products", "Products"]] : []), ["journal", "Journal"], ["website", "Website"], ["profit", "Profitability"], ["settings", "Settings"]] : [])];
    app.innerHTML = `<div class="shell">
      <aside class="side">
        <div class="brand">LAVE<small>Atelier OS</small></div>
        <nav>${links.map(([k, l]) => `<a href="#/${k}" ${active === k ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
        <div class="who"><span>${esc(me.name)} · ${esc(me.role)}</span><button id="logout">Sign out</button></div>
      </aside>
      <div class="main">
        <div class="top"><h1>${esc(title)}</h1><div class="row">${actionsHtml}
          <form class="scan" id="scan"><input name="code" placeholder="Scan or type a tag" aria-label="Tag code"><button class="btn">Find</button></form></div></div>
        <div class="content" id="content"></div>
      </div></div>`;
    document.getElementById("logout").addEventListener("click", async () => { await api("POST", "/api/staff/auth/logout"); me = null; renderLogin(); });
    document.getElementById("scan").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      if (!code) return;
      try {
        const r = await api("GET", "/api/staff/tags/" + encodeURIComponent(code));
        location.hash = r.order ? `#/orders/${r.order.id}` : `#/clients/${r.vault_item.client.id}`;
      } catch (ex) { toast(ex.message, true); }
    });
    const content = document.getElementById("content");
    if (!me.two_step && active !== "settings") {
      content.insertAdjacentHTML("beforebegin", `<p class="notice small" style="margin:12px 24px 0">Protect your account: <a href="#/settings?tab=security">turn on two-step sign-in</a>.</p>`);
    }
    return content;
  }

  /* Today */

  async function viewToday(params) {
    const day = params.get("day") || isoDay(new Date());
    const c = shell("today", "Today", `<input type="date" id="day" value="${day}" aria-label="Day">`);
    document.getElementById("day").addEventListener("change", (e) => { location.hash = "#/today?day=" + e.target.value; });
    c.innerHTML = `<p class="loading">Loading…</p>`;
    const d = await api("GET", "/api/staff/dashboard?day=" + day);
    const drivers = d.drivers;
    const run = (b) => `
      <div class="run">
        <div><div class="time">${T.format(parse(b.starts_at))}–${T.format(parse(b.ends_at))}</div><span class="small muted">${b.atelier ? "Drop-off" : b.window_type === "saver" ? "Saver" : "1 hour"}</span></div>
        <div class="stack" style="gap:2px">
          <strong>${esc(b.client.name)}</strong>
          <span class="small">${b.atelier ? "Drop-off · " + esc(b.atelier.name) : b.address ? esc(b.address.one_line) : "At the atelier"}${b.client.phone ? " · " + esc(b.client.phone) : ""}</span>
          ${b.bag_codes?.length ? `<span class="small">${b.bag_codes.map((code) => `<span class="tag">${esc(code)}</span>${b.bags_checked.includes(code) ? " ✓" : ""}`).join(" · ")}</span>` : ""}
          ${b.address?.instructions ? `<span class="small muted">${esc(b.address.instructions)}</span>` : ""}
          ${b.notes ? `<span class="small muted">${esc(b.notes)}</span>` : ""}
          ${b.order_id && me.role !== "driver" ? `<a class="small" href="#/orders/${b.order_id}">${esc(b.order_ref)}</a>` : b.order_ref ? `<span class="small">${esc(b.order_ref)}</span>` : ""}
        </div>
        <div class="acts">
          ${pill(b.status)}
          ${b.mode === "lave_collects" && me.role !== "driver" ? `<select data-driver="${b.id}" aria-label="Driver"><option value="">Unassigned</option>${drivers.map((x) => `<option value="${x.id}" ${b.driver?.id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : b.driver ? `<span class="small">${esc(b.driver.name)}</span>` : ""}
          ${b.atelier ? `<span class="small muted">${b.bags_checked.length} of ${b.bags} bag${b.bags === 1 ? "" : "s"} in</span>` : ""}
          ${!b.atelier && ["scheduled", "en_route"].includes(b.status) ? `<div class="row">
            ${b.status === "scheduled" && b.mode === "lave_collects" ? `<button class="btn sm" data-bstatus="en_route" data-id="${b.id}">En route</button>` : ""}
            <button class="btn sm primary" data-bstatus="completed" data-id="${b.id}">Done</button>
            <button class="btn sm ghost" data-bstatus="missed" data-id="${b.id}">Missed</button></div>` : ""}
        </div>
      </div>`;
    c.innerHTML = `
      ${me.role !== "driver" ? `<div class="pipeline">${PIPE.map((s) => `<a href="#/orders?status=${s}"><span class="n">${d.pipeline[s] || 0}</span><span class="l">${STATUS_LABEL[s]}</span></a>`).join("")}</div>
      <div class="alerts">
        ${d.ready_unpaid ? `<a class="alert" href="#/orders?status=ready">${d.ready_unpaid} ready but unpaid</a>` : ""}
        ${d.vault_retrievals ? `<a class="alert" href="#/vault?status=retrieval_requested">${d.vault_retrievals} Vault items to retrieve</a>` : ""}
      </div>` : ""}
      ${me.role !== "driver" ? `<section class="panel" id="coming-up"><h2>Coming up for members</h2><p class="loading">Loading…</p></section>` : ""}
      <section class="panel"><h2>Drop-off check-in</h2>
        <form id="checkin" class="row"><input name="code" placeholder="Scan or type a bag code, e.g. LV-7K2M9P-1" aria-label="Bag code" style="min-width:280px"><button class="btn primary">Check in</button></form>
        ${me.role !== "driver" ? `<details><summary class="small">Bags left without a booking</summary>
          <form id="unbooked" class="form-grid" style="margin-top:10px">
            <label>Member<input name="q" placeholder="Name, email or phone" autocomplete="off"></label>
            <label>Found<select name="client_id" required><option value="">Search first</option></select></label>
            <label>Atelier<select name="atelier_id" required></select></label>
            <label>Bags<input name="bags" type="number" min="1" max="20" value="1"></label>
            <label style="grid-column:span 2">Note<input name="note" placeholder="Left at the concierge desk"></label>
            <button class="btn">Log drop-off</button></form></details>` : ""}
      </section>
      <div class="cols">
        <section class="panel"><div class="row between"><h2>Collections</h2><span class="muted">${d.collections.length}</span></div>
          ${d.collections.length ? d.collections.map(run).join("") : `<p class="empty">No collections ${day === isoDay(new Date()) ? "today" : "on " + D.format(parse(day))}.</p>`}</section>
        <section class="panel"><div class="row between"><h2>Deliveries</h2><span class="muted">${d.deliveries.length}</span></div>
          ${d.deliveries.length ? d.deliveries.map(run).join("") : `<p class="empty">No deliveries ${day === isoDay(new Date()) ? "today" : "on " + D.format(parse(day))}.</p>`}</section>
      </div>`;
    c.querySelectorAll("[data-bstatus]").forEach((b) => b.addEventListener("click", act(() => api("PATCH", `/api/staff/bookings/${b.dataset.id}`, { status: b.dataset.bstatus }), "Updated")));
    const coming = c.querySelector("#coming-up");
    if (coming) api("GET", "/api/staff/coming-up?days=14").then((events) => {
      const KIND = { credit: "LAVE credit", gift: "Gift", experience: "Experience", note: "Note" };
      const when = (d) => D.format(parse(d));
      const gesture = (e) => {
        const g = e.gesture;
        const state = g.sent ? pill("completed").replace(/>[^<]+</, ">Sent<") : g.status === "approved" ? `<span class="pill ok">Approved by ${esc(g.decided_by)}</span>` : g.status === "skipped" ? `<span class="pill">Skipped</span>` : `<span class="pill warn">To review</span>`;
        return `<div class="stack" style="gap:6px;padding:12px 0;border-top:1px solid var(--line)">
          <div class="row between"><strong>🎂 ${esc(e.client.name)}'s birthday · ${when(e.day)}</strong>${state}</div>
          <span class="small"><a href="#/clients/${e.client.id}">${esc(e.client.full_name)}</a> · ${esc({ essence: "Essence", elevate: "Elevate", eclat: "Éclat" }[e.client.plan] || "")} member</span>
          <div class="notice"><strong>${esc(g.title)}</strong>${g.value_pence ? ` · ${money(g.value_pence)}` : ""} <span class="small muted">(${KIND[g.kind]})</span><br><span class="small">${esc(g.detail)}</span>
            ${g.reasons.length ? `<br><span class="small muted">Why: ${g.reasons.map(esc).join(" · ")}</span>` : ""}</div>
          ${!g.sent && g.status !== "approved" ? `<div class="row"><button class="btn sm primary" data-g-approve="${g.id}">Approve</button>
            <button class="btn sm" data-g-change="${g.id}">Choose another</button><button class="btn sm ghost" data-g-skip="${g.id}">Skip this year</button></div>
            <form class="stack" data-g-form="${g.id}" hidden>
              ${g.alternatives.length ? `<div class="stack small">${g.alternatives.map((alt, i) => `<label class="check-label"><input type="radio" name="pick" value="${i}"> <strong>${esc(alt.title)}</strong>${alt.value_pence ? " · " + money(alt.value_pence) : ""} <span class="muted">${esc(alt.detail)}</span></label>`).join("")}
                <label class="check-label"><input type="radio" name="pick" value="own" checked> My own idea:</label></div>` : ""}
              <div class="form-grid"><label>Gesture<input name="title" value="${esc(g.title)}"></label>
                <label>Type<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === g.kind ? "selected" : ""}>${l}</option>`).join("")}</select></label>
                <label>Value (£)<input name="value" value="${(g.value_pence / 100).toFixed(2)}"></label>
                <label style="grid-column:1/-1">Details for the birthday note<input name="detail" value="${esc(g.detail)}"></label></div>
              <div><button class="btn sm primary">Approve this instead</button></div></form>` : ""}
        </div>`;
      };
      const line = (e) => e.kind === "birthday" ? gesture(e)
        : `<div class="row between" style="padding:10px 0;border-top:1px solid var(--line)"><span>${e.kind === "anniversary" ? `✨ <a href="#/clients/${e.client.id}">${esc(e.client.full_name)}</a>: ${e.years} year${e.years === 1 ? "" : "s"} a member`
            : `📅 <a href="#/clients/${e.client.id}">${esc(e.client.full_name)}</a>: ${esc(e.title)}${e.note ? ` <span class="small muted">· ${esc(e.note)}</span>` : ""}`}</span><span class="small muted">${when(e.day)}</span></div>`;
      coming.innerHTML = `<h2>Coming up for members</h2><p class="small muted">Birthdays, anniversaries and occasions in the next two weeks. Approved gestures go out on the day; nothing reaches a member until you approve it.</p>
        ${events.length ? events.map(line).join("") : `<p class="empty">Nothing in the next two weeks.</p>`}`;
      const decide = (id, body, msg) => act(() => api("POST", `/api/staff/gestures/${id}`, body), msg)();
      coming.querySelectorAll("[data-g-approve]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.gApprove, { action: "approve" }, "Approved: it goes out on their birthday")));
      coming.querySelectorAll("[data-g-skip]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.gSkip, { action: "skip" }, "Skipped this year")));
      coming.querySelectorAll("[data-g-change]").forEach((b) => b.addEventListener("click", () => { coming.querySelector(`[data-g-form="${b.dataset.gChange}"]`).hidden = false; }));
      coming.querySelectorAll("[data-g-form]").forEach((f) => {
        const ev = events.find((e) => e.gesture?.id === Number(f.dataset.gForm));
        f.querySelectorAll("[name=pick]").forEach((r) => r.addEventListener("change", () => {
          const alt = ev.gesture.alternatives[Number(r.value)];
          if (!alt) return;
          f.title.value = alt.title; f.kind.value = alt.kind; f.value.value = (alt.value_pence / 100).toFixed(2); f.detail.value = alt.detail;
        }));
        f.addEventListener("submit", (e) => { e.preventDefault(); decide(f.dataset.gForm, { action: "approve", title: f.title.value, kind: f.kind.value,
          value_pence: toPence(f.value.value || "0"), detail: f.detail.value }, "Approved: it goes out on their birthday"); });
      });
    }).catch((ex) => { coming.innerHTML = `<h2>Coming up for members</h2><p class="error">${esc(ex.message)}</p>`; });
    c.querySelector("#checkin").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      if (!code) return;
      try {
        const r = await api("POST", "/api/staff/dropoffs/check-in", { code });
        toast(`${code.toUpperCase()} checked in · ${r.bags_checked.length} of ${r.bags} bag${r.bags === 1 ? "" : "s"} in for ${r.client.name}`);
        route();
      } catch (ex) { toast(ex.message, true); e.target.code.select(); }
    });
    const unbooked = c.querySelector("#unbooked");
    if (unbooked) {
      api("GET", "/api/staff/ateliers").then((list) => {
        unbooked.atelier_id.innerHTML = list.filter((a) => a.status !== "retired").map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("") || `<option value="">Add an atelier in Settings first</option>`;
      });
      let timer = null;
      unbooked.q.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const q = unbooked.q.value.trim();
          if (q.length < 2) return;
          const found = await api("GET", "/api/staff/clients?q=" + encodeURIComponent(q));
          unbooked.client_id.innerHTML = found.length ? found.map((x) => `<option value="${x.id}">${esc(x.full_name || x.email)} · ${esc(x.phone || x.email)}</option>`).join("") : `<option value="">No match</option>`;
        }, 250);
      });
      unbooked.addEventListener("submit", act(async (e) => {
        e.preventDefault();
        const f = e.target;
        const o = await api("POST", "/api/staff/dropoffs/unbooked", { client_id: Number(f.client_id.value), atelier_id: Number(f.atelier_id.value), bags: Number(f.bags.value) || 1, note: f.note.value });
        location.hash = "#/orders/" + o.id;
      }, "Drop-off logged"));
    }
    c.querySelectorAll("[data-driver]").forEach((s) => s.addEventListener("change", act(() => api("PATCH", `/api/staff/bookings/${s.dataset.driver}`, { driver_id: s.value ? Number(s.value) : null }), "Driver assigned")));
  }

  /* Orders */

  async function viewOrders(params) {
    const status = params.get("status") || "";
    const q = params.get("q") || "";
    const c = shell("orders", "Orders");
    c.innerHTML = `<form class="row" id="filters">
        <select name="status" aria-label="Status"><option value="">All active</option>${Object.keys(STATUS_LABEL).map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select>
        <input name="q" value="${esc(q)}" placeholder="Reference, name or email" aria-label="Search">
        <button class="btn">Filter</button>
      </form><div id="list"><p class="loading">Loading…</p></div>`;
    c.querySelector("#filters").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new URLSearchParams(new FormData(e.target));
      [...f.keys()].forEach((k) => { if (!f.get(k)) f.delete(k); });
      location.hash = "#/orders" + (f.toString() ? "?" + f : "");
    });
    const qs = new URLSearchParams();
    if (status) qs.set("status", status); else qs.set("active", "true");
    if (q) qs.set("q", q);
    const rows = await api("GET", "/api/staff/orders?" + qs);
    c.querySelector("#list").innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Client</th><th>Status</th><th class="num">Items</th><th class="num">Total</th><th>Payment</th><th>Next booking</th><th>Created</th></tr></thead>
      <tbody>${rows.map((o) => {
        const next = o.bookings.find((b) => b.status === "scheduled");
        return `<tr class="click" data-href="#/orders/${o.id}"><td><strong class="tag">${esc(o.ref)}</strong></td><td>${esc(o.client.name)}</td><td>${pill(o.status)}</td>
          <td class="num">${o.item_count}</td><td class="num">${money(o.total_pence)}</td><td>${pill(o.payment_status)}</td>
          <td class="small">${next ? `${next.kind === "collection" ? "Collect" : "Return"} ${D.format(parse(next.starts_at))} ${T.format(parse(next.starts_at))}` : "–"}</td>
          <td class="small muted">${D.format(parse(o.created_at))}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="empty">No orders match.</p>`;
    c.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
  }

  async function viewOrder(id) {
    const c = shell("orders", "Order");
    c.innerHTML = `<p class="loading">Loading…</p>`;
    const [o] = await Promise.all([api("GET", "/api/staff/orders/" + id), services.length ? null : api("GET", "/api/staff/services").then((s) => { services = s; })]);
    document.querySelector(".top h1").textContent = "Order " + o.ref;
    const itemsEditable = ["collected", "inspected", "in_care", "quality_check"].includes(o.status) && o.payment_status !== "paid";
    const removable = ["collected", "inspected"].includes(o.status) && o.payment_status !== "paid";
    const paid = ["paid", "waived"].includes(o.payment_status);
    const svcOptions = (sel) => {
      // Grouped by price-list category so 300+ items stay findable (type to jump within the list).
      const groups = {};
      services.filter((s) => s.active || s.id === sel).forEach((s) => { (groups[s.product_category || "Other"] ||= []).push(s); });
      return `<option value="">No service</option>` + Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((s) =>
        `<option value="${s.id}" data-price="${s.price_pence}" ${s.id === sel ? "selected" : ""}>${esc(s.name)} · ${s.sale_mode === "quote" ? "from " : ""}${money(s.price_pence)}</option>`).join("")}</optgroup>`).join("");
    };

    c.innerHTML = `
      <div class="row between">
        <div class="row">${pill(o.status)} ${pill(o.payment_status)} <a href="#/clients/${o.client.id}"><strong>${esc(o.client.name)}</strong></a> <span class="muted small">${esc(o.client.email)}</span></div>
        <div class="row">
          ${NEXT[o.status].map((s) => `<button class="btn ${s === "cancelled" ? "danger" : "primary"}" data-next="${s}">${ACTION_LABEL[s]}</button>`).join("")}
        </div>
      </div>
      ${o.status === "awaiting_customer_call" ? `<section class="panel stack"><h2>Call the client before charging</h2>
        <p class="small">The review differs from what was booked. Call ${esc(o.client.name)} to agree the change, then note what you agreed.</p>
        <pre class="small" style="white-space:pre-wrap;margin:0">${esc(o.call_notes)}</pre>
        <form id="call-done" class="stack"><label>What did you agree?<textarea name="note" required placeholder="Client agreed the sixth shirt at £6.99"></textarea></label>
          <div><button class="btn primary">Agreed: settle the difference</button></div></form></section>`
        : o.call_notes ? `<div class="notice"><strong>Call notes:</strong> <span style="white-space:pre-wrap">${esc(o.call_notes)}</span></div>` : ""}
      ${o.requested_wardrobe?.length ? `<div class="notice"><strong>Sending again from their Wardrobe:</strong> ${o.requested_wardrobe.map((w) => esc(w.title)).join(", ")}</div>` : ""}
      ${o.requested_items?.length ? `<div class="notice"><strong>Client's list${o.estimate_pence != null ? ` · estimate ${money(o.estimate_pence)}` : ""}:</strong>
        <ul class="plain-list">${o.requested_items.map((l) => `<li>${l.qty} × ${esc(l.name)}${l.kind === "pack" ? ` <span class="small muted">pack: ${esc(l.detail)}</span>` : ""}${l.priced_later ? ` <span class="small muted">(quote)</span>` : ""}
          ${itemsEditable && l.kind === "item" ? `<button class="link small" data-prefill="${l.id}" data-name="${esc(l.name)}">Add</button>` : ""}</li>`).join("")}</ul></div>` : ""}
      ${o.client_notes || o.requested_services.length ? `<div class="notice"><strong>From the client:</strong> ${esc(o.requested_services.map(human).join(", "))}${o.client_notes ? (o.requested_services.length ? " · " : "") + esc(o.client_notes) : ""}</div>` : ""}
      <div class="cols-3">
        <div class="stack">
          <section class="panel">
            <div class="row between"><h2>Garments</h2>${o.items.length ? `<button class="btn sm ghost" id="print">Print tags</button>` : ""}</div>
            ${o.items.length ? `<div class="table-wrap"><table>
              <thead><tr><th>Tag</th><th>Item</th><th>Service</th><th>Status</th><th>Vault</th><th class="num">Price</th><th></th></tr></thead>
              <tbody>${o.items.map((i) => `<tr>
                <td class="tag">${esc(i.tag_code)}</td>
                <td>${esc([i.colour, i.brand, i.description].filter(Boolean).join(" "))}${i.fibre ? `<br><span class="small muted">${esc(i.fibre)}</span>` : ""}${i.condition_notes ? `<br><span class="small muted">${esc(i.condition_notes)}</span>` : ""}</td>
                <td>${itemsEditable ? `<select data-item-svc="${i.id}" aria-label="Service">${svcOptions(i.service?.id)}</select>` : esc(i.service?.name || "–")}</td>
                <td>${pill(i.status)}</td>
                <td>${itemsEditable ? `<input type="checkbox" data-item-vault="${i.id}" ${i.send_to_vault ? "checked" : ""} aria-label="Send to Vault">` : i.send_to_vault ? "Yes" : ""}</td>
                <td class="num">${itemsEditable ? `<input data-item-price="${i.id}" value="${(i.price_pence / 100).toFixed(2)}" size="6" aria-label="Price" style="text-align:right">` : money(i.price_pence)}</td>
                <td>${removable ? `<button class="link small" data-item-del="${i.id}">Remove</button>` : ""}</td></tr>`).join("")}</tbody>
              <tfoot>
                <tr><td colspan="5">Items</td><td class="num">${money(o.items_total_pence)}</td><td></td></tr>
                ${o.minimum_pence ? `<tr><td colspan="5">Minimum order top-up <span class="small muted">minimum ${paid ? money(o.minimum_pence) : `<input id="minimum" value="${(o.minimum_pence / 100).toFixed(2)}" size="5" style="text-align:right" aria-label="Minimum order">`}; set 0 to waive</span></td><td class="num">${money(o.minimum_top_up_pence)}</td><td></td></tr>` : ""}
                ${o.missed_visits_pence ? `<tr><td colspan="5">Missed visits <span class="small muted">first one free, then the collection and delivery charge</span></td><td class="num">${money(o.missed_visits_pence)}</td><td></td></tr>` : ""}
                <tr><td colspan="5">Collection and delivery${o.delivery_basis?.manual ? ' <span class="small muted">set by hand</span>' : ""}</td><td class="num">${paid ? money(o.fees_pence) : `<input id="fees" value="${(o.fees_pence / 100).toFixed(2)}" size="6" style="text-align:right" aria-label="Fees">`}</td><td></td></tr>
                <tr><td colspan="5">Discount</td><td class="num">${paid ? "−" + money(o.discount_pence) : `<input id="discount" value="${(o.discount_pence / 100).toFixed(2)}" size="6" style="text-align:right" aria-label="Discount">`}</td><td></td></tr>
                <tr><td colspan="5">Total</td><td class="num">${money(o.total_pence)}</td><td></td></tr>
              </tfoot></table></div>` : `<p class="empty">No garments yet. Add each piece as you inspect the bag.</p>`}
            ${itemsEditable ? `<form id="add-item" class="form-grid">
              ${o.client_wardrobe?.length ? `<label style="grid-column:span 2">Same piece as before?<select name="wardrobe_item_id"><option value="">New piece</option>
                ${o.client_wardrobe.map((w) => `<option value="${w.id}" data-service="${w.service_id || ""}" data-title="${esc(w.title)}" ${o.requested_wardrobe?.some((r) => r.id === w.id) ? "" : ""}>${esc(w.title)}${o.requested_wardrobe?.some((r) => r.id === w.id) ? " (requested)" : ""}</option>`).join("")}</select></label>` : ""}
              <label style="grid-column:span 2">Description<input name="description" required placeholder="e.g. Silk blouse"></label>
              <label>Service<select name="service_id">${svcOptions(null)}</select></label>
              <label>Price (£)<input name="price" placeholder="From service"></label>
              <label>Colour<input name="colour"></label>
              <label>Brand<input name="brand"></label>
              <label>Fibre<input name="fibre" placeholder="Silk, wool…"></label>
              <label style="grid-column:span 2">Condition<input name="condition_notes" placeholder="Stains, damage, missing buttons"></label>
              <label class="check-label"><input type="checkbox" name="send_to_vault"> Store in the Vault</label>
              <button class="btn primary" type="submit">Add garment</button>
            </form>` : ""}
          </section>
          <section class="panel">
            <h2>Payment</h2>
            <dl class="kv"><dt>Total</dt><dd><strong>${money(o.total_pence)}</strong>${o.items.length ? "" : ' <span class="small muted">not counted yet</span>'}</dd><dt>Status</dt><dd>${pill(o.payment_status)}${o.paid_at ? ` <span class="small muted">${DT.format(parse(o.paid_at))}</span>` : ""}</dd>
              ${o.payments.filter((p) => p.status === "succeeded").map((p) => `<dt>${{ booking: "Paid at booking", adjustment: "Paid after review", refund: "Credit refunded" }[p.kind]}</dt><dd>${money(p.amount_pence)}</dd>`).join("")}
              ${o.credit_used_pence ? `<dt>Account credit used</dt><dd>${money(o.credit_used_pence)}</dd>` : ""}
              ${o.credited_pence ? `<dt>Credited to account</dt><dd>${money(o.credited_pence)}</dd>` : ""}
              <dt>${o.balance_pence < 0 ? "We owe" : "Still to pay"}</dt><dd><strong>${money(Math.abs(o.balance_pence))}</strong></dd>
              <dt>Card</dt><dd>${o.client.has_card_on_file ? "On file" : '<span class="muted">None. Ask the client to add one from their account.</span>'}</dd></dl>
            ${!paid ? `<div class="row">
              <button class="btn primary" id="charge" ${o.items.length && o.status !== "awaiting_customer_call" && (o.balance_pence <= 0 || o.client.has_card_on_file) ? "" : "disabled"}>${o.balance_pence > 0 ? `Charge ${money(o.balance_pence)} to card` : o.balance_pence < 0 ? `Credit ${money(-o.balance_pence)} to their account` : "Settle"}</button>
              ${me.role === "admin" ? `<button class="btn" data-manual="paid">Record paid in person</button><button class="btn ghost" data-manual="waived">Waive</button>` : ""}
            </div>` : ""}
          </section>
        </div>
        <div class="stack">
          <section class="panel"><h2>Bookings</h2>
            ${o.return_preference ? `<p class="small notice">Some items need longer: ${o.return_preference === "split" ? "split return (48-hour items first)" : "return together once everything is ready"}.</p>` : ""}
            ${o.bookings.length ? o.bookings.map((b) => `<div class="stack" style="gap:2px"><div class="row between"><strong>${b.atelier ? "Drop-off" : b.kind === "collection" ? "Collection" : "Return"}</strong>${pill(b.status)}</div>
              <span class="small">${D.format(parse(b.starts_at))}, ${T.format(parse(b.starts_at))}–${T.format(parse(b.ends_at))} · ${b.atelier ? esc(b.atelier.name) : b.window_type === "hour" ? "One-hour" : "Saver"}</span>
              ${b.bag_codes?.length ? `<span class="small">${b.bag_codes.map((code) => `<span class="tag">${esc(code)}</span>${b.bags_checked.includes(code) ? " ✓" : ""}`).join(" · ")}</span>` : ""}
              ${b.address ? `<span class="small muted">${esc(b.address.one_line)}</span>` : ""}
              ${b.missed ? `<span class="small warn-text">Missed ${b.missed}×${b.missed_fee_pence ? `, ${money(b.missed_fee_pence)} charged` : ", first one free"}</span>` : ""}
              ${["scheduled", "missed"].includes(b.status) && !b.atelier && b.mode === "lave_collects" ? `<details data-move="${b.id}" data-kind="${b.kind}" data-window="${b.window_type}"><summary class="small">${b.status === "missed" ? "Rebook" : "Move to another time"}</summary><div class="stack" style="margin-top:8px"><div data-chooser></div><div class="row"><button class="btn sm primary" data-move-go disabled>Move</button></div></div></details>` : ""}</div>`).join("") : `<p class="muted small">Walk-in order, no bookings.</p>`}
            ${!["delivered", "cancelled"].includes(o.status) && o.bookings.some((b) => b.kind === "collection" && b.status !== "cancelled") ? `<details id="ret"><summary class="small">Book a return</summary>
              <form id="return-form" class="form-grid" style="margin-top:10px">
                <p class="small muted" id="ret-ready" style="grid-column:1/-1"></p>
                <label>Day<input type="date" name="day" required></label>
                <label>Window<select name="window"><option value="saver">Saver</option><option value="hour">One-hour</option></select></label>
                <label style="grid-column:span 2">Time<select name="slot" required><option value="">Choose a day</option></select></label>
                <label style="grid-column:span 2">Address<select name="address" required></select></label>
                <button class="btn primary">Book return</button></form></details>` : ""}
          </section>
          <section class="panel"><h2>Staff notes</h2>
            <textarea id="staff-notes" placeholder="Visible to staff only">${esc(o.staff_notes)}</textarea>
            <button class="btn sm" id="save-notes">Save notes</button></section>
          <section class="panel"><h2>History</h2>
            <ul class="timeline">${o.timeline.slice().reverse().map((e) => `<li><span class="small muted">${DT.format(parse(e.at))}</span><span>${esc(STATUS_LABEL[e.status] || human(e.status))}${e.note ? ` <span class="muted">· ${esc(e.note)}</span>` : ""}</span></li>`).join("")}</ul></section>
        </div>
      </div>
      <div class="tags-print">${o.items.map((i) => `<div><strong>${esc(i.tag_code)}</strong>${esc(o.client.name)}<br>${esc(i.description)}<br>${esc(i.service?.name || "")}</div>`).join("")}</div>`;

    const reviewToast = (r) => {
      const v = r.review || {};
      if (v.on_hold) toast("On hold: call the client to agree the change before charging.", true);
      else if (v.error) toast(v.error, true);
      else if (v.charged) toast(`Inspected. ${money(v.charged)} charged to the saved card.`);
      else if (v.credited) toast(`Inspected. ${money(v.credited)} credited to the client's LAVE account.`);
      else toast("Inspected. Nothing more to charge.");
      route();
    };
    c.querySelector("#call-done")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { reviewToast(await api("POST", `/api/staff/orders/${id}/status`, { status: "inspected", note: e.target.note.value })); }
      catch (ex) { toast(ex.message, true); }
    });
    c.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.next === "inspected") {
        try { reviewToast(await api("POST", `/api/staff/orders/${id}/status`, { status: "inspected" })); }
        catch (ex) { toast(ex.message, true); }
        return;
      }
      if (b.dataset.next === "cancelled") {
        b.outerHTML = `<span class="row"><span class="small">Cancel this order?</span><button class="btn danger" id="confirm-cancel">Yes, cancel</button></span>`;
        c.querySelector("#confirm-cancel").addEventListener("click", act(() => api("POST", `/api/staff/orders/${id}/status`, { status: "cancelled" }), "Order cancelled"));
        return;
      }
      act(() => api("POST", `/api/staff/orders/${id}/status`, { status: b.dataset.next }), STATUS_LABEL[b.dataset.next])();
    }));
    c.querySelectorAll("[data-prefill]").forEach((b) => b.addEventListener("click", () => {
      const f = c.querySelector("#add-item");
      f.description.value = b.dataset.name;
      f.service_id.value = b.dataset.prefill;
      f.scrollIntoView({ behavior: "smooth", block: "center" });
      f.colour.focus();
    }));
    c.querySelector("#add-item")?.addEventListener("submit", act(async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      await api("POST", `/api/staff/orders/${id}/items`, {
        description: f.description, service_id: f.service_id ? Number(f.service_id) : null, colour: f.colour, brand: f.brand,
        fibre: f.fibre, condition_notes: f.condition_notes, send_to_vault: !!f.send_to_vault,
        price_pence: f.price ? toPence(f.price) : null,
        wardrobe_item_id: f.wardrobe_item_id ? Number(f.wardrobe_item_id) : null,
      });
      setTimeout(() => document.querySelector("#add-item input[name=description]")?.focus(), 50);
    }, "Garment added"));
    // Picking a Wardrobe piece fills in what we know about it.
    c.querySelector("#add-item select[name=wardrobe_item_id]")?.addEventListener("change", (e) => {
      const opt = e.target.selectedOptions[0], form = e.target.form;
      if (!opt.value) return;
      form.description.value = opt.dataset.title;
      if (opt.dataset.service) form.service_id.value = opt.dataset.service;
    });
    c.querySelectorAll("[data-item-svc]").forEach((s) => s.addEventListener("change", act(() => {
      const price = s.selectedOptions[0]?.dataset.price;
      return api("PATCH", `/api/staff/items/${s.dataset.itemSvc}`, { service_id: s.value ? Number(s.value) : null, ...(price ? { price_pence: Number(price) } : {}) });
    }, "Updated")));
    c.querySelectorAll("[data-item-price]").forEach((i) => i.addEventListener("change", act(() => api("PATCH", `/api/staff/items/${i.dataset.itemPrice}`, { price_pence: toPence(i.value) }), "Price updated")));
    c.querySelectorAll("[data-item-vault]").forEach((i) => i.addEventListener("change", act(() => api("PATCH", `/api/staff/items/${i.dataset.itemVault}`, { send_to_vault: i.checked }), "Updated")));
    c.querySelectorAll("[data-item-del]").forEach((b) => b.addEventListener("click", act(() => api("DELETE", `/api/staff/items/${b.dataset.itemDel}`), "Removed")));
    c.querySelector("#fees")?.addEventListener("change", act((e) => api("PATCH", `/api/staff/orders/${id}`, { fees_pence: toPence(e.target.value) }), "Fees updated"));
    c.querySelector("#discount")?.addEventListener("change", act((e) => api("PATCH", `/api/staff/orders/${id}`, { discount_pence: toPence(e.target.value) }), "Discount updated"));
    c.querySelectorAll("details[data-move]").forEach((d) => d.addEventListener("toggle", async () => {
      if (!d.open || d.dataset.ready) return;
      d.dataset.ready = "1";
      let chosen = null;
      const go = d.querySelector("[data-move-go]");
      const after = d.dataset.kind === "delivery" ? (await api("GET", `/api/staff/orders/${id}/earliest-return`)).earliest_return : null;
      slotChooser(d.querySelector("[data-chooser]"), { windowType: d.dataset.window, fixedWindow: true, after, onPick: (slot) => { chosen = slot; go.disabled = !slot; } });
      go.addEventListener("click", act(() => api("POST", `/api/staff/bookings/${d.dataset.move}/move`, { template_id: chosen.template_id, day: chosen.day }), "Moved. The client has been emailed."));
    }));
    c.querySelector("#minimum")?.addEventListener("change", act((e) => api("PATCH", `/api/staff/orders/${id}`, { minimum_pence: toPence(e.target.value) || 0 }), "Minimum order updated"));
    c.querySelector("#save-notes").addEventListener("click", act(() => api("PATCH", `/api/staff/orders/${id}`, { staff_notes: c.querySelector("#staff-notes").value }), "Notes saved"));
    c.querySelector("#charge")?.addEventListener("click", act(() => api("POST", `/api/staff/orders/${id}/charge`), "Payment taken"));
    c.querySelectorAll("[data-manual]").forEach((b) => b.addEventListener("click", act(() => api("POST", `/api/staff/orders/${id}/payment`, { status: b.dataset.manual }), "Payment recorded")));
    c.querySelector("#print")?.addEventListener("click", () => window.print());
    const rf = c.querySelector("#return-form");
    if (rf) {
      let ready = null;
      c.querySelector("#ret").addEventListener("toggle", async () => {
        if (ready) return;
        ready = await api("GET", `/api/staff/orders/${id}/earliest-return`).catch(() => ({}));
        rf.querySelector("#ret-ready").textContent = ready.text || "";
        if (ready.earliest_return) rf.day.value = rf.day.min = ready.earliest_return.slice(0, 10);
        const client = await api("GET", "/api/staff/clients/" + o.client.id);
        rf.address.innerHTML = client.addresses.map((a) => `<option value="${a.id}" ${a.in_zone === false ? "disabled" : ""}>${esc(a.one_line)}${a.in_zone === false ? " · not yet in our area" : ""}</option>`).join("") || `<option value="">No saved address</option>`;
        loadSlots();
      });
      const loadSlots = async () => {
        if (!rf.day.value) return;
        const q = new URLSearchParams({ start: rf.day.value, days: "1", window: rf.window.value, ...(ready?.earliest_return ? { after: ready.earliest_return } : {}) });
        const slots = await api("GET", "/api/slots?" + q);
        rf.slot.innerHTML = slots.filter((s) => s.available).map((s) => `<option value="${s.template_id}">${T.format(parse(s.starts_at))}–${T.format(parse(s.ends_at))} · ${s.remaining} left</option>`).join("") || `<option value="">Nothing free that day</option>`;
      };
      rf.day.addEventListener("change", loadSlots);
      rf.window.addEventListener("change", loadSlots);
      rf.addEventListener("submit", act((e) => {
        e.preventDefault();
        return api("POST", `/api/staff/orders/${id}/return`, { slot: { template_id: Number(rf.slot.value), day: rf.day.value }, address_id: Number(rf.address.value) });
      }, "Return booked"));
    }
  }

  /* Clients */

  async function viewClients(params) {
    const q = params.get("q") || "";
    const c = shell("clients", "Clients");
    c.innerHTML = `<div class="row between"><form class="row" id="search"><input name="q" value="${esc(q)}" placeholder="Name, email or phone" aria-label="Search clients"><button class="btn">Search</button></form>
      <button class="btn primary" id="new-client">New client</button></div>
      <form id="client-form" class="panel form-grid" hidden>
        <label>Email<input name="email" type="email" required></label><label>First name<input name="first_name"></label>
        <label>Last name<input name="last_name"></label><label>Phone<input name="phone"></label>
        <button class="btn primary" type="submit">Create client</button></form>
      <div id="list"><p class="loading">Loading…</p></div>`;
    c.querySelector("#search").addEventListener("submit", (e) => { e.preventDefault(); location.hash = "#/clients?q=" + encodeURIComponent(e.target.q.value); });
    c.querySelector("#new-client").addEventListener("click", () => { c.querySelector("#client-form").hidden = false; });
    c.querySelector("#client-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const cl = await api("POST", "/api/staff/clients", Object.fromEntries(new FormData(e.target).entries())); location.hash = "#/clients/" + cl.id; }
      catch (ex) { toast(ex.message, true); }
    });
    const showAll = params.get("unconfirmed") === "1";
    const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(showAll ? { unconfirmed: "true" } : {}) });
    const [rows, unconf] = await Promise.all([api("GET", "/api/staff/clients?" + qs), api("GET", "/api/staff/clients/unconfirmed")]);
    if (unconf.count) {
      c.querySelector("#list").insertAdjacentHTML("beforebegin", `<p class="notice small">${unconf.count} website sign-up${unconf.count === 1 ? "" : "s"} never confirmed their email (mostly bots using other people's addresses) ${showAll ? "are shown below" : "are hidden"}.
        <a href="#/clients?${showAll ? "" : "unconfirmed=1"}">${showAll ? "Hide them" : "Show them"}</a>${me.role === "admin" ? ` · <button class="link small" id="purge">Remove those older than 2 days</button>` : ""}</p>`);
      c.querySelector("#purge")?.addEventListener("click", (e) => {
        e.target.outerHTML = `<span class="small">Delete unconfirmed sign-ups older than 2 days that have no orders, bookings, membership or address? This can't be undone. <button class="btn danger sm" id="purge-yes">Remove</button></span>`;
        c.querySelector("#purge-yes").addEventListener("click", async () => {
          try { const r = await api("POST", "/api/staff/clients/remove-unconfirmed", { days: 2 }); toast(`Removed ${r.removed} unconfirmed sign-up${r.removed === 1 ? "" : "s"}`); route(); }
          catch (ex) { toast(ex.message, true); }
        });
      });
    }
    c.querySelector("#list").innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Membership</th><th>Card</th><th>Joined</th></tr></thead>
      <tbody>${rows.map((x) => `<tr class="click" data-href="#/clients/${x.id}"><td><strong>${esc(x.full_name)}</strong>${x.deletion_requested_at && !x.deleted_at ? ' <span class="pill warn">Asked to delete</span>' : ""}</td><td>${esc(x.email)}</td><td>${esc(x.phone)}</td>
        <td>${x.membership ? pill(x.membership.status === "active" ? x.membership.plan_name : x.membership.status) : "–"}</td><td>${x.has_card_on_file ? "On file" : "–"}</td>
        <td class="small muted">${D.format(parse(x.created_at))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No clients found.</p>`;
    c.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
  }

  async function viewClient(id) {
    const c = shell("clients", "Client");
    c.innerHTML = `<p class="loading">Loading…</p>`;
    const x = await api("GET", "/api/staff/clients/" + id);
    document.querySelector(".top h1").textContent = x.full_name;
    const prefs = Object.entries(x.preferences || {});
    c.innerHTML = `
      <div class="row between"><div class="row">${x.membership ? pill(x.membership.status === "active" ? x.membership.plan_name + " member" : "Membership " + x.membership.status) : ""}
        <span class="muted small">${x.paid_orders} paid orders</span>
        ${x.missed_12m ? `<span class="pill ${x.missed_12m > 1 ? "err" : "warn"}">Missed ${x.missed_12m}× in 12 months</span>` : ""}
        ${me.role === "admin" && x.membership && x.membership.status !== "cancelled" ? `<span id="end-box"><button class="link small danger-text" id="end-membership">End membership</button></span>` : ""}</div>
        <div class="row"><button class="btn primary" id="book-for">Book a collection</button><button class="btn" id="walk-in">New walk-in order</button></div></div>
      <div id="book-for-box" hidden></div>
      ${x.deleted_at ? `<p class="notice">This client was deleted on ${D.format(parse(x.deleted_at))}. Their orders are kept for the records, without personal details.</p>` : ""}
      ${x.deletion_requested_at && !x.deleted_at ? `<div class="notice row between"><span><strong>Asked to delete their account</strong> on ${D.format(parse(x.deletion_requested_at))}. Respond within one month.</span>${me.role === "admin" ? `<span id="delete-box"><button class="btn danger sm" id="delete-client">Delete client…</button></span>` : ""}</div>` : ""}
      <div class="cols-3">
        <div class="stack">
          <section class="panel"><h2>Orders</h2>
            ${x.orders.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Status</th><th class="num">Items</th><th class="num">Total</th><th>Payment</th><th>Created</th></tr></thead>
              <tbody>${x.orders.map((o) => `<tr class="click" data-href="#/orders/${o.id}"><td class="tag"><strong>${esc(o.ref)}</strong></td><td>${pill(o.status)}</td><td class="num">${o.item_count}</td>
              <td class="num">${money(o.total_pence)}</td><td>${pill(o.payment_status)}</td><td class="small muted">${D.format(parse(o.created_at))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No orders yet.</p>`}
          </section>
          <section class="panel"><h2>Vault</h2>
            ${x.vault.length ? `<div class="table-wrap"><table><thead><tr><th>Tag</th><th>Item</th><th>Location</th><th>Status</th><th>Stored</th></tr></thead>
              <tbody>${x.vault.map((v) => `<tr><td class="tag">${esc(v.tag_code)}</td><td>${esc(v.description)}</td><td>${esc(v.location || "–")}</td><td>${pill(v.status)}</td><td class="small muted">${D.format(parse(v.stored_at))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nothing stored.</p>`}
          </section>
        </div>
        <div class="stack">
          <section class="panel"><h2>Contact</h2>
            <form id="client-edit" class="stack">
              <div class="form-grid"><label>First name<input name="first_name" value="${esc(x.first_name)}"></label><label>Last name<input name="last_name" value="${esc(x.last_name)}"></label></div>
              <label>Email<input value="${esc(x.email)}" disabled></label>
              <label>Phone<input name="phone" value="${esc(x.phone)}"></label>
              <label>Staff notes<textarea name="staff_notes" placeholder="Allergies to fragrance, concierge name, VIP…">${esc(x.staff_notes)}</textarea></label>
              <button class="btn sm" type="submit">Save</button></form></section>
          <section class="panel"><h2>Care preferences</h2>
            ${prefs.length ? `<dl class="kv">${prefs.map(([k, v]) => `<dt>${esc(human(k))}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : `<p class="muted small">None set. Clients set these from their account.</p>`}</section>
          <section class="panel"><h2>Addresses</h2>
            ${x.addresses.length ? x.addresses.map((a) => `<p class="small"><strong>${esc(a.label)}</strong>${a.is_default ? " (default)" : ""}<br>${esc(a.one_line)}${a.instructions ? `<br><span class="muted">${esc(a.instructions)}</span>` : ""}</p>`).join("") : `<p class="muted small">No addresses.</p>`}</section>
          <section class="panel" id="about-them"><h2>About them</h2><p class="loading">Loading…</p></section>
          <section class="panel" id="credit"><h2>LAVE account credit</h2><p class="loading">Loading…</p></section>
          <section class="panel"><h2>Account</h2><dl class="kv">
            <dt>Card</dt><dd>${x.has_card_on_file ? "On file" : "None"}</dd>
            <dt>Website</dt><dd>${x.wp_user_id ? "Linked (user " + x.wp_user_id + ")" : "Not linked yet"}</dd>
            <dt>Stripe</dt><dd class="small">${esc(x.stripe_customer_id || "–")}</dd></dl>
            ${me.role === "admin" && !x.deleted_at && !x.deletion_requested_at ? `<p class="small" id="delete-box-2"><button class="link small danger-text" id="delete-client-2">Delete this client…</button></p>` : ""}</section>
        </div>
      </div>`;
    c.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
    c.querySelector("#client-edit").addEventListener("submit", act((e) => { e.preventDefault(); return api("PATCH", "/api/staff/clients/" + id, Object.fromEntries(new FormData(e.target).entries())); }, "Saved"));
    c.querySelector("#end-membership")?.addEventListener("click", () => {
      const box = c.querySelector("#end-box");
      box.innerHTML = `<span class="small">End ${esc(x.membership.plan_name)} now? Billing stops and benefits end today.</span>
        <button class="btn danger sm" data-yes>End membership</button> <button class="btn ghost sm" data-no>Keep</button>`;
      box.querySelector("[data-no]").addEventListener("click", () => route());
      box.querySelector("[data-yes]").addEventListener("click", async () => {
        try { const r = await api("POST", `/api/staff/clients/${id}/membership/end`); toast(r.note); route(); } catch (e) { toast(e.message, true); }
      });
    });
    api("GET", `/api/staff/clients/${id}/about`).then((ab) => {
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const rows = [["Call them", ab.preferred_name], ["Birthday", ab.birthday_day ? `${ab.birthday_day} ${MONTHS[ab.birthday_month - 1]}` : ""],
        ["Contact", [ab.channel_options[ab.contact_channel] !== "No preference" ? ab.channel_options[ab.contact_channel] : "", ab.contact_times].filter(Boolean).join(", ")],
        ["Special pieces", ab.special_pieces], ["Allergies", ab.allergies], ["Enjoys", ab.interests.join(", ")], ["Dietary", ab.dietary],
        ["Household", ab.household.map((h) => [h.name, h.relation, h.age].filter(Boolean).join(", ")).join("; ")],
        ["Journal", ab.feature_ok ? "Happy to be featured (ask first)" : ""]].filter(([, v]) => v);
      c.querySelector("#about-them").innerHTML = `<h2>About them</h2>
        ${rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : `<p class="muted small">Nothing yet. Members fill this in under Account → About you.</p>`}
        ${ab.occasions.length ? `<p class="small"><strong>Coming up:</strong> ${ab.occasions.map((o) => `${esc(o.title)} (${D.format(parse(o.day))})`).join(", ")}</p>` : ""}
        <details><summary class="small">Add what they told you</summary><form id="about-edit" class="form-grid" style="margin-top:8px">
          <label>Birthday day<input name="birthday_day" type="number" min="1" max="31" value="${ab.birthday_day ?? ""}"></label>
          <label>Month<input name="birthday_month" type="number" min="1" max="12" value="${ab.birthday_month ?? ""}"></label>
          <label style="grid-column:span 2">Call them<input name="preferred_name" value="${esc(ab.preferred_name)}"></label>
          <label style="grid-column:1/-1">Special pieces<input name="special_pieces" value="${esc(ab.special_pieces)}"></label>
          <button class="btn sm">Save</button></form></details>`;
      c.querySelector("#about-edit").addEventListener("submit", act((e) => {
        e.preventDefault();
        const f = e.target;
        return api("PUT", `/api/staff/clients/${id}/about`, { birthday_day: f.birthday_day.value ? Number(f.birthday_day.value) : null,
          birthday_month: f.birthday_month.value ? Number(f.birthday_month.value) : null, preferred_name: f.preferred_name.value, special_pieces: f.special_pieces.value });
      }, "Saved"));
    }).catch(() => c.querySelector("#about-them")?.remove());
    api("GET", `/api/staff/clients/${id}/credit`).then((cr) => {
      const box = c.querySelector("#credit");
      box.innerHTML = `<h2>LAVE account credit</h2><p><strong>${money(cr.balance_pence)}</strong> <span class="small muted">used automatically on their next booking</span></p>
        ${cr.history.length ? `<ul class="timeline">${cr.history.slice(0, 10).map((h) => `<li><span class="small muted">${h.at ? DT.format(parse(h.at)) : ""}</span><span>${h.amount_pence > 0 ? "+" : "−"}${money(Math.abs(h.amount_pence))} · ${esc(h.reason)}${h.expires_at ? ` <span class="muted">(expires ${D.format(parse(h.expires_at))})</span>` : ""}</span></li>`).join("")}</ul>` : ""}
        ${me.role === "admin" && cr.balance_pence ? `<button class="btn sm" id="refund-credit">Refund ${money(cr.balance_pence)} to their card</button>` : ""}`;
      box.querySelector("#refund-credit")?.addEventListener("click", act(() => api("POST", `/api/staff/clients/${id}/credit/refund`, {}), "Credit refunded to card"));
    }).catch(() => { c.querySelector("#credit").remove(); });
    c.querySelector("#book-for").addEventListener("click", () => bookForClient(c.querySelector("#book-for-box"), x));
    const askDelete = async () => {
      const box = c.querySelector("#delete-box") || c.querySelector("#delete-box-2");
      const chk = await api("GET", `/api/staff/clients/${id}/delete-check`);
      box.innerHTML = chk.blockers.length
        ? `<span class="small warn-text">Not yet: ${esc(chk.blockers.join("; "))}.</span>`
        : `<span class="small">Remove their name, contact details, addresses, notes, About them and Wardrobe for good? Orders and payments stay, without personal details. Their saved card is removed from Stripe.</span>
           <button class="btn danger sm" data-yes>Delete for good</button> <button class="btn ghost sm" data-no>Keep</button>`;
      box.querySelector("[data-no]")?.addEventListener("click", () => route());
      box.querySelector("[data-yes]")?.addEventListener("click", act(() => api("DELETE", `/api/staff/clients/${id}`), "Client deleted"));
    };
    c.querySelector("#delete-client")?.addEventListener("click", askDelete);
    c.querySelector("#delete-client-2")?.addEventListener("click", askDelete);
    c.querySelector("#walk-in").addEventListener("click", async () => {
      try { const o = await api("POST", "/api/staff/orders", { client_id: Number(id) }); location.hash = "#/orders/" + o.id; }
      catch (e) { toast(e.message, true); }
    });
  }

  /* Pick a home-visit time: a day, a window type, then one of that day's open slots. Used when staff book or move a
     visit for a client. `after` (ISO) hides anything earlier, e.g. a return before the items are ready. */
  function slotChooser(box, { windowType = "saver", fixedWindow = false, after = null, onPick }) {
    const first = after ? after.slice(0, 10) : isoDay(new Date(Date.now() + 86400000));
    box.innerHTML = `<div class="row"><label>Day<input type="date" data-day value="${first}" min="${first}"></label>
        ${fixedWindow ? `<span class="small muted">${windowType === "hour" ? "One-hour" : "Saver"} window</span>` : `<label>Window<select data-window><option value="saver" ${windowType === "saver" ? "selected" : ""}>Saver (3 hours)</option><option value="hour" ${windowType === "hour" ? "selected" : ""}>One hour</option></select></label>`}</div>
      <div class="chips" data-slots><p class="loading">Finding times…</p></div>`;
    const load = async () => {
      const day = box.querySelector("[data-day]").value, win = box.querySelector("[data-window]")?.value || windowType;
      const list = box.querySelector("[data-slots]");
      onPick(null);
      if (!day) { list.innerHTML = ""; return; }
      const q = new URLSearchParams({ start: day, days: "1", window: win, mode: "lave_collects" });
      if (after) q.set("after", after);
      try {
        const slots = (await api("GET", "/api/slots?" + q)).filter((x) => x.day === day);
        list.innerHTML = slots.length ? slots.map((x, i) => `<button type="button" class="btn sm" data-i="${i}" ${x.available ? "" : "disabled"}>${T.format(parse(x.starts_at))}–${T.format(parse(x.ends_at))}${x.available ? "" : " (full)"}</button>`).join("")
          : `<p class="small muted">No times open that day.</p>`;
        list.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => {
          list.querySelectorAll("[data-i]").forEach((x) => x.classList.toggle("primary", x === b));
          onPick(slots[Number(b.dataset.i)]);
        }));
      } catch (e) { list.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    box.querySelector("[data-day]").addEventListener("change", load);
    box.querySelector("[data-window]")?.addEventListener("change", load);
    load();
  }

  /* Book a collection for a client (by phone, for a concierge). Nothing is charged now: settled after review. */
  function bookForClient(box, x) {
    const id = x.id, usable = x.addresses.filter((a) => a.in_zone !== false);
    const st = { collection: null, delivery: null };
    box.hidden = false;
    box.innerHTML = `<section class="panel stack"><h2>Book a collection for ${esc(x.first_name || x.full_name)}</h2>
      <p class="small muted">We'll email them the confirmation. Nothing is charged now: the order is settled after the atelier's review (the minimum order still applies then).</p>
      <div class="form-grid">
        <label style="grid-column:span 2">Address<select data-address>${usable.map((a) => `<option value="${a.id}" ${a.is_default ? "selected" : ""}>${esc(a.label)}: ${esc(a.one_line)}</option>`).join("")}<option value="new">+ A new address…</option></select></label>
        ${x.phone ? "" : `<label>Mobile (for the driver's text)<input data-phone placeholder="07700 900123"></label>`}
      </div>
      <form data-new-address class="form-grid" ${usable.length ? "hidden" : ""}>
        <label>Label<input name="label" value="Home"></label><label style="grid-column:span 2">Address line 1<input name="line1" required></label>
        <label>Line 2<input name="line2"></label><label>Postcode<input name="postcode" required></label>
        <label style="grid-column:span 2">Access notes<input name="instructions" placeholder="Concierge, door code…"></label>
        <button class="btn sm">Save address</button></form>
      <h3>Collection</h3><div data-collect></div>
      <h3>Return</h3>
      <label class="check-label"><input type="checkbox" data-later checked> Arrange the return later</label>
      <div data-return hidden></div>
      <label>Notes for the atelier<textarea data-notes rows="2"></textarea></label>
      <p class="error" hidden></p>
      <div class="row"><button class="btn primary" data-book disabled>Book</button><button class="btn ghost" data-close type="button">Close</button></div></section>`;
    const $ = (sel) => box.querySelector(sel), err = $(".error");
    const ready = () => { $("[data-book]").disabled = !st.collection || (!$("[data-later]").checked && !st.delivery) || $("[data-address]").value === "new"; };
    $("[data-close]").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; });
    $("[data-address]").addEventListener("change", (e) => { $("[data-new-address]").hidden = e.target.value !== "new"; ready(); });
    $("[data-new-address]").addEventListener("submit", act((e) => { e.preventDefault(); return api("POST", `/api/staff/clients/${id}/addresses`, Object.fromEntries(new FormData(e.target).entries())); }, "Address saved"));
    const drawReturn = async () => {
      st.delivery = null; ready();
      const r = $("[data-return]");
      r.hidden = $("[data-later]").checked;
      if (r.hidden) return;
      if (!st.collection) { r.innerHTML = `<p class="small muted">Choose the collection first.</p>`; return; }
      const e = await api("GET", "/api/staff/earliest-return?collection_end=" + encodeURIComponent(st.collection.ends_at));
      r.innerHTML = `<p class="small muted">${esc(e.text)}</p><div></div>`;
      slotChooser(r.lastElementChild, { after: e.earliest_return, onPick: (slot) => { st.delivery = slot; ready(); } });
    };
    $("[data-later]").addEventListener("change", drawReturn);
    slotChooser($("[data-collect]"), { onPick: (slot) => { st.collection = slot; ready(); if (!$("[data-later]").checked) drawReturn(); } });
    $("[data-book]").addEventListener("click", async () => {
      err.hidden = true; $("[data-book]").disabled = true;
      try {
        const o = await api("POST", `/api/staff/clients/${id}/bookings`, {
          collection: { template_id: st.collection.template_id, day: st.collection.day },
          delivery: st.delivery ? { template_id: st.delivery.template_id, day: st.delivery.day } : null,
          address_id: Number($("[data-address]").value), notes: $("[data-notes]").value, phone: $("[data-phone]")?.value || "" });
        toast(`Booked: ${o.ref}. Confirmation emailed.`);
        location.hash = "#/orders/" + o.id;
      } catch (e) { err.textContent = e.message; err.hidden = false; ready(); }
    });
  }

  /* Vault */

  async function viewVault(params) {
    const status = params.get("status") || "";
    const q = params.get("q") || "";
    const c = shell("vault", "Vault");
    c.innerHTML = `<form class="row" id="filters">
      <select name="status" aria-label="Status"><option value="">In storage</option><option value="retrieval_requested" ${status === "retrieval_requested" ? "selected" : ""}>Return requested</option><option value="retrieved" ${status === "retrieved" ? "selected" : ""}>Returned</option></select>
      <input name="q" value="${esc(q)}" placeholder="Tag, item, location or client" aria-label="Search"><button class="btn">Filter</button></form><div id="list"><p class="loading">Loading…</p></div>`;
    c.querySelector("#filters").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new URLSearchParams(new FormData(e.target));
      [...f.keys()].forEach((k) => { if (!f.get(k)) f.delete(k); });
      location.hash = "#/vault" + (f.toString() ? "?" + f : "");
    });
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    const rows = await api("GET", "/api/staff/vault?" + qs);
    c.querySelector("#list").innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Tag</th><th>Item</th><th>Client</th><th>Location</th><th>Season</th><th>Status</th><th>Return</th><th></th></tr></thead>
      <tbody>${rows.map((v) => `<tr><td class="tag">${esc(v.tag_code)}</td><td>${esc(v.description)}</td><td><a href="#/clients/${v.client.id}">${esc(v.client.name)}</a></td>
        <td><input data-loc="${v.id}" value="${esc(v.location)}" placeholder="R1-S1-B01" size="10" aria-label="Location"></td>
        <td><select data-season="${v.id}" aria-label="Season">${["", "Spring/Summer", "Autumn/Winter", "All year"].map((s) => `<option ${v.season === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td>${pill(v.status)}</td>
        <td class="small">${v.retrieval ? `${D.format(parse(v.retrieval.starts_at))} ${T.format(parse(v.retrieval.starts_at))}` : "–"}</td>
        <td>${v.status !== "retrieved" ? `<button class="btn sm" data-retrieved="${v.id}">Mark returned</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nothing here.</p>`;
    c.querySelectorAll("[data-loc]").forEach((i) => i.addEventListener("change", act(() => api("PATCH", `/api/staff/vault/${i.dataset.loc}`, { location: i.value.toUpperCase() }), "Location saved")));
    c.querySelectorAll("[data-season]").forEach((s) => s.addEventListener("change", act(() => api("PATCH", `/api/staff/vault/${s.dataset.season}`, { season: s.value }), "Saved")));
    c.querySelectorAll("[data-retrieved]").forEach((b) => b.addEventListener("click", act(() => api("POST", `/api/staff/vault/${b.dataset.retrieved}/retrieved`), "Marked returned")));
  }

  /* Apothecary shop */

  async function viewShop(params) {
    const tab = params.get("tab") || "orders";
    const c = shell("shop", "Apothecary");
    const ov = await api("GET", "/api/staff/shop");
    const isAdmin = me.role === "admin";
    c.innerHTML = `
      <div class="row between">
        <div class="row">${[["orders", `To pack${ov.to_pack ? " (" + ov.to_pack + ")" : ""}`], ["history", "All orders"], ["products", "Products & stock"], ["selling", "Selling"]]
          .map(([k, l]) => `<a class="btn ${k === tab ? "primary" : ""}" href="#/shop?tab=${k}">${l}</a>`).join("")}</div>
        <span class="pill ${ov.selling ? "ok" : "warn"}">${ov.selling ? "Selling" : "Waitlist only"}</span>
      </div><div id="pane"><p class="loading">Loading…</p></div>`;
    const pane = c.querySelector("#pane");

    if (tab === "orders" || tab === "history") {
      const rows = await api("GET", "/api/staff/shop/orders?status=" + (tab === "orders" ? "open" : "all"));
      pane.innerHTML = rows.length ? rows.map((o) => `
        <section class="panel">
          <div class="row between"><div class="row"><strong class="tag">${esc(o.ref)}</strong>${pill(o.status)}<span class="pill">${o.fulfilment === "collect" ? "Collect" : "Delivery"}</span></div>
            <span class="small muted">${o.paid_at ? "Paid " + DT.format(parse(o.paid_at)) : "Created " + DT.format(parse(o.created_at))}</span></div>
          ${o.stock_issue ? `<p class="error">Oversold: ${esc(o.stock_issue)}. Contact the client before packing.</p>` : ""}
          <div class="cols">
            <div class="table-wrap"><table><tbody>${o.lines.map((l) => `<tr><td>${l.qty} ×</td><td>${esc(l.name)}<br><span class="small muted">${esc(l.variant)}</span></td><td class="num">${money(l.unit_price_pence * l.qty)}</td></tr>`).join("")}</tbody>
              <tfoot><tr><td colspan="2">Delivery</td><td class="num">${money(o.shipping_pence)}</td></tr><tr><td colspan="2">Total</td><td class="num">${money(o.total_pence)}</td></tr></tfoot></table></div>
            <div class="stack">
              <dl class="kv"><dt>Client</dt><dd>${o.client ? `<a href="#/clients/${o.client.id}">${esc(o.client.name)}</a>` : "Guest"}</dd><dt>Email</dt><dd>${esc(o.email || "–")}</dd>
                ${o.fulfilment === "delivery" ? `<dt>Ship to</dt><dd>${esc([o.address.name, o.address.line1, o.address.line2, o.address.city, o.address.postal_code].filter(Boolean).join(", ") || "–")}</dd>` : ""}
                ${o.tracking ? `<dt>Tracking</dt><dd>${esc(o.tracking)}</dd>` : ""}</dl>
              ${o.status === "paid" ? (o.fulfilment === "delivery"
                ? `<form class="row" data-dispatch="${o.id}"><input name="tracking" placeholder="Tracking number (optional)"><button class="btn primary">Mark dispatched</button></form>`
                : `<button class="btn primary" data-collected="${o.id}">Mark collected</button>`) : ""}
            </div>
          </div>
        </section>`).join("") : `<p class="empty">${tab === "orders" ? "Nothing to pack." : "No Apothecary orders yet."}</p>`;
      pane.querySelectorAll("[data-dispatch]").forEach((f) => f.addEventListener("submit", act((e) => { e.preventDefault();
        return api("POST", `/api/staff/shop/orders/${f.dataset.dispatch}/status`, { status: "dispatched", tracking: f.tracking.value }); }, "Marked dispatched")));
      pane.querySelectorAll("[data-collected]").forEach((b) => b.addEventListener("click", act(() =>
        api("POST", `/api/staff/shop/orders/${b.dataset.collected}/status`, { status: "collected" }), "Marked collected")));
    }

    if (tab === "products") {
      const rows = await api("GET", "/api/staff/shop/products");
      const dis = isAdmin ? "" : "disabled";
      pane.innerHTML = rows.map((p) => `
        <section class="panel"><div class="row between"><h3>${esc(p.name)}</h3><span class="small muted">${esc(p.menu)} · <a href="/apothecary/products/${p.slug}/" target="_blank">View on site</a></span></div>
          <div class="table-wrap"><table><thead><tr><th>Option</th><th>SKU</th><th class="num">Price (£)</th><th class="num">Stock</th><th>On sale</th></tr></thead>
          <tbody>${p.variants.map((v) => `<tr><td>${esc(v.label)}</td><td class="tag small">${esc(v.sku)}</td>
            <td class="num"><input data-var="${v.id}" data-f="price" value="${(v.price_pence / 100).toFixed(2)}" size="6" style="text-align:right" ${dis} aria-label="Price"></td>
            <td class="num"><input data-var="${v.id}" data-f="stock" value="${v.stock}" size="4" style="text-align:right" ${dis} aria-label="Stock">${v.stock <= 3 ? ' <span class="pill warn">Low</span>' : ""}</td>
            <td><input type="checkbox" data-var="${v.id}" data-f="active" ${v.active ? "checked" : ""} ${dis} aria-label="On sale"></td></tr>`).join("")}</tbody></table></div>
        </section>`).join("");
      pane.querySelectorAll("[data-var]").forEach((i) => i.addEventListener("change", act(() => {
        const body = i.dataset.f === "price" ? { price_pence: toPence(i.value) } : i.dataset.f === "stock" ? { stock: Math.max(0, parseInt(i.value, 10) || 0) } : { active: i.checked };
        return api("PATCH", `/api/staff/shop/variants/${i.dataset.var}`, body);
      }, "Saved")));
    }

    if (tab === "selling") {
      const waiting = ov.waitlist.filter((w) => !w.notified).length;
      pane.innerHTML = `
        <section class="panel">
          <h2>${ov.selling ? "The Apothecary is selling" : "The Apothecary shows the waitlist"}</h2>
          <p>${ov.selling ? "Visitors can add products to their basket and pay by card." : "Visitors see products marked “Coming soon” and can join the waitlist."}</p>
          ${isAdmin ? `<div class="row" id="switch">${ov.selling
            ? `<button class="btn danger" data-on="0">Stop selling</button>`
            : `<button class="btn primary" data-on="1">Start selling</button><span class="small muted">${waiting} ${waiting === 1 ? "person" : "people"} on the waitlist will get an email that the Apothecary is open.</span>`}</div>` : `<p class="notice">Only admins can switch selling on or off.</p>`}
        </section>
        <section class="panel"><h2>Waitlist (${ov.waitlist.length})</h2>
          ${ov.waitlist.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Heard via</th><th>Joined</th><th>Told it's open</th></tr></thead>
          <tbody>${ov.waitlist.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(w.email)}</td><td>${esc(w.source || "–")}</td><td class="small">${D.format(parse(w.joined))}</td><td class="small">${w.notified ? D.format(parse(w.notified)) : "–"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nobody yet.</p>`}
        </section>`;
      pane.querySelector("[data-on]")?.addEventListener("click", (e) => {
        const on = e.target.dataset.on === "1";
        const box = pane.querySelector("#switch");
        box.innerHTML = `<span>${on ? `Start selling and email ${waiting} ${waiting === 1 ? "person" : "people"}?` : "Stop selling? The basket and checkout will close."}</span>
          <button class="btn ${on ? "primary" : "danger"}" data-confirm>${on ? "Yes, start selling" : "Yes, stop selling"}</button><button class="btn ghost" data-cancel>Cancel</button>`;
        box.querySelector("[data-cancel]").addEventListener("click", () => route());
        box.querySelector("[data-confirm]").addEventListener("click", async () => {
          try { const r = await api("POST", "/api/staff/shop/selling", { on }); toast(on ? `Selling. ${r.emails_sent} waitlist emails sent.` : "Selling stopped."); route(); }
          catch (ex) { toast(ex.message, true); }
        });
      });
    }
  }

  /* Journal, pages and messages */

  const KIND = { thread: "THREAD by LAVE", event: "Event", press: "Press" };

  async function viewJournal(params) {
    const tab = params.get("tab") || "posts";
    const c = shell("journal", "Journal", `<a class="btn primary" href="#/journal/new">New post</a>`);
    c.innerHTML = `<div class="row">${[["posts", "Posts"], ["pages", "LAVEWorld pages"], ["messages", "Messages"]]
      .map(([k, l]) => `<a class="btn ${k === tab ? "primary" : ""}" href="#/journal?tab=${k}">${l}</a>`).join("")}</div><div id="pane"><p class="loading">Loading…</p></div>`;
    const pane = c.querySelector("#pane");
    if (tab === "posts") {
      const rows = await api("GET", "/api/staff/posts");
      pane.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Date</th><th>Updated</th></tr></thead>
        <tbody>${rows.map((p) => `<tr class="click" data-href="#/journal/${p.id}"><td><strong>${esc(p.title)}</strong></td><td>${KIND[p.kind]}</td>
          <td>${p.status === "published" ? (parse(p.published_at) > new Date() ? '<span class="pill warn">Scheduled</span>' : '<span class="pill ok">Published</span>') : '<span class="pill">Draft</span>'}</td>
          <td class="small">${p.kind === "event" && p.event_starts_at ? "Event " + D.format(parse(p.event_starts_at)) : p.published_at ? D.format(parse(p.published_at)) : "–"}</td>
          <td class="small muted">${DT.format(parse(p.updated_at))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No posts yet. Press New post to write the first.</p>`;
      pane.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
    }
    if (tab === "pages") {
      const rows = await api("GET", "/api/staff/pages");
      pane.innerHTML = rows.map((pg) => `
        <form class="panel stack" data-page="${pg.id}">
          <div class="row between"><div class="row"><h3>${esc(pg.title)}</h3>${pg.published ? '<span class="pill ok">Live</span>' : '<span class="pill">Hidden</span>'}</div>
            <a class="small" href="${pg.path}" target="_blank">${esc(pg.path)}</a></div>
          <div class="form-grid"><label>Title<input name="title" value="${esc(pg.title)}" required></label>
            <label style="grid-column:span 2">Introduction<input name="intro" value="${esc(pg.intro)}"></label>
            <label>Image<input name="image" value="${esc(pg.image)}" placeholder="Upload or paste a link"></label></div>
          <label>Text (Markdown)<textarea name="body" rows="6">${esc(pg.body)}</textarea></label>
          <div class="row"><label class="check-label"><input type="checkbox" name="published" ${pg.published ? "checked" : ""}> Show on the site</label>
            <button class="btn primary">Save</button></div>
        </form>`).join("");
      pane.querySelectorAll("[data-page]").forEach((f) => f.addEventListener("submit", act((e) => { e.preventDefault();
        return api("PATCH", `/api/staff/pages/${f.dataset.page}`, { title: f.title.value, intro: f.intro.value, body: f.body.value,
          image: f.image.value, published: f.published.checked }); }, "Page saved")));
    }
    if (tab === "messages") {
      const rows = await api("GET", "/api/staff/messages");
      pane.innerHTML = rows.length ? rows.map((m) => `
        <section class="panel ${m.handled ? "muted" : ""}"><div class="row between"><div class="row"><strong>${esc(m.name)}</strong><a href="mailto:${esc(m.email)}">${esc(m.email)}</a><span class="pill">${esc(m.topic)}</span></div>
          <span class="small muted">${DT.format(parse(m.created_at))}</span></div>
          <p style="white-space:pre-wrap">${esc(m.message)}</p>
          <div><button class="btn sm ${m.handled ? "ghost" : ""}" data-handled="${m.id}">${m.handled ? "Mark as not handled" : "Mark handled"}</button></div></section>`).join("")
        : `<p class="empty">No messages yet.</p>`;
      pane.querySelectorAll("[data-handled]").forEach((b) => b.addEventListener("click", act(() => api("POST", `/api/staff/messages/${b.dataset.handled}/handled`))));
    }
  }

  async function viewPost(id) {
    const isNew = id === "new";
    const c = shell("journal", isNew ? "New post" : "Edit post");
    const p = isNew ? { kind: "thread", title: "", excerpt: "", body: "", cover_image: "", author: "LAVE", status: "draft", event_location: "",
      event_theme: "", members_only: false, outlet: "", external_url: "", event_starts_at: null } : await api("GET", "/api/staff/posts/" + id);
    const local = (iso) => (iso ? iso.slice(0, 16) : "");
    c.innerHTML = `
      <form id="post" class="cols-3">
        <div class="stack">
          <label>Title<input name="title" value="${esc(p.title)}" required maxlength="200"></label>
          <label>Summary (shown on cards and in search results)<textarea name="excerpt" rows="2" maxlength="600">${esc(p.excerpt)}</textarea></label>
          <div class="row between"><span class="small muted">Write in Markdown: ## for headings, **bold**, - for lists, [text](link).</span>
            <button type="button" class="btn sm ghost" id="toggle-preview">Preview</button></div>
          <textarea name="body" rows="22" id="body">${esc(p.body)}</textarea>
          <div id="preview" class="panel prose-preview" hidden></div>
        </div>
        <div class="stack">
          <section class="panel">
            <div class="row between"><h2>Publishing</h2>${p.status === "published" ? '<span class="pill ok">Published</span>' : '<span class="pill">Draft</span>'}</div>
            <label>Type<select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${p.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label>Author<input name="author" value="${esc(p.author)}"></label>
            ${!isNew ? `<label>Web address<input name="slug" value="${esc(p.slug)}"></label>` : ""}
            ${p.status !== "published" ? `<label>Publish on (leave blank for now)<input type="datetime-local" name="publish_at"></label>` : ""}
            <div class="row">
              <button class="btn" type="submit">Save draft</button>
              ${p.status === "published" ? `<button class="btn ghost" type="button" data-pub="0">Unpublish</button>` : `<button class="btn primary" type="button" data-pub="1">Publish</button>`}
            </div>
            ${!isNew ? `<a class="small" href="/journal/${p.slug}/" target="_blank">${p.status === "published" ? "View on site" : "Preview on site"}</a>` : ""}
          </section>
          <section class="panel">
            <h2>Cover image</h2>
            ${p.cover_url ? `<img src="${esc(p.cover_url)}" alt="" style="width:100%;aspect-ratio:16/10;object-fit:cover">` : ""}
            <input name="cover_image" value="${esc(p.cover_image)}" placeholder="Paste a link, or upload">
            <input type="file" id="upload" accept="image/jpeg,image/png,image/webp,image/avif">
          </section>
          <section class="panel" id="event-fields" ${p.kind === "event" ? "" : "hidden"}>
            <h2>Event</h2>
            <label>Starts<input type="datetime-local" name="event_starts_at" value="${local(p.event_starts_at)}"></label>
            <label>Location<input name="event_location" value="${esc(p.event_location)}"></label>
            <label>Theme<select name="event_theme">${["", "lifestyle", "sport"].map((t) => `<option value="${t}" ${p.event_theme === t ? "selected" : ""}>${t ? t[0].toUpperCase() + t.slice(1) : "None"}</option>`).join("")}</select></label>
            <label class="check-label"><input type="checkbox" name="members_only" ${p.members_only ? "checked" : ""}> Members only</label>
          </section>
          <section class="panel" id="press-fields" ${p.kind === "press" ? "" : "hidden"}>
            <h2>Press</h2>
            <label>Publication<input name="outlet" value="${esc(p.outlet)}"></label>
            <label>Link to the article<input name="external_url" value="${esc(p.external_url)}" placeholder="https://"></label>
          </section>
          ${!isNew && me.role === "admin" ? `<div id="del"><button class="btn danger sm" type="button" data-delete>Delete post</button></div>` : ""}
        </div>
      </form>`;
    const f = c.querySelector("#post");
    const payload = () => ({
      title: f.title.value, kind: f.kind.value, excerpt: f.excerpt.value, body: f.body.value, cover_image: f.cover_image.value,
      author: f.author.value || "LAVE", slug: f.slug?.value || null, event_starts_at: f.event_starts_at.value || null,
      event_location: f.event_location.value, event_theme: f.event_theme.value, members_only: f.members_only.checked,
      outlet: f.outlet.value, external_url: f.external_url.value,
    });
    const save = async () => {
      const saved = isNew ? await api("POST", "/api/staff/posts", payload()) : await api("PATCH", "/api/staff/posts/" + id, payload());
      return saved;
    };
    f.kind.addEventListener("change", () => {
      c.querySelector("#event-fields").hidden = f.kind.value !== "event";
      c.querySelector("#press-fields").hidden = f.kind.value !== "press";
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const s2 = await save(); toast("Saved"); if (isNew) location.hash = "#/journal/" + s2.id; else route(); }
      catch (ex) { toast(ex.message, true); }
    });
    c.querySelector("[data-pub]")?.addEventListener("click", async (e) => {
      try {
        const s2 = await save();
        await api("POST", `/api/staff/posts/${s2.id}/publish`, { publish: e.target.dataset.pub === "1", published_at: f.publish_at?.value || null });
        toast(e.target.dataset.pub === "1" ? "Published" : "Moved back to drafts");
        location.hash = "#/journal/" + s2.id; route();
      } catch (ex) { toast(ex.message, true); }
    });
    c.querySelector("#upload").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/staff/uploads", { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(data.detail || "Upload failed.", true);
      f.cover_image.value = data.url; toast("Image uploaded. Save to keep it.");
    });
    const preview = c.querySelector("#preview");
    c.querySelector("#toggle-preview").addEventListener("click", async (e) => {
      const show = preview.hidden;
      if (show) preview.innerHTML = (await api("POST", "/api/staff/markdown", { text: f.body.value })).html || "<p class='muted'>Nothing written yet.</p>";
      preview.hidden = !show; c.querySelector("#body").hidden = show;
      e.target.textContent = show ? "Edit" : "Preview";
    });
    c.querySelector("[data-delete]")?.addEventListener("click", () => {
      const box = c.querySelector("#del");
      box.innerHTML = `<span class="small">Delete this post permanently?</span> <button class="btn danger sm" type="button" data-yes>Delete</button> <button class="btn ghost sm" type="button" data-no>Keep</button>`;
      box.querySelector("[data-no]").addEventListener("click", () => route());
      box.querySelector("[data-yes]").addEventListener("click", async () => { await api("DELETE", "/api/staff/posts/" + id); toast("Deleted"); location.hash = "#/journal"; });
    });
  }

  /* Website: content editor, image library, services and products */

  const VIEW_ON_SITE = { "page.resell": "/atelier/rehome/resell/", "home": "/", "page.atelier": "/atelier/", "page.apothecary": "/apothecary/", "page.membership": "/memberships/",
    "page.laveworld": "/laveworld/", "menus": "/atelier/", "plans": "/memberships/", "footer": "/" };
  const fieldName = (k) => k.replace(/_pence$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const isImageKey = (k) => /(^|_)(image|hero)$/.test(k);
  const isLongText = (k, v) => /(^|_)(text|lead|summary|tagline)$/.test(k) || (typeof v === "string" && v.length > 90);
  const itemName = (v, i) => (v && typeof v === "object" && (v.title || v.label || v.name || v.heading || v.group || v.text)) || `Item ${i + 1}`;
  const getAt = (obj, path) => path.reduce((o, k) => o[k], obj);
  const blankLike = (v) => Array.isArray(v) ? [] : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)]))
    : typeof v === "number" ? 0 : typeof v === "boolean" ? false : "";

  async function pickImage() {
    // Image library picker: resolves to a URL, or null if closed.
    return new Promise(async (resolve) => {
      const lib = await api("GET", "/api/staff/media");
      const box = document.createElement("div");
      box.className = "modal";
      box.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="Choose an image">
        <div class="row between"><h2>Choose an image</h2><button class="btn ghost sm" data-close>Close</button></div>
        <div class="row"><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-upload><span class="small muted">Or upload a new one.</span></div>
        <div class="media-grid">${lib.items.map((m) => `<button class="media-tile" data-url="${esc(m.url)}" title="${esc(m.filename)}"><img src="${esc(m.url)}" alt="${esc(m.alt)}" loading="lazy"></button>`).join("") || '<p class="muted">The library is empty. Upload an image, or copy the website\'s images from Website → Images.</p>'}</div>
      </div>`;
      document.body.appendChild(box);
      const done = (v) => { box.remove(); resolve(v); };
      box.querySelector("[data-close]").addEventListener("click", () => done(null));
      box.addEventListener("click", (e) => { if (e.target === box) done(null); });
      box.querySelectorAll("[data-url]").forEach((b) => b.addEventListener("click", () => done(b.dataset.url)));
      box.querySelector("[data-upload]").addEventListener("change", async (e) => {
        const fd = new FormData(); fd.append("file", e.target.files[0]);
        const res = await fetch("/api/staff/uploads", { method: "POST", body: fd, credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return toast(data.detail || "Upload failed.", true);
        done(data.url);
      });
    });
  }

  async function viewWebsite(params) {
    const tab = params.get("tab") || "pages";
    const c = shell("website", "Website");
    c.innerHTML = `<div class="row">${[["pages", "Pages & menus"], ["products", "Apothecary products"], ["resell", "Resell"], ["images", "Images"]]
      .map(([k, l]) => `<a class="btn ${k === tab ? "primary" : ""}" href="#/website?tab=${k}">${l}</a>`).join("")}</div>
      ${me.role !== "admin" ? '<p class="notice">You can look around; only admins can save changes to the website.</p>' : ""}
      <div id="pane"><p class="loading">Loading…</p></div>`;
    const pane = c.querySelector("#pane");

    if (tab === "pages") {
      const docs = await api("GET", "/api/staff/content");
      pane.innerHTML = `<div class="table-wrap"><table><thead><tr><th>What</th><th>About</th><th>Status</th></tr></thead><tbody>
        ${docs.map((d) => `<tr class="click" data-href="#/website/content/${d.key}"><td><strong>${esc(d.title)}</strong></td><td class="small">${esc(d.help)}</td>
          <td class="small">${d.customised ? `Edited ${DT.format(parse(d.updated_at))}${d.updated_by ? " by " + esc(d.updated_by) : ""}` : '<span class="muted">Original</span>'}</td></tr>`).join("")}
        </tbody></table></div>`;
      pane.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
    }

    if (tab === "images") {
      const lib = await api("GET", "/api/staff/media");
      const st = lib.import;
      pane.innerHTML = `
        <section class="panel">
          <div class="row between"><h2>Image library (${lib.items.length})</h2><label class="btn sm">Upload image<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden data-upload></label></div>
          ${lib.still_on_wordpress || st.running ? `<div class="notice">
            ${st.running ? `Copying images from lavelondon.com: ${st.done} of ${st.total}…` :
              `<strong>${lib.still_on_wordpress} images</strong> on the site still load from lavelondon.com. Copy them into the library so nothing breaks when WordPress is switched off.
               ${me.role === "admin" ? `<div style="margin-top:10px"><button class="btn primary sm" data-import>Copy images now</button></div>` : ""}`}
          </div>` : `<p class="small ok">Every image on the site is in the library.</p>`}
          ${st.failed?.length ? `<details><summary class="small">${st.failed.length} images couldn't be copied</summary><ul class="small">${st.failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></details>` : ""}
          <div class="media-grid">${lib.items.map((m) => `<figure class="media-card">
            <img src="${esc(m.url)}" alt="${esc(m.alt)}" loading="lazy">
            <figcaption><span class="small" title="${esc(m.filename)}">${esc(m.filename || m.url)}</span>
              <input data-alt="${m.id}" value="${esc(m.alt)}" placeholder="Describe the image (for screen readers)">
              <button class="link small" data-copy="${esc(m.url)}">Copy address</button></figcaption></figure>`).join("") || '<p class="empty">No images yet.</p>'}</div>
        </section>`;
      pane.querySelector("[data-upload]")?.addEventListener("change", async (e) => {
        const fd = new FormData(); fd.append("file", e.target.files[0]);
        const res = await fetch("/api/staff/uploads", { method: "POST", body: fd, credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return toast(data.detail || "Upload failed.", true);
        toast("Uploaded"); route();
      });
      pane.querySelector("[data-import]")?.addEventListener("click", act(() => api("POST", "/api/staff/media/import-wordpress"), "Copying started"));
      pane.querySelectorAll("[data-alt]").forEach((i) => i.addEventListener("change", act(() => api("PATCH", `/api/staff/media/${i.dataset.alt}`, { alt: i.value }), "Saved")));
      pane.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(location.origin + b.dataset.copy); toast("Address copied"); } catch (_) { toast(b.dataset.copy); }
      }));
      if (st.running) setTimeout(() => { if (location.hash.startsWith("#/website?tab=images")) route(); }, 2000);
    }

    if (tab === "services") {
      const rows = await api("GET", "/api/staff/services");
      pane.innerHTML = `<div class="row between"><p class="muted small">Services marked "On website" appear on the Atelier pages. Staff use the whole list when itemising orders.</p>
        ${me.role === "admin" ? `<a class="btn primary" href="#/website/services/new">New service</a>` : ""}</div>
        <div class="table-wrap"><table><thead><tr><th></th><th>Service</th><th>Shown under</th><th class="num">Price</th><th>Website</th><th>Check</th></tr></thead><tbody>
        ${rows.map((x) => `<tr class="click" data-href="#/website/services/${x.id}"><td style="width:56px">${x.image ? `<img class="thumb" src="${esc(x.image.startsWith("http") || x.image.startsWith("/") ? x.image : "https://lavelondon.com/wp-content/uploads/" + x.image)}" alt="">` : ""}</td>
          <td><strong>${esc(x.name.split(" – ")[0])}</strong>${x.active ? "" : ' <span class="pill">Archived</span>'}</td><td class="small">${esc(x.collections.join(", ") || "–")}</td>
          <td class="num">${money(x.price_pence)}</td><td>${x.show_online ? '<span class="pill ok">On website</span>' : '<span class="pill">Price list only</span>'}</td>
          <td class="small">${x.review_note ? `<span class="pill warn">To check</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
      pane.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
    }

    if (tab === "products") {
      const rows = await api("GET", "/api/staff/shop/products");
      pane.innerHTML = `<div class="row between"><p class="muted small">Prices and stock for each size and scent are also under Shop → Products & stock.</p>
        ${me.role === "admin" ? `<a class="btn primary" href="#/website/products/new">New product</a>` : ""}</div>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Menu</th><th class="num">Options</th><th>Status</th></tr></thead><tbody>
        ${rows.map((p) => `<tr class="click" data-href="#/website/products/${p.id}"><td><strong>${esc(p.name)}</strong></td><td class="small">${esc(p.menu)}</td>
          <td class="num">${p.variants.length}</td><td>${p.active ? '<span class="pill ok">Shown</span>' : '<span class="pill">Hidden</span>'}</td></tr>`).join("")}</tbody></table></div>`;
      pane.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
    }

    if (tab === "resell") {
      const r = await api("GET", "/api/staff/resell");
      const cat = Object.fromEntries(r.categories), cond = Object.fromEntries(r.conditions);
      const state = { available: "ok", reserved: "warn", sold: "" };
      pane.innerHTML = `<div class="row between"><p class="muted small">Pieces on the <a href="/atelier/rehome/resell/" target="_blank">Resell page</a>. The banner, category photos and service strip are under <a href="#/website/content/page.resell">Pages &amp; menus → Resell page</a>.</p>
        ${me.role === "admin" ? `<a class="btn primary" href="#/website/resell/new">New piece</a>` : ""}</div>
        ${r.pieces.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Piece</th><th>Category</th><th>Condition</th><th class="num">Price</th><th>Status</th><th>Online</th></tr></thead><tbody>
        ${r.pieces.map((p) => `<tr class="click" data-href="#/website/resell/${p.id}">
          <td>${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" style="width:44px;height:56px;object-fit:cover;background:#f2f2f2">` : ""}</td>
          <td><strong>${esc(p.title)}</strong><br><span class="small muted">${esc([p.designer, p.detail].filter(Boolean).join(" · "))}</span></td>
          <td class="small">${esc(cat[p.category] || p.category)}</td><td class="small">${esc(cond[p.condition] || p.condition)}</td>
          <td class="num">${money(p.price_pence)}</td><td><span class="pill ${state[p.status]}">${esc(p.status)}</span></td>
          <td>${p.show_online ? "Shown" : '<span class="muted">Hidden</span>'}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="empty">No pieces yet. Add the first, with its photos, and it appears on the Resell page.</p>`}`;
      pane.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
    }
  }

  /* One Resell piece: details, photos (first one leads; the second shows on hover), price and status. */
  async function viewResellEdit(id) {
    const isNew = id === "new";
    const c = shell("website", isNew ? "New piece" : "Edit piece");
    const r = await api("GET", "/api/staff/resell");
    const p = isNew ? { title: "", designer: "", detail: "", category: "bags", condition: "nearly_new", price_pence: 0, images: [],
      description: "", condition_notes: "", status: "available", show_online: true, sort: 0 } : r.pieces.find((x) => String(x.id) === String(id));
    if (!p) { c.innerHTML = `<p class="error">Piece not found.</p>`; return; }
    const isAdmin = me.role === "admin", dis = isAdmin ? "" : "disabled";
    const opts = (list, v) => list.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("");
    const draw = () => {
      c.innerHTML = `<form id="piece" class="cols-3">
          <div class="stack panel">
            <label>Name<input name="title" value="${esc(p.title)}" required placeholder="Quilted Shoulder Bag" ${dis}></label>
            <div class="form-grid"><label>Designer<input name="designer" value="${esc(p.designer)}" placeholder="Leave blank if unknown" ${dis}></label>
              <label>Material and colour<input name="detail" value="${esc(p.detail)}" placeholder="Black lambskin, gold hardware" ${dis}></label></div>
            <div class="form-grid">
              <label>Category<select name="category" ${dis}>${opts(r.categories, p.category)}</select></label>
              <label>Condition<select name="condition" ${dis}>${opts(r.conditions, p.condition)}</select></label>
              <label>Price (£)<input name="price" value="${(p.price_pence / 100).toFixed(2)}" ${dis}></label>
              <label>Status<select name="status" ${dis}>${opts(r.statuses.map((s) => [s, s[0].toUpperCase() + s.slice(1)]), p.status)}</select></label>
              <label>Order (lower first)<input name="sort" type="number" value="${p.sort}" ${dis}></label>
            </div>
            <label>About this piece<textarea name="description" rows="5" placeholder="Its story, size, what comes with it" ${dis}>${esc(p.description)}</textarea></label>
            <label>Condition notes<textarea name="condition_notes" rows="3" placeholder="Light wear to the corners; cleaned and conditioned by LAVE" ${dis}>${esc(p.condition_notes)}</textarea></label>
            <label class="check-label"><input type="checkbox" name="show_online" ${p.show_online ? "checked" : ""} ${dis}> Show on the Resell page</label>
          </div>
          <div class="stack panel"><h2>Photos</h2>
            <p class="small muted">The first photo leads; the second appears when someone hovers. Portrait photos on a plain light background suit the page best.</p>
            <div class="stack">${p.images.map((u, i) => `<div class="row" style="align-items:center;gap:10px">
              <img src="${esc(u)}" alt="" style="width:64px;height:80px;object-fit:cover;background:#f2f2f2">
              ${isAdmin ? `<button type="button" class="btn sm ghost" data-up="${i}" ${i ? "" : "disabled"} aria-label="Move up">↑</button>
              <button type="button" class="btn sm ghost" data-del="${i}">Remove</button>` : ""}</div>`).join("") || '<p class="small muted">No photos yet.</p>'}</div>
            ${isAdmin ? `<button type="button" class="btn sm" data-add>Add a photo</button>` : ""}
            ${!isNew ? `<a class="small" href="${esc(p.url)}" target="_blank">View on site</a>` : ""}
          </div>
        </form>
        ${isAdmin ? `<div class="row"><button class="btn primary" data-save>${isNew ? "Add piece" : "Save piece"}</button><a class="btn ghost" href="#/website?tab=resell">Back</a>
          ${!isNew ? `<span id="del-box"><button class="btn danger" data-delete>Delete</button></span>` : ""}</div>` : ""}`;
      const f = c.querySelector("#piece");
      const read = () => { Object.assign(p, { title: f.title.value, designer: f.designer.value, detail: f.detail.value, category: f.category.value,
        condition: f.condition.value, price_pence: toPence(f.price.value) || 0, status: f.status.value, sort: Number(f.sort.value) || 0,
        description: f.description.value, condition_notes: f.condition_notes.value, show_online: f.show_online.checked }); };
      c.querySelector("[data-add]")?.addEventListener("click", async () => { read(); const u = await pickImage(); if (u) { p.images.push(u); draw(); } });
      c.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { read(); p.images.splice(Number(b.dataset.del), 1); draw(); }));
      c.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => {
        read(); const i = Number(b.dataset.up); [p.images[i - 1], p.images[i]] = [p.images[i], p.images[i - 1]]; draw(); }));
      c.querySelector("[data-save]")?.addEventListener("click", async () => {
        read();
        const body = { ...p }; delete body.id; delete body.slug; delete body.url;
        try {
          if (isNew) { const made = await api("POST", "/api/staff/resell", body); toast("Piece added"); location.hash = "#/website/resell/" + made.id; }
          else { Object.assign(p, await api("PATCH", `/api/staff/resell/${id}`, body)); toast("Saved"); draw(); }
        } catch (ex) { toast(ex.message, true); }
      });
      c.querySelector("[data-delete]")?.addEventListener("click", () => {
        const box = c.querySelector("#del-box");
        box.innerHTML = `<span class="small">Delete this piece for good?</span> <button class="btn danger sm" data-yes>Delete</button> <button class="btn ghost sm" data-no>Keep</button>`;
        box.querySelector("[data-no]").addEventListener("click", draw);
        box.querySelector("[data-yes]").addEventListener("click", async () => {
          try { await api("DELETE", `/api/staff/resell/${id}`); toast("Piece deleted"); location.hash = "#/website?tab=resell"; } catch (ex) { toast(ex.message, true); }
        });
      });
    };
    draw();
  }

  async function viewContent(key) {
    const c = shell("website", "Website");
    const d = await api("GET", "/api/staff/content/" + key);
    document.querySelector(".top h1").textContent = d.title;
    const doc = JSON.parse(JSON.stringify(d.value));
    const locked = new Set(d.locked), readonly = new Set(d.readonly);
    const canSave = me.role === "admin";

    const field = (value, path, key, parent = "") => {
      const p = esc(JSON.stringify(path));
      if (Array.isArray(value)) {
        const lockedList = locked.has(key);
        const simple = value.every((v) => typeof v !== "object");
        return `<fieldset class="ed-list"><legend>${esc(fieldName(key))}</legend>
          ${value.map((v, i) => `<div class="ed-item">${simple
            ? `<div class="ed-row">${field(v, [...path, i], key + "_item")}</div>`
            : `<details ${value.length <= 3 ? "open" : ""}><summary>${esc(String(itemName(v, i)).slice(0, 60))}</summary>${field(v, [...path, i], key)}</details>`}
            ${lockedList ? "" : `<div class="ed-tools"><button type="button" class="link small" data-move="-1" data-path="${p}" data-i="${i}" ${i === 0 ? "disabled" : ""}>Up</button>
              <button type="button" class="link small" data-move="1" data-path="${p}" data-i="${i}" ${i === value.length - 1 ? "disabled" : ""}>Down</button>
              <button type="button" class="link small danger-text" data-remove data-path="${p}" data-i="${i}">Remove</button></div>`}</div>`).join("")}
          ${lockedList ? "" : `<button type="button" class="btn sm ghost" data-add data-path="${p}">Add ${esc(fieldName(key).replace(/s$/, "").toLowerCase())}</button>`}
        </fieldset>`;
      }
      if (value && typeof value === "object") {
        return `<div class="ed-group">${Object.entries(value).map(([k, v]) => field(v, [...path, k], k, key)).join("")}</div>`;
      }
      const ro = readonly.has(key) || readonly.has(parent + "." + key) ? "disabled" : "";
      const label = key.endsWith("_item") ? "" : `<span>${esc(fieldName(key))}${key.endsWith("_pence") ? " (£)" : ""}</span>`;
      if (typeof value === "boolean") return `<label class="check-label"><input type="checkbox" data-field="${p}" ${value ? "checked" : ""} ${ro}> ${esc(fieldName(key))}</label>`;
      if (key.endsWith("_pence")) return `<label>${label}<input data-field="${p}" data-money value="${(value / 100).toFixed(2)}" ${ro}></label>`;
      if (typeof value === "number") return `<label>${label}<input type="number" data-field="${p}" data-number value="${value}" ${ro}></label>`;
      if (isImageKey(key)) return `<div class="ed-image"><label>${label}<input data-field="${p}" value="${esc(value)}" ${ro}></label>
        ${value ? `<img src="${esc(value)}" alt="">` : ""}<button type="button" class="btn sm" data-pick="${p}">Choose image</button></div>`;
      if (isLongText(key, value)) return `<label>${label}<textarea data-field="${p}" rows="${Math.min(6, Math.max(2, Math.ceil(value.length / 90)))}" ${ro}>${esc(value)}</textarea></label>`;
      return `<label>${label}<input data-field="${p}" value="${esc(value)}" ${ro}></label>`;
    };

    const draw = () => {
      c.innerHTML = `
        <div class="row between"><p class="muted">${esc(d.help)}</p>
          <div class="row"><a class="btn ghost" href="${VIEW_ON_SITE[key] || "/"}" target="_blank">View on site</a>
          ${canSave ? `${d.customised ? `<span id="reset-box"><button class="btn ghost" data-reset>Reset to original</button></span>` : ""}<button class="btn primary" data-save>Save changes</button>` : ""}</div></div>
        <form class="editor stack" id="editor">${field(doc, [], key)}</form>
        ${canSave ? `<div class="row"><button class="btn primary" data-save>Save changes</button><span class="small muted">Changes go live as soon as you save.</span></div>` : ""}`;
      const form = c.querySelector("#editor");
      form.addEventListener("input", (e) => {
        const el = e.target.closest("[data-field]");
        if (!el) return;
        const path = JSON.parse(el.dataset.field), last = path.pop(), parent = getAt(doc, path);
        parent[last] = el.type === "checkbox" ? el.checked : el.dataset.money !== undefined ? Math.round(parseFloat(el.value || "0") * 100) || 0
          : el.dataset.number !== undefined ? parseInt(el.value || "0", 10) || 0 : el.value;
      });
      form.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
        const list = getAt(doc, JSON.parse(b.dataset.path));
        list.push(list.length ? blankLike(list[list.length - 1]) : "");
        draw();
      }));
      form.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
        getAt(doc, JSON.parse(b.dataset.path)).splice(Number(b.dataset.i), 1); draw();
      }));
      form.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
        const list = getAt(doc, JSON.parse(b.dataset.path)), i = Number(b.dataset.i), j = i + Number(b.dataset.move);
        [list[i], list[j]] = [list[j], list[i]]; draw();
      }));
      form.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async () => {
        const url = await pickImage();
        if (!url) return;
        const path = JSON.parse(b.dataset.pick), last = path.pop();
        getAt(doc, path)[last] = url; draw();
      }));
      c.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
        try { await api("PUT", "/api/staff/content/" + key, { value: doc }); d.customised = true; toast("Saved. The website is updated."); draw(); }
        catch (ex) { toast(ex.message, true); }
      }));
      c.querySelector("[data-reset]")?.addEventListener("click", () => {
        const box = c.querySelector("#reset-box");
        box.innerHTML = `<span class="small">Undo every edit to this page?</span> <button class="btn danger sm" data-yes>Reset</button> <button class="btn ghost sm" data-no>Keep</button>`;
        box.querySelector("[data-no]").addEventListener("click", draw);
        box.querySelector("[data-yes]").addEventListener("click", async () => {
          const r = await api("POST", `/api/staff/content/${key}/reset`);
          Object.keys(doc).forEach((k) => delete doc[k]); Object.assign(doc, r.value); d.customised = false; toast("Back to the original"); draw();
        });
      });
    };
    draw();
  }

  const COLLECTION_NAMES = ["women", "men", "children", "pets"];

  async function viewServiceEdit(id) {
    const isNew = id === "new";
    const c = shell("website", isNew ? "New service" : "Edit service");
    const x = isNew ? { name: "", price_pence: 0, summary: "", image: "", collections: [], show_online: true, active: true, review_note: "", category: "clean", unit: "item", code: "" }
      : (await api("GET", "/api/staff/services")).find((s) => String(s.id) === String(id));
    if (!x) { c.innerHTML = `<p class="error">Service not found.</p>`; return; }
    const imgUrl = (v) => !v ? "" : v.startsWith("http") || v.startsWith("/") ? v : "https://lavelondon.com/wp-content/uploads/" + v;
    c.innerHTML = `
      ${x.review_note ? `<div class="notice"><strong>To check:</strong> ${esc(x.review_note)} <button class="link small" data-clear-note>Mark as checked</button></div>` : ""}
      <form id="svc" class="cols-3">
        <div class="stack panel">
          <label>Name<input name="name" value="${esc(x.name)}" required></label>
          <div class="form-grid"><label>Price (£)<input name="price" value="${(x.price_pence / 100).toFixed(2)}" required></label>
            ${isNew ? `<label>Code<input name="code" placeholder="e.g. DC_SCARF" required></label>` : ""}
            <label>Category<select name="category">${["clean", "press", "refresh", "preserve", "vault", "repair"].map((k) => `<option ${x.category === k ? "selected" : ""}>${k}</option>`).join("")}</select></label></div>
          <label>Description<textarea name="summary" rows="5">${esc(x.summary)}</textarea></label>
          <fieldset class="ed-list"><legend>Show under</legend><div class="row">${COLLECTION_NAMES.map((k) => `<label class="check-label"><input type="checkbox" name="col" value="${k}" ${x.collections.includes(k) ? "checked" : ""}> ${k[0].toUpperCase() + k.slice(1)}</label>`).join("")}</div></fieldset>
          <div class="row"><label class="check-label"><input type="checkbox" name="show_online" ${x.show_online ? "checked" : ""}> Show on the website</label>
            <label class="check-label"><input type="checkbox" name="active" ${x.active ? "checked" : ""}> Available (untick to archive)</label></div>
        </div>
        <div class="stack panel"><h2>Photo</h2>${x.image ? `<img src="${esc(imgUrl(x.image))}" alt="" style="width:100%;aspect-ratio:4/5;object-fit:contain;background:var(--panel)">` : '<p class="muted small">No photo yet.</p>'}
          <input name="image" value="${esc(x.image)}"><button type="button" class="btn sm" data-pick>Choose image</button>
          ${x.slug && x.show_online ? `<a class="small" href="/atelier/services/${esc(x.slug)}/" target="_blank">View on site</a>` : ""}</div>
      </form>
      ${me.role === "admin" ? `<div class="row"><button class="btn primary" data-save>${isNew ? "Create service" : "Save changes"}</button><a class="btn ghost" href="#/website?tab=services">Back</a></div>` : ""}`;
    const f = c.querySelector("#svc");
    c.querySelector("[data-pick]").addEventListener("click", async () => { const u = await pickImage(); if (u) { f.image.value = u; toast("Image chosen. Save to keep it."); } });
    c.querySelector("[data-clear-note]")?.addEventListener("click", act(() => api("PATCH", `/api/staff/services/${id}`, { review_note: "" }), "Marked as checked"));
    c.querySelector("[data-save]")?.addEventListener("click", async () => {
      const body = { name: f.name.value, price_pence: toPence(f.price.value), category: f.category.value, summary: f.summary.value, image: f.image.value,
        collections: [...f.querySelectorAll("input[name=col]:checked")].map((i) => i.value), show_online: f.show_online.checked, active: f.active.checked };
      try {
        if (isNew) { const s2 = await api("POST", "/api/staff/services", { ...body, code: f.code.value.toUpperCase(), unit: "item" }); location.hash = "#/website/services/" + s2.id; }
        else { await api("PATCH", `/api/staff/services/${id}`, body); toast("Saved"); route(); }
      } catch (ex) { toast(ex.message, true); }
    });
  }

  async function viewProductEdit(id) {
    const isNew = id === "new";
    const c = shell("website", isNew ? "New product" : "Edit product");
    const products = await api("GET", "/api/staff/shop/products");
    const p = isNew ? { name: "", summary: "", image: "", menu: "wash / ", active: true, variants: [] } : products.find((x) => String(x.id) === String(id));
    if (!p) { c.innerHTML = `<p class="error">Product not found.</p>`; return; }
    const [menuSub, menuItem] = p.menu.split(" / ");
    const content = await api("GET", "/api/staff/content/menus");
    const apo = content.value.sections.find((s) => s.key === "apothecary");
    const itemsFor = (sub) => (apo.subnav.find((n) => n.title.toLowerCase() === sub)?.columns || []).flatMap((col) => col.links.map((l) => l.label));
    const slugify = (t) => t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    c.innerHTML = `
      <form id="prod" class="cols-3">
        <div class="stack panel">
          <label>Name<input name="name" value="${esc(p.name)}" required></label>
          <label>Description<textarea name="summary" rows="4">${esc(p.summary || "")}</textarea></label>
          <div class="form-grid">
            <label>Menu<select name="menu_sub">${apo.subnav.map((n) => `<option value="${slugify(n.title)}" ${slugify(n.title) === menuSub ? "selected" : ""}>${esc(n.title)}</option>`).join("")}</select></label>
            <label>Under<select name="menu_item"></select></label>
          </div>
          <label class="check-label"><input type="checkbox" name="active" ${p.active ? "checked" : ""}> Show in the Apothecary</label>
        </div>
        <div class="stack panel"><h2>Photo</h2><input name="image" value="${esc(p.image || "")}"><button type="button" class="btn sm" data-pick>Choose image</button>
          ${!isNew ? `<a class="small" href="/apothecary/products/${esc(p.slug)}/" target="_blank">View on site</a>` : ""}</div>
      </form>
      ${me.role === "admin" ? `<div class="row"><button class="btn primary" data-save>${isNew ? "Create product" : "Save product"}</button><a class="btn ghost" href="#/website?tab=products">Back</a></div>` : ""}
      ${!isNew ? `<section class="panel"><h2>Sizes and scents</h2>
        <div class="table-wrap"><table><thead><tr><th>Option</th><th class="num">Price (£)</th><th class="num">Stock</th><th>On sale</th></tr></thead><tbody>
        ${p.variants.map((v) => `<tr><td>${esc(v.label)}</td><td class="num"><input data-var="${v.id}" data-f="price" value="${(v.price_pence / 100).toFixed(2)}" size="6" style="text-align:right"></td>
          <td class="num"><input data-var="${v.id}" data-f="stock" value="${v.stock}" size="4" style="text-align:right"></td><td><input type="checkbox" data-var="${v.id}" data-f="active" ${v.active ? "checked" : ""}></td></tr>`).join("") || '<tr><td colspan="4" class="muted">No options yet. Add the first below.</td></tr>'}</tbody></table></div>
        <form id="add-var" class="form-grid"><label>Size<input name="size" required placeholder="e.g. 1 L"></label><label>Scent<input name="scent" placeholder="Leave blank if none"></label>
          <label>Price (£)<input name="price" required></label><label>Stock<input name="stock" value="0"></label><button class="btn primary">Add option</button></form></section>` : ""}`;
    const f = c.querySelector("#prod");
    const fillItems = () => { f.menu_item.innerHTML = `<option value="">(none)</option>` + itemsFor(f.menu_sub.value).map((l) => `<option value="${slugify(l)}" ${slugify(l) === menuItem ? "selected" : ""}>${esc(l)}</option>`).join(""); };
    fillItems(); f.menu_sub.addEventListener("change", fillItems);
    c.querySelector("[data-pick]").addEventListener("click", async () => { const u = await pickImage(); if (u) { f.image.value = u; toast("Image chosen. Save to keep it."); } });
    c.querySelector("[data-save]")?.addEventListener("click", async () => {
      const body = { name: f.name.value, summary: f.summary.value, image: f.image.value, menu_sub: f.menu_sub.value, menu_item: f.menu_item.value, active: f.active.checked };
      try {
        if (isNew) { const r = await api("POST", "/api/staff/shop/products", body); location.hash = "#/website/products/" + r.id; }
        else { await api("PATCH", `/api/staff/shop/products/${id}`, body); toast("Saved"); }
      } catch (ex) { toast(ex.message, true); }
    });
    c.querySelectorAll("[data-var]").forEach((i) => i.addEventListener("change", act(() => {
      const b = i.dataset.f === "price" ? { price_pence: toPence(i.value) } : i.dataset.f === "stock" ? { stock: Math.max(0, parseInt(i.value, 10) || 0) } : { active: i.checked };
      return api("PATCH", `/api/staff/shop/variants/${i.dataset.var}`, b);
    }, "Saved")));
    c.querySelector("#add-var")?.addEventListener("submit", act((e) => { e.preventDefault(); const a = e.target;
      return api("POST", `/api/staff/shop/products/${id}/variants`, { size: a.size.value, scent: a.scent.value, price_pence: toPence(a.price.value), stock: parseInt(a.stock.value, 10) || 0 }); }, "Option added"));
  }

  /* Products: the private product repository (prices, costs, margins, packs) */

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SALE_SHORT = { pack: "Packs only", single_or_pack: "Single or pack", single: "Single", quote: "Quote", per_m2: "Per m²", per_kg: "Per kg" };
  let repoState = null;
  const repoFilters = { q: "", cat: "", mode: "", svc: "", missing: false, low: false, hidden: false };

  const marginPill = (m, min) => m == null ? `<span class="muted small">no cost</span>`
    : `<span class="pill ${m >= min ? "ok" : m >= min - 10 ? "warn" : "err"}">${m}%</span>`;

  async function viewProducts(params) {
    const tab = params.get("tab") || "items";
    const c = shell("products", "Products", `<a class="btn ghost sm" href="/atelier/prices/" target="_blank">Client view: prices</a><a class="btn ghost sm" href="/atelier/packs/" target="_blank">Client view: packs</a>`);
    if (me.role !== "admin") { c.innerHTML = `<p class="notice">The product repository includes costs and margins, so only admins can open it.</p>`; return; }
    c.innerHTML = `<div class="row">${[["items", "Items"], ["packs", "Packs"], ["import", "Import & export"], ["rules", "Pricing rules"]]
      .map(([k, l]) => `<a class="btn ${k === tab ? "primary" : ""}" href="#/products?tab=${k}">${l}</a>`).join("")}</div><div id="pane"><p class="loading">Loading…</p></div>`;
    repoState = await api("GET", "/api/staff/repository");
    const pane = c.querySelector("#pane");
    ({ items: () => repoItems(pane), packs: () => repoPacks(pane), import: () => repoImport(pane), rules: () => repoRules(pane) })[tab]();
  }

  function repoItems(pane) {
    const R = repoState, min = R.rules.minimum_margin, st = R.stats;
    pane.innerHTML = `
      <div class="stat-tiles">
        <div class="stat-tile"><strong>${st.items}</strong><span>Items</span></div>
        <div class="stat-tile"><strong>${st.online}</strong><span>On the website</span></div>
        <button class="stat-tile ${repoFilters.missing ? "on" : ""}" data-toggle="missing"><strong>${st.missing_cost}</strong><span>Missing cost</span></button>
        <button class="stat-tile ${repoFilters.low ? "on" : ""}" data-toggle="low"><strong>${st.low_margin}</strong><span>Below ${min}% margin</span></button>
        <div class="stat-tile"><strong>${st.quote}</strong><span>Quote only</span></div>
        <a class="stat-tile" href="#/products?tab=packs"><strong>${st.packs}</strong><span>Packs</span></a>
      </div>
      <div class="repo-filters">
        <input type="search" placeholder="Search items, notes, basis…" value="${esc(repoFilters.q)}" data-f="q" aria-label="Search">
        <select data-f="cat" aria-label="Category"><option value="">All categories</option>${R.categories.map((x) => `<option ${x === repoFilters.cat ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
        <select data-f="mode" aria-label="How sold"><option value="">Any way of selling</option>${Object.entries(SALE_SHORT).map(([k, l]) => `<option value="${k}" ${k === repoFilters.mode ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select data-f="svc" aria-label="Service"><option value="">Any service</option>${R.service_types.map((x) => `<option ${x === repoFilters.svc ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
        <label class="check-label"><input type="checkbox" data-f="hidden" ${repoFilters.hidden ? "checked" : ""}> Hidden or retired only</label>
        <button class="btn primary" data-new>New item</button>
      </div>
      <div id="repo-table"></div>`;
    const draw = () => {
      const f = repoFilters, q = f.q.trim().toLowerCase();
      const rows = R.items.filter((s) => (!q || (s.name + " " + s.internal_notes + " " + s.price_basis + " " + s.service_type).toLowerCase().includes(q))
        && (!f.cat || s.product_category === f.cat) && (!f.mode || s.sale_mode === f.mode) && (!f.svc || s.service_type === f.svc)
        && (!f.missing || s.cost_pence == null) && (!f.low || (s.margin != null && s.margin < min))
        && (f.hidden ? (!s.active || !s.show_online) : s.active));
      const groups = {};
      rows.forEach((s) => { (groups[s.product_category] ||= []).push(s); });
      pane.querySelector("#repo-table").innerHTML = rows.length ? Object.entries(groups).map(([g, list]) => `
        <section class="repo-group"><div class="repo-group-head">${R.category_images[g] ? `<img src="${esc(R.category_images[g])}" alt="">` : `<span class="repo-noimg">No photo</span>`}
          <h2>${esc(g)} <span class="muted small">${list.length}</span></h2><button class="link small" data-cat-photo="${esc(g)}">${R.category_images[g] ? "Change photo" : "Add photo"}</button></div>
        <div class="table-wrap"><table class="repo-table"><thead><tr><th>Item</th><th>How sold</th><th class="num">Price</th><th class="num">Pack of 5</th><th class="num">Cost</th><th class="num">Margin</th><th>Website</th></tr></thead>
        <tbody>${list.map((s) => `<tr class="click" data-item="${s.id}">
          <td><div class="repo-item">${s.image ? `<img src="${esc(s.image.startsWith("http") || s.image.startsWith("/") ? s.image : "https://lavelondon.com/wp-content/uploads/" + s.image)}" alt="" loading="lazy">` : `<span class="repo-thumb-empty"></span>`}
            <span><strong>${esc(s.name)}</strong><br><span class="small muted">${esc(s.service_type)}${s.price_basis ? " · " + esc(s.price_basis) : ""}</span></span></div></td>
          <td><span class="pill ${s.sale_mode === "quote" ? "warn" : s.sale_mode === "pack" ? "ink" : ""}">${SALE_SHORT[s.sale_mode]}</span></td>
          <td class="num">${s.sale_mode === "quote" ? `<span class="small muted">from</span> ` : ""}${money(s.price_pence)}${s.sale_mode === "per_m2" ? "/m²" : s.sale_mode === "per_kg" ? "/kg" : ""}</td>
          <td class="num">${s.pack_pence ? money(s.pack_pence) : ""}</td>
          <td class="num">${s.cost_pence != null ? money(s.cost_pence) : `<span class="muted">–</span>`}</td>
          <td class="num">${marginPill(s.margin, min)}</td>
          <td>${!s.active ? `<span class="pill">Retired</span>` : s.show_online ? `<span class="pill ok">Shown</span>` : `<span class="pill">Hidden</span>`}</td></tr>`).join("")}</tbody></table></div></section>`).join("")
        : `<p class="empty">No items match. Clear a filter or search for something else.</p>`;
      pane.querySelectorAll("tr[data-item]").forEach((tr) => tr.addEventListener("click", () => repoEditItem(R.items.find((s) => String(s.id) === tr.dataset.item))));
      pane.querySelectorAll("[data-cat-photo]").forEach((b) => b.addEventListener("click", async () => {
        const url = await pickImage();
        if (!url) return;
        try { R.category_images = await api("PUT", "/api/staff/repository/category-image", { category: b.dataset.catPhoto, image: url }); toast("Category photo saved"); draw(); }
        catch (ex) { toast(ex.message, true); }
      }));
    };
    pane.querySelectorAll("[data-f]").forEach((el) => el.addEventListener(el.type === "search" ? "input" : "change", () => {
      repoFilters[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; draw();
    }));
    pane.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
      repoFilters[b.dataset.toggle] = !repoFilters[b.dataset.toggle]; repoItems(pane);
    }));
    pane.querySelector("[data-new]").addEventListener("click", () => repoEditItem(null));
    draw();
  }

  function repoEditItem(s) {
    const R = repoState, isNew = !s;
    s = s || { name: "", product_category: repoFilters.cat || R.categories[0], sale_mode: "single_or_pack", service_type: "Dry clean", price_pence: 0,
      cost_pence: null, price_basis: "", internal_notes: "", summary: "", image: "", show_online: true, active: true, collections: [] };
    const box = document.createElement("div");
    box.className = "modal panel-right";
    box.innerHTML = `<div class="modal-card side-card" role="dialog" aria-modal="true" aria-label="${isNew ? "New item" : "Edit item"}">
      <div class="row between"><h2>${isNew ? "New item" : esc(s.name)}</h2><button class="btn ghost sm" data-close>Close</button></div>
      <form class="stack" id="item-form">
        <label>Item name<input name="name" value="${esc(s.name)}" required></label>
        <div class="form-grid">
          <label>Category<input name="product_category" list="cat-list" value="${esc(s.product_category)}" required>
            <datalist id="cat-list">${R.categories.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label>
          <label>How sold<select name="sale_mode">${Object.entries(SALE_SHORT).map(([k, l]) => `<option value="${k}" ${k === s.sale_mode ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>Service<input name="service_type" list="svc-list" value="${esc(s.service_type)}"><datalist id="svc-list">${R.service_types.map((x) => `<option value="${esc(x)}">`).join("")}</datalist></label>
        </div>
        <div class="form-grid">
          <label>Price (£)<input name="price" value="${(s.price_pence / 100).toFixed(2)}" required inputmode="decimal"></label>
          <label>LAVE cost (£)<input name="cost" value="${s.cost_pence != null ? (s.cost_pence / 100).toFixed(2) : ""}" placeholder="Not known yet" inputmode="decimal"></label>
          <div class="margin-preview"><span class="small muted">Margin</span><span id="m-preview"></span><span class="small muted" id="p-preview"></span></div>
        </div>
        <label>Price basis<input name="price_basis" value="${esc(s.price_basis)}" placeholder="American Standard, Market reference ×1.67…"></label>
        <label>Internal notes<textarea name="internal_notes" rows="3" placeholder="Only you see these">${esc(s.internal_notes)}</textarea></label>
        <fieldset class="ed-list"><legend>Clients see</legend>
          <label>Description (optional)<textarea name="summary" rows="2" placeholder="A line under the item name on the price list">${esc(s.summary)}</textarea></label>
          <div class="ed-image"><label>Photo<input name="image" value="${esc(s.image)}"></label>${s.image ? `<img src="${esc(s.image.startsWith("http") || s.image.startsWith("/") ? s.image : "https://lavelondon.com/wp-content/uploads/" + s.image)}" alt="">` : "<span></span>"}<button type="button" class="btn sm" data-pick>Choose image</button></div>
          <div class="row">${R.collections.map((k) => `<label class="check-label"><input type="checkbox" name="col" value="${k}" ${(s.collections || []).includes(k) ? "checked" : ""}> ${k[0].toUpperCase() + k.slice(1)}</label>`).join("")}</div>
          <span class="small muted">Ticked pages list this item (Atelier → Clean). Every item shown on the website is also on the full price list.</span>
          <label class="check-label"><input type="checkbox" name="show_online" ${s.show_online ? "checked" : ""}> Show on the website</label>
        </fieldset>
        ${isNew ? "" : `<label class="check-label"><input type="checkbox" name="active" ${s.active ? "checked" : ""}> Available (untick to retire: hidden everywhere, kept on past orders)</label>`}
        <div class="row"><button class="btn primary" type="submit">${isNew ? "Create item" : "Save"}</button><button type="button" class="btn ghost" data-close>Cancel</button>
          ${isNew ? "" : `<a class="small" href="/atelier/prices/#${esc(s.slug)}" target="_blank">See it on the price list</a>`}</div>
      </form></div>`;
    document.body.appendChild(box);
    const f = box.querySelector("#item-form"), close = () => box.remove();
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    box.addEventListener("click", (e) => { if (e.target === box) close(); });
    const preview = () => {
      const p = toPence(f.price.value), cost = f.cost.value.trim() ? toPence(f.cost.value) : null;
      const m = cost != null && p > 0 ? Math.round((p - cost) * 100 / p) : null;
      box.querySelector("#m-preview").innerHTML = marginPill(m, R.rules.minimum_margin);
      box.querySelector("#p-preview").textContent = ["pack", "single_or_pack"].includes(f.sale_mode.value) && p ? `Pack of 5: ${money(p * 5)}` : "";
    };
    ["input", "change"].forEach((ev) => f.addEventListener(ev, preview)); preview();
    box.querySelector("[data-pick]").addEventListener("click", async () => { const u = await pickImage(); if (u) f.image.value = u; });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { name: f.name.value.trim(), product_category: f.product_category.value.trim(), sale_mode: f.sale_mode.value,
        service_type: f.service_type.value.trim(), price_pence: toPence(f.price.value), cost_pence: f.cost.value.trim() ? toPence(f.cost.value) : null,
        price_basis: f.price_basis.value, internal_notes: f.internal_notes.value, summary: f.summary.value, image: f.image.value,
        show_online: f.show_online.checked, collections: [...f.querySelectorAll("input[name=col]:checked")].map((i) => i.value) };
      if (!isNew) body.active = f.active.checked;
      if (Number.isNaN(body.price_pence) || (body.cost_pence != null && Number.isNaN(body.cost_pence))) return toast("Check the price and cost.", true);
      try { await api(isNew ? "POST" : "PATCH", isNew ? "/api/staff/repository/items" : `/api/staff/repository/items/${s.id}`, body);
        close(); toast(isNew ? "Item created" : "Saved"); route(); }
      catch (ex) { toast(ex.message, true); }
    });
    f.name.focus();
  }

  function repoPacks(pane) {
    const R = repoState, min = R.rules.minimum_margin, month = new Date().getMonth() + 1;
    pane.innerHTML = `<div class="row between"><p class="muted small">A pack's price is always the sum of its items, so it updates when item prices change. "In season" packs are featured on the website in their months.</p>
        <button class="btn primary" data-new-pack>New pack</button></div>
      <div class="pack-admin-grid">${R.packs.map((p) => `<button class="pack-admin ${p.active ? "" : "off"}" data-pack="${p.id}">
        ${p.image ? `<img class="pack-admin-img" src="${esc(p.image)}" alt="" loading="lazy">` : ""}
        <span class="row between"><span class="pill ${p.kind === "starter" ? "ink" : ""}">${p.kind === "starter" ? "Everyday" : "Themed"}</span>
          <span>${!p.active ? `<span class="pill">Off</span>` : !p.show_online ? `<span class="pill">Hidden</span>` : p.months.includes(month) ? `<span class="pill ok">In season</span>` : ""}${p.unavailable ? ` <span class="pill err">Has a retired item</span>` : ""}</span></span>
        <strong>${esc(p.name)}</strong>
        <span class="small muted">${esc(p.note)}</span>
        <span class="small">${p.items.map((i) => `${i.qty} × ${esc(i.name)}`).join(", ")}</span>
        <span class="row between"><strong>${money(p.price_pence)}</strong><span class="small">${p.count} items · ${marginPill(p.margin, min)}</span></span>
</button>`).join("")}</div>`;
    pane.querySelector("[data-new-pack]").addEventListener("click", () => repoEditPack(null));
    pane.querySelectorAll("[data-pack]").forEach((b) => b.addEventListener("click", () => repoEditPack(R.packs.find((p) => String(p.id) === b.dataset.pack))));
  }

  function repoEditPack(p) {
    const R = repoState, isNew = !p, byId = Object.fromEntries(R.items.map((s) => [s.id, s]));
    const pack = p ? JSON.parse(JSON.stringify(p)) : { name: "", kind: "themed", note: "", summary: "", months: [], image: "", active: true, show_online: true, items: [] };
    const options = (sel) => {
      const groups = {};
      R.items.filter((s) => s.active || s.id === sel).forEach((s) => { (groups[s.product_category] ||= []).push(s); });
      return `<option value="">Choose an item</option>` + Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)} · ${money(s.price_pence)}</option>`).join("")}</optgroup>`).join("");
    };
    const box = document.createElement("div");
    box.className = "modal panel-right";
    const draw = () => {
      const lines = pack.items.filter((l) => byId[l.service_id]);
      const price = lines.reduce((t, l) => t + byId[l.service_id].price_pence * l.qty, 0);
      const costKnown = lines.length && lines.every((l) => byId[l.service_id].cost_pence != null);
      const cost = costKnown ? lines.reduce((t, l) => t + byId[l.service_id].cost_pence * l.qty, 0) : null;
      const count = lines.reduce((t, l) => t + l.qty, 0);
      box.innerHTML = `<div class="modal-card side-card" role="dialog" aria-modal="true" aria-label="Pack">
        <div class="row between"><h2>${isNew ? "New pack" : esc(pack.name)}</h2><button class="btn ghost sm" data-close>Close</button></div>
        <form class="stack" id="pack-form">
          <div class="form-grid"><label style="grid-column:span 2">Pack name<input name="name" value="${esc(pack.name)}" required></label>
            <label>Type<select name="kind"><option value="starter" ${pack.kind === "starter" ? "selected" : ""}>Everyday</option><option value="themed" ${pack.kind === "themed" ? "selected" : ""}>Themed</option></select></label></div>
          <label>When / who it's for<input name="note" value="${esc(pack.note)}" placeholder="e.g. November–February; put-away in April"></label>
          <label>Description for clients (optional)<textarea name="summary" rows="2">${esc(pack.summary)}</textarea></label>
          <div class="ed-image"><label>Photo<input name="image" value="${esc(pack.image || "")}"></label>${pack.image ? `<img src="${esc(pack.image)}" alt="">` : "<span></span>"}<button type="button" class="btn sm" data-pick-pack>Choose image</button></div>
          <fieldset class="ed-list"><legend>Items</legend>
            ${pack.items.map((l, i) => `<div class="pack-line"><select data-line="${i}" aria-label="Item">${options(l.service_id)}</select>
              <input data-qty="${i}" type="number" min="1" max="50" value="${l.qty}" aria-label="Quantity">
              <span class="small num">${byId[l.service_id] ? money(byId[l.service_id].price_pence * l.qty) : ""}</span>
              <button type="button" class="link small danger-text" data-remove-line="${i}">Remove</button></div>`).join("")}
            <button type="button" class="btn sm ghost" data-add-line>Add item</button>
          </fieldset>
          <div class="pack-sum"><span>${count} item${count === 1 ? "" : "s"}</span><strong>${money(price)}</strong>${marginPill(cost != null && price ? Math.round((price - cost) * 100 / price) : null, R.rules.minimum_margin)}</div>
          <fieldset class="ed-list"><legend>In season (featured on the website these months; none = all year)</legend>
            <div class="month-chips">${MONTH_NAMES.map((m, i) => `<label class="month-chip"><input type="checkbox" name="month" value="${i + 1}" ${pack.months.includes(i + 1) ? "checked" : ""}><span>${m}</span></label>`).join("")}</div></fieldset>
          <div class="row"><label class="check-label"><input type="checkbox" name="active" ${pack.active ? "checked" : ""}> Available</label>
            <label class="check-label"><input type="checkbox" name="show_online" ${pack.show_online ? "checked" : ""}> Show on the website</label></div>
          <div class="row"><button class="btn primary" type="submit">${isNew ? "Create pack" : "Save"}</button><button type="button" class="btn ghost" data-close>Cancel</button>
            ${isNew ? "" : `<span id="del-box"><button type="button" class="btn danger" data-delete>Delete pack</button></span>`}</div>
        </form></div>`;
      const f = box.querySelector("#pack-form");
      const keep = () => { pack.name = f.name.value; pack.kind = f.kind.value; pack.note = f.note.value; pack.summary = f.summary.value; pack.image = f.image.value;
        pack.months = [...f.querySelectorAll("input[name=month]:checked")].map((i) => Number(i.value)); pack.active = f.active.checked; pack.show_online = f.show_online.checked; };
      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => box.remove()));
      f.querySelectorAll("[data-line]").forEach((s) => s.addEventListener("change", () => { keep(); pack.items[s.dataset.line].service_id = Number(s.value); draw(); }));
      f.querySelectorAll("[data-qty]").forEach((q) => q.addEventListener("change", () => { keep(); pack.items[q.dataset.qty].qty = Math.max(1, Number(q.value) || 1); draw(); }));
      f.querySelectorAll("[data-remove-line]").forEach((b) => b.addEventListener("click", () => { keep(); pack.items.splice(Number(b.dataset.removeLine), 1); draw(); }));
      f.querySelector("[data-add-line]").addEventListener("click", () => { keep(); pack.items.push({ service_id: 0, qty: 1 }); draw(); });
      f.querySelector("[data-pick-pack]").addEventListener("click", async () => { keep(); const u = await pickImage(); if (u) { pack.image = u; draw(); } });
      f.querySelector("[data-delete]")?.addEventListener("click", () => {
        const d = box.querySelector("#del-box");
        d.innerHTML = `<span class="small">Delete ${esc(pack.name)}?</span> <button type="button" class="btn danger sm" data-yes>Delete</button>`;
        d.querySelector("[data-yes]").addEventListener("click", async () => {
          try { await api("DELETE", `/api/staff/repository/packs/${p.id}`); box.remove(); toast("Pack deleted"); route(); } catch (ex) { toast(ex.message, true); }
        });
      });
      f.addEventListener("submit", async (e) => {
        e.preventDefault(); keep();
        const items = pack.items.filter((l) => l.service_id);
        if (!items.length) return toast("Add at least one item.", true);
        try { await api(isNew ? "POST" : "PUT", isNew ? "/api/staff/repository/packs" : `/api/staff/repository/packs/${p.id}`, { ...pack, items });
          box.remove(); toast(isNew ? "Pack created" : "Saved"); route(); }
        catch (ex) { toast(ex.message, true); }
      });
    };
    document.body.appendChild(box);
    box.addEventListener("click", (e) => { if (e.target === box) box.remove(); });
    draw();
  }

  function repoImport(pane) {
    pane.innerHTML = `<section class="panel">
        <h2>Download</h2>
        <p class="small muted">The whole repository as a CSV, in the same columns as your pricing sheet plus Code, On website and Client description. Open it in Google Sheets or Excel.</p>
        <div><a class="btn" href="/api/staff/repository/export.csv">Download CSV</a></div>
      </section>
      <section class="panel">
        <h2>Upload from your pricing sheet</h2>
        <p class="small muted">In Google Sheets choose File → Download → CSV (the item list tab), then upload it here. You'll see every change before anything is saved. Items are matched by Code (if the file has one) or by name. Margin % and Pack of 5 are worked out here, so those columns are ignored.</p>
        <label class="btn">Choose CSV file<input type="file" accept=".csv,text/csv" hidden data-file></label>
        <div id="preview"></div>
      </section>`;
    let file = null;
    const sendFile = async (apply, retire) => {
      const fd = new FormData(); fd.append("file", file); fd.append("apply", apply ? "true" : "false"); fd.append("retire_missing", retire ? "true" : "false");
      const res = await fetch("/api/staff/repository/import", { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Import failed.");
      return data;
    };
    const FIELD = { product_category: "Category", sale_mode: "How sold", service_type: "Service", price_pence: "Price", cost_pence: "Cost", price_basis: "Basis", internal_notes: "Notes", name: "Name", active: "Available" };
    const show = (k, v) => v == null || v === "" ? "–" : (k === "price_pence" || k === "cost_pence") ? money(v) : k === "sale_mode" ? SALE_SHORT[v] : esc(String(v));
    pane.querySelector("[data-file]").addEventListener("change", async (e) => {
      file = e.target.files[0];
      const out = pane.querySelector("#preview");
      out.innerHTML = `<p class="loading">Reading ${esc(file.name)}…</p>`;
      try {
        const d = await sendFile(false, false);
        out.innerHTML = `
          ${d.problems.length ? `<div class="notice err-text"><strong>Fix these in the sheet first:</strong><ul>${d.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
          <div class="stat-tiles"><div class="stat-tile"><strong>${d.rows}</strong><span>Rows</span></div><div class="stat-tile"><strong>${d.new.length}</strong><span>New</span></div>
            <div class="stat-tile"><strong>${d.changed.length}</strong><span>Changed</span></div><div class="stat-tile"><strong>${d.unchanged}</strong><span>Unchanged</span></div>
            <div class="stat-tile"><strong>${d.missing.length}</strong><span>Not in the file</span></div></div>
          ${d.new.length ? `<details open><summary><strong>New items (${d.new.length})</strong></summary><ul class="small">${d.new.map((n) => `<li>${esc(n.name)} <span class="muted">${esc(n.category)} · ${money(n.price_pence)}</span></li>`).join("")}</ul></details>` : ""}
          ${d.changed.length ? `<details open><summary><strong>Changes (${d.changed.length})</strong></summary><div class="table-wrap"><table><thead><tr><th>Item</th><th>What changes</th></tr></thead><tbody>
            ${d.changed.map((c) => `<tr><td>${esc(c.name)}</td><td class="small">${Object.entries(c.changes).map(([k, [a, b]]) => `${FIELD[k] || k}: <s>${show(k, a)}</s> → <strong>${show(k, b)}</strong>`).join("<br>")}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
          ${d.missing.length ? `<details><summary><strong>In LAVE OS but not in the file (${d.missing.length})</strong></summary><ul class="small">${d.missing.map((m) => `<li>${esc(m.name)} <span class="muted">${esc(m.category)}</span></li>`).join("")}</ul></details>
            <label class="check-label"><input type="checkbox" data-retire> Retire these ${d.missing.length} items (hidden everywhere, kept on past orders)</label>` : ""}
          ${!d.problems.length && (d.new.length || d.changed.length || d.missing.length) ? `<div class="row"><button class="btn primary" data-apply>Apply ${d.new.length + d.changed.length} change${d.new.length + d.changed.length === 1 ? "" : "s"}</button></div>`
            : !d.problems.length ? `<p class="ok small">Everything already matches the file.</p>` : ""}`;
        out.querySelector("[data-apply]")?.addEventListener("click", async (ev) => {
          ev.target.disabled = true;
          try { const r = await sendFile(true, !!out.querySelector("[data-retire]")?.checked);
            toast(`Imported: ${r.added} new, ${r.updated} updated${r.retired ? `, ${r.retired} retired` : ""}.`); location.hash = "#/products?tab=items"; }
          catch (ex) { toast(ex.message, true); ev.target.disabled = false; }
        });
      } catch (ex) { out.innerHTML = `<p class="error">${esc(ex.message)}</p>`; }
    });
  }

  function repoRules(pane) {
    const r = repoState.rules;
    pane.innerHTML = `<form class="panel stack" id="rules">
        <h2>Pricing rules</h2>
        <div class="form-grid">
          <label>Minimum order, home (£)<input name="home_min" value="${(r.home_minimum_pence / 100).toFixed(2)}"></label>
          <label>Minimum order, drop-off (£)<input name="drop_min" value="${(r.dropoff_minimum_pence / 100).toFixed(2)}"></label>
          <label>Free collection from (£)<input name="free" value="${(r.free_delivery_from_pence / 100).toFixed(2)}"></label>
          <label>Minimum margin (%)<input name="minimum_margin" type="number" min="0" max="95" value="${r.minimum_margin}"></label>
        </div>
        <p class="small muted">The minimum orders and free-collection amount are shown to clients and used in their list. The minimum margin colours the Margin column here.</p>
        <label>Rules and notes (private)<textarea name="text" rows="18">${esc(r.text)}</textarea></label>
        <div><button class="btn primary">Save rules</button></div>
      </form>`;
    pane.querySelector("#rules").addEventListener("submit", act((e) => { e.preventDefault(); const f = e.target;
      return api("PUT", "/api/staff/repository/rules", { home_minimum_pence: toPence(f.home_min.value), dropoff_minimum_pence: toPence(f.drop_min.value), free_delivery_from_pence: toPence(f.free.value),
        minimum_margin: Number(f.minimum_margin.value), text: f.text.value }); }, "Rules saved"));
  }

  /* Settings */

  async function viewSettings(params) {
    const tab = params.get("tab") || "slots";
    const isAdmin = me.role === "admin";
    const c = shell("settings", "Settings");
    const tabs = [["slots", "Slots"], ["closures", "Closures"], ["delivery", "Collection & delivery"], ["area", "Service area"], ["ateliers", "Ateliers"],
      ["security", "Two-step sign-in"], ...(isAdmin ? [["team", "Team"], ["email", "Email"], ["system", "System"]] : [])];
    c.innerHTML = `<div class="row">${tabs.map(([k, l]) => `<a class="btn ${k === tab ? "primary" : ""}" href="#/settings?tab=${k}">${l}</a>`).join("")}</div>
      ${isAdmin ? "" : `<p class="notice">Only admins can change settings.</p>`}<div id="pane"><p class="loading">Loading…</p></div>`;
    const pane = c.querySelector("#pane");
    const dis = isAdmin ? "" : "disabled";

    if (tab === "services") {
      services = await api("GET", "/api/staff/services");
      pane.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Unit</th><th class="num">Price (£)</th><th>Active</th></tr></thead>
        <tbody>${services.map((s) => `<tr><td class="tag">${esc(s.code)}</td><td><input data-svc="${s.id}" data-f="name" value="${esc(s.name)}" ${dis}></td><td>${esc(s.category)}</td><td>${esc(s.unit)}</td>
          <td class="num"><input data-svc="${s.id}" data-f="price" value="${(s.price_pence / 100).toFixed(2)}" size="7" style="text-align:right" ${dis}></td>
          <td><input type="checkbox" data-svc="${s.id}" data-f="active" ${s.active ? "checked" : ""} ${dis} aria-label="Active"></td></tr>`).join("")}</tbody></table></div>
        ${isAdmin ? `<form id="svc-add" class="panel form-grid"><label>Code<input name="code" required placeholder="DC_SCARF"></label><label>Name<input name="name" required></label>
          <label>Category<select name="category">${["clean", "press", "refresh", "preserve", "vault", "repair"].map((x) => `<option>${x}</option>`).join("")}</select></label>
          <label>Unit<input name="unit" value="item"></label><label>Price (£)<input name="price" required></label><button class="btn primary">Add service</button></form>` : ""}`;
      pane.querySelectorAll("[data-svc]").forEach((i) => i.addEventListener("change", act(() => {
        const body = i.dataset.f === "price" ? { price_pence: toPence(i.value) } : i.dataset.f === "active" ? { active: i.checked } : { name: i.value };
        return api("PATCH", `/api/staff/services/${i.dataset.svc}`, body);
      }, "Saved")));
      pane.querySelector("#svc-add")?.addEventListener("submit", act((e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target).entries());
        return api("POST", "/api/staff/services", { code: f.code.toUpperCase(), name: f.name, category: f.category, unit: f.unit, price_pence: toPence(f.price) });
      }, "Service added"));
    }

    if (tab === "email") {
      const e = await api("GET", "/api/staff/email");
      pane.innerHTML = `<section class="panel stack">
        <h2>Email sending</h2>
        ${e.configured ? `<p class="ok small">Set up: sending through <strong>${esc(e.host)}</strong> as <strong>${esc(e.mail_from)}</strong>.</p>`
          : `<p class="notice">Not set up yet, so sign-in links, password resets and receipts aren't being sent. Add the LAVE_SMTP_ settings in Render → lave-os → Environment.</p>`}
        <dl class="kv"><dt>Mail server</dt><dd>${esc(e.host || "–")}${e.host ? ":" + e.port : ""}</dd><dt>Username</dt><dd>${esc(e.user || "–")}</dd><dt>Sent from</dt><dd>${esc(e.mail_from)}</dd></dl>
        <div class="row"><button class="btn primary" data-test-email>Send a test email to ${esc(e.send_to)}</button></div>
        <p class="small muted" id="email-result" role="status"></p></section>`;
      pane.querySelector("[data-test-email]").addEventListener("click", async (ev) => {
        const out = pane.querySelector("#email-result");
        ev.target.disabled = true; out.textContent = "Sending…";
        try { const r = await api("POST", "/api/staff/email/test"); out.className = "small ok"; out.textContent = `Sent. Check the inbox for ${r.sent_to} (and the spam folder, the first time).`; }
        catch (ex) { out.className = "small error"; out.textContent = ex.message; }
        ev.target.disabled = false;
      });
    }

    if (tab === "slots") {
      const rows = await api("GET", "/api/staff/slots/templates");
      const groups = {};
      rows.forEach((t) => { (groups[`${t.mode}|${t.window_type}`] ||= []).push(t); });
      const groupName = { "lave_collects|hour": "LAVE collects · 1 hour", "lave_collects|saver": "LAVE collects · Saver" };
      pane.innerHTML = `<p class="muted">Capacity is how many bookings each window can take. Changes apply to new bookings. Charges are set under <a href="#/settings?tab=delivery">Collection &amp; delivery</a>.</p>
        ${ROUTE_DAY_NOTE}
        ${Object.entries(groups).filter(([k]) => groupName[k]).map(([k, list]) => {
          const times = [...new Set(list.map((t) => t.start + "–" + t.end))].sort();
          return `<section class="panel"><h2>${groupName[k] || k}</h2><div class="table-wrap"><table>
            <thead><tr><th>Window</th>${WEEKDAYS.map((d) => `<th>${d}</th>`).join("")}</tr></thead>
            <tbody>${times.map((tm) => {
              const cells = WEEKDAYS.map((_, wd) => list.find((t) => t.weekday === wd && t.start + "–" + t.end === tm));
              const any = cells.find(Boolean);
              return `<tr><td class="tag">${tm}</td>${cells.map((t) => `<td>${t ? `<input data-tpl="${t.id}" data-f="capacity" value="${t.active ? t.capacity : 0}" size="2" ${dis} aria-label="Capacity">` : `<span class="muted">–</span>`}</td>`).join("")}</tr>`;
            }).join("")}</tbody></table></div></section>`;
        }).join("")}`;
      pane.querySelectorAll("[data-tpl]").forEach((i) => i.addEventListener("change", act(() => {
        const n = Math.max(0, parseInt(i.value, 10) || 0);
        return api("PATCH", `/api/staff/slots/templates/${i.dataset.tpl}`, n ? { capacity: n, active: true } : { active: false });
      }, "Capacity saved")));
    }

    if (tab === "delivery") {
      const d = await api("GET", "/api/staff/delivery-settings");
      const p = (k) => (d[k] / 100).toFixed(2);
      const field = (k, label) => `<label>${label}<input name="${k}" value="${p(k)}" ${dis}></label>`;
      pane.innerHTML = `<form id="delivery" class="panel stack">
          <h2>Minimum order</h2>
          <p class="small muted">Items in a booking must come to at least this. Quotes count at their "from" price; curated packs can always be booked. Booked without a list? We charge up to the minimum at review. See <a href="#/profit">Profitability</a> for what each order earns.</p>
          <div class="form-grid">
            ${field("home_minimum_pence", "Home collection (£)")}
            ${field("dropoff_minimum_pence", "Atelier drop-off (£)")}
          </div>
          <h2>Charges</h2>
          <p class="small muted">One charge per booking covers collection and return. If either leg is one-hour, the one-hour charge applies, once.</p>
          <div class="form-grid">
            <label>Free Saver from (£, non-members)<input name="free_saver_threshold_pence" value="${p("free_saver_threshold_pence")}" ${dis}></label>
            ${field("nonmember_saver_under_pence", "Non-member Saver, under that (£)")}
            ${field("nonmember_one_hour_pence", "Non-member one-hour (£)")}
            ${field("essence_saver_pence", "Essence Saver (£)")}
            ${field("essence_one_hour_pence", "Essence one-hour (£)")}
            ${field("elevate_eclat_saver_pence", "Elevate & Éclat Saver (£)")}
            ${field("elevate_eclat_one_hour_pence", "Elevate & Éclat one-hour (£)")}
          </div>
          <h2>Missed visits</h2>
          <p class="small muted">A customer's first missed visit in any 12 months is rebooked free. After that, non-members pay the collection and delivery charge for that window, and members pay this.</p>
          <div class="form-grid">${field("member_missed_visit_pence", "Members, each missed visit (£)")}</div>
          <h2>Turnaround</h2>
          <div class="form-grid">
            <label>Returns open after (hours)<input name="turnaround_hours" type="number" min="1" value="${d.turnaround_hours}" ${dis}></label>
            <label style="grid-column:span 3">Categories confirmed per order (one per line; anything sold as a quote is always included)
              <textarea name="confirmed_categories" rows="4" ${dis}>${esc(d.confirmed_categories.join("\n"))}</textarea></label>
          </div>
          <label class="check-label"><input type="checkbox" name="dropoff_enabled" ${d.dropoff_enabled ? "checked" : ""} ${dis}> Members can drop off at an atelier</label>
          ${isAdmin ? `<div><button class="btn primary">Save</button></div>` : ""}
        </form>
        <form id="credit-expiry" class="panel stack"><h2>LAVE account credit</h2>
          <p class="small muted">Money we owe a client after review goes to their LAVE account and is used on their next booking (or refunded to their card if they ask).</p>
          <label style="max-width:320px">Credit expires after (days; blank: never)<input name="days" type="number" min="1" value="${d.credit_expiry_days ?? ""}" ${dis}></label>
          ${isAdmin ? `<div><button class="btn">Save</button></div>` : ""}</form>
        <section class="panel"><h2>Driver on the way</h2><p class="small">When a visit is marked <strong>En route</strong> on Today, the client is told their driver is on the way:
          ${d.texts ? "by text message, or by email if they have no mobile number or the text fails." : "by email. To send text messages instead, add the LAVE_TWILIO_ settings in Render → lave-os → Environment."}</p>
          ${isAdmin ? `<form id="sms-test" class="row"><input name="phone" placeholder="Your mobile, e.g. 07700 900123" aria-label="Mobile number"><button class="btn">Send a test text</button></form>` : ""}</section>
        <section class="panel"><h2>Bank holidays</h2><p class="small muted">England &amp; Wales, from gov.uk (checked daily). No collections or returns on these days. Close other days under <a href="#/settings?tab=closures">Closures</a>.</p>
          <p>${d.bank_holidays.map((x) => D.format(parse(x))).join(" · ") || "None listed"}</p></section>`;
      pane.querySelector("#sms-test")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        try { const r = await api("POST", "/api/staff/sms/test", { phone: e.target.phone.value }); toast(`Test text sent to ${r.sent_to}`); }
        catch (ex) { toast(ex.message, true); }
      });
      pane.querySelector("#credit-expiry").addEventListener("submit", act((e) => {
        e.preventDefault();
        return api("PUT", "/api/staff/credit-expiry", { days: e.target.days.value ? Number(e.target.days.value) : null });
      }, "Credit expiry saved"));
      pane.querySelector("#delivery").addEventListener("submit", act((e) => {
        e.preventDefault();
        const f = e.target, body = {};
        ["home_minimum_pence", "dropoff_minimum_pence", "free_saver_threshold_pence", "nonmember_saver_under_pence", "nonmember_one_hour_pence", "essence_saver_pence", "essence_one_hour_pence",
          "elevate_eclat_saver_pence", "elevate_eclat_one_hour_pence", "member_missed_visit_pence"].forEach((k) => { body[k] = toPence(f[k].value); });
        body.turnaround_hours = Number(f.turnaround_hours.value);
        body.confirmed_categories = f.confirmed_categories.value.split("\n").map((x) => x.trim()).filter(Boolean);
        body.dropoff_enabled = f.dropoff_enabled.checked;
        return api("PUT", "/api/staff/delivery-settings", body);
      }, "Collection & delivery saved"));
    }

    if (tab === "area") {
      const [a, wl] = await Promise.all([api("GET", "/api/staff/area"), api("GET", "/api/staff/area/waitlist")]);
      pane.innerHTML = `<section class="panel stack"><h2>Where we collect and deliver</h2>
          <p>${a.postcodes.toLocaleString("en-GB")} postcodes: ${a.districts.map((x) => `${esc(x.district)} (${x.postcodes})`).join(", ")}${a.sectors.length ? `, plus whole sectors ${a.sectors.map((x) => esc(x.sector)).join(", ")}` : ""}.</p>
          <form id="area-check" class="row"><input name="postcode" placeholder="Check a postcode" aria-label="Postcode"><button class="btn">Check</button><span class="small" id="area-result" role="status"></span></form>
          ${isAdmin ? `<form id="area-add" class="stack"><label>Add postcodes or whole sectors (one per line, e.g. SW4 9AS or SW4 9)<textarea name="entries" rows="3"></textarea></label><div><button class="btn primary">Add to the area</button></div></form>` : ""}
          ${a.sectors.length || a.added.length ? `<div class="table-wrap"><table><thead><tr><th>Added</th><th>By</th><th></th></tr></thead><tbody>
            ${[...a.sectors.map((x) => [x.sector + " (whole sector)", x.added_by, x.sector]), ...a.added.map((x) => [x.postcode, x.added_by, x.postcode])].map(([l, by, key]) =>
              `<tr><td>${esc(l)}</td><td class="small muted">${esc(by)}</td><td>${isAdmin ? `<button class="link small" data-area-del="${esc(key)}">Remove</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
        </section>
        <section class="panel stack"><h2>Waitlist</h2>
          ${a.waitlist_by_district.length ? `<p>Demand by district: ${a.waitlist_by_district.map((x) => `<strong>${esc(x.district)}</strong> ${x.people}`).join(" · ")}</p>` : ""}
          ${wl.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Phone</th><th>Postcode</th><th>Wants</th></tr></thead><tbody>
            ${wl.map((w) => `<tr><td class="small">${D.format(parse(w.created_at))}</td><td>${esc(w.name)}</td><td>${esc(w.email)}</td><td>${esc(w.phone)}</td><td>${esc(w.postcode)}</td><td class="small">${esc(w.services.join(", "))}</td></tr>`).join("")}</tbody></table></div>`
            : `<p class="empty">No one on the waitlist yet.</p>`}
        </section>`;
      pane.querySelector("#area-check").addEventListener("submit", async (e) => {
        e.preventDefault();
        const r = await api("GET", "/api/staff/area/check?postcode=" + encodeURIComponent(e.target.postcode.value));
        pane.querySelector("#area-result").textContent = `${r.postcode}: ${r.in_zone ? "in our area" : "not yet in our area"}`;
      });
      pane.querySelector("#area-add")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const r = await api("POST", "/api/staff/area", { entries: e.target.entries.value });
          toast(`Added ${r.postcodes.length} postcode${r.postcodes.length === 1 ? "" : "s"}${r.sectors.length ? ` and ${r.sectors.length} sector${r.sectors.length === 1 ? "" : "s"}` : ""}${r.skipped.length ? `. Not postcodes: ${r.skipped.join(", ")}` : ""}`, !!r.skipped.length);
          route();
        } catch (ex) { toast(ex.message, true); }
      });
      pane.querySelectorAll("[data-area-del]").forEach((b) => b.addEventListener("click", act(() => api("DELETE", "/api/staff/area/" + encodeURIComponent(b.dataset.areaDel)), "Removed from the area")));
    }

    if (tab === "ateliers") {
      const list = await api("GET", "/api/staff/ateliers");
      const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const form = (a = {}) => `
        <div class="form-grid">
          <label style="grid-column:span 2">Name<input name="name" required value="${esc(a.name || "")}" placeholder="LAVE Atelier, Battersea Power Station" ${dis}></label>
          <label style="grid-column:span 2">Address<input name="address" value="${esc(a.address || "")}" ${dis}></label>
          <label>Postcode<input name="postcode" value="${esc(a.postcode || "")}" ${dis}></label>
          <label>Status<select name="status" ${dis}>${["active", "paused", "retired"].map((s) => `<option ${a.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          <label>Open from<input type="date" name="available_from" value="${a.available_from || ""}" ${dis}></label>
          <label>Open until<input type="date" name="available_to" value="${a.available_to || ""}" ${dis}></label>
          <label>Drop-offs a day (blank: no limit)<input type="number" min="0" name="daily_capacity" value="${a.daily_capacity ?? ""}" ${dis}></label>
          <label class="check-label"><input type="checkbox" name="members_only" ${a.members_only !== false ? "checked" : ""} ${dis}> Members only</label>
          <label style="grid-column:span 2">Map link<input name="map_link" value="${esc(a.map_link || "")}" ${dis}></label>
          <label style="grid-column:1/-1">Access instructions<input name="access_instructions" value="${esc(a.access_instructions || "")}" placeholder="Concierge desk, Building 3. Ask for the LAVE drop box." ${dis}></label>
        </div>
        <div class="table-wrap"><table><thead><tr><th>Opening hours</th><th>Opens</th><th>Closes</th></tr></thead><tbody>
          ${DAYS.map((d, i) => { const h = (a.weekly_hours || {})[i] || []; return `<tr><td>${d}</td><td><input type="time" name="open_${i}" value="${h[0] || ""}" ${dis}></td><td><input type="time" name="close_${i}" value="${h[1] || ""}" ${dis}></td></tr>`; }).join("")}
        </tbody></table></div>
        <label>Closed on (one date per line, YYYY-MM-DD)<textarea name="closure_dates" rows="2" ${dis}>${esc((a.closure_dates || []).join("\n"))}</textarea></label>`;
      const body = (f) => {
        const hours = {};
        for (let i = 0; i < 7; i++) if (f["open_" + i].value && f["close_" + i].value) hours[i] = [f["open_" + i].value, f["close_" + i].value];
        return { name: f.name.value, address: f.address.value, postcode: f.postcode.value, status: f.status.value,
          available_from: f.available_from.value || null, available_to: f.available_to.value || null,
          daily_capacity: f.daily_capacity.value ? Number(f.daily_capacity.value) : 0, members_only: f.members_only.checked,
          map_link: f.map_link.value, access_instructions: f.access_instructions.value, weekly_hours: hours,
          closure_dates: f.closure_dates.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) };
      };
      pane.innerHTML = `<p class="muted">Members can drop items off at these ateliers instead of booking a home collection. Ateliers don't hand items back: everything comes home by delivery.</p>
        ${list.map((a) => `<details class="panel"><summary><strong>${esc(a.name)}</strong> <span class="pill ${{ active: "ok", paused: "warn", retired: "err" }[a.status] || ""}">${esc(a.status)}</span> <span class="small muted">${esc(a.hours_text || "No opening hours")}</span></summary>
          <form class="stack" data-atelier="${a.id}" style="margin-top:12px">${form(a)}
            <div class="warn-box" hidden></div>
            ${isAdmin ? `<div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-history>Change history</button><button class="btn danger" type="button" data-delete>Delete</button></div>` : ""}
            <div class="history small" hidden></div></form></details>`).join("") || `<p class="empty">No ateliers yet.</p>`}
        ${isAdmin ? `<details class="panel"><summary><strong>+ Add an atelier</strong></summary><form id="atelier-add" class="stack" style="margin-top:12px">${form({ status: "active", members_only: true })}<div><button class="btn primary">Add atelier</button></div></form></details>` : ""}`;
      pane.querySelector("#atelier-add")?.addEventListener("submit", act((e) => { e.preventDefault(); return api("POST", "/api/staff/ateliers", body(e.target)); }, "Atelier added"));
      pane.querySelectorAll("form[data-atelier]").forEach((f) => {
        const id = f.dataset.atelier, warn = f.querySelector(".warn-box");
        const save = async (confirm) => {
          try {
            const r = await api("PATCH", `/api/staff/ateliers/${id}`, { ...body(f), confirm });
            if (!r.applied) {
              warn.hidden = false;
              warn.innerHTML = `<p class="notice"><strong>${r.affected.length} booked drop-off${r.affected.length === 1 ? "" : "s"} would be affected.</strong> Offer these members another atelier or a home collection:</p>
                <ul class="plain-list">${r.affected.map((x) => `<li>${esc(x.client)} · ${D.format(parse(x.day))} · ${esc(x.ref)} · ${esc(x.email)}${x.phone ? " · " + esc(x.phone) : ""}</li>`).join("")}</ul>
                <div class="row"><button class="btn danger" type="button" data-apply>Save anyway</button></div>`;
              warn.querySelector("[data-apply]").addEventListener("click", () => save(true));
              return;
            }
            toast(r.affected.length ? `Saved. ${r.affected.length} members need another arrangement.` : "Atelier saved", !!r.affected.length);
            route();
          } catch (ex) { toast(ex.message, true); }
        };
        f.addEventListener("submit", (e) => { e.preventDefault(); save(false); });
        f.querySelector("[data-delete]")?.addEventListener("click", act(() => api("DELETE", `/api/staff/ateliers/${id}`), "Atelier deleted"));
        f.querySelector("[data-history]")?.addEventListener("click", async () => {
          const h = f.querySelector(".history");
          const rows = await api("GET", `/api/staff/ateliers/${id}/history`);
          h.hidden = false;
          h.innerHTML = rows.map((x) => `<p><span class="muted">${x.at ? DT.format(parse(x.at)) : ""} · ${esc(x.by)}</span><br>${esc(x.what)}</p>`).join("") || "No changes yet.";
        });
      });
    }

    if (tab === "closures") {
      const rows = await api("GET", "/api/staff/slots/blackouts");
      pane.innerHTML = `${isAdmin ? `<form id="close-add" class="panel form-grid"><label>Day<input type="date" name="day" required></label><label style="grid-column:span 2">Reason<input name="reason" placeholder="Bank holiday"></label><button class="btn primary">Close this day</button></form>` : ""}
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Day</th><th>Reason</th><th></th></tr></thead><tbody>${rows.map((b) => `<tr><td>${D.format(parse(b.day))}</td><td>${esc(b.reason)}</td><td>${isAdmin ? `<button class="link small" data-reopen="${b.id}">Reopen</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No upcoming closures.</p>`}`;
      pane.querySelector("#close-add")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const r = await api("POST", "/api/staff/slots/blackouts", Object.fromEntries(new FormData(e.target).entries()));
          toast(r.existing_bookings ? `Closed. ${r.existing_bookings} existing bookings on that day need rearranging.` : "Day closed", !!r.existing_bookings);
          route();
        } catch (ex) { toast(ex.message, true); }
      });
      pane.querySelectorAll("[data-reopen]").forEach((b) => b.addEventListener("click", act(() => api("DELETE", `/api/staff/slots/blackouts/${b.dataset.reopen}`), "Reopened")));
    }

    if (tab === "security") {
      const who = await api("GET", "/api/staff/me");
      me = { ...me, ...who };
      if (!who.two_step) { await twoStepSetup(pane); return; }
      pane.innerHTML = `<section class="panel stack" style="max-width:560px"><h2>Two-step sign-in</h2>
          <p class="ok">On. You'll be asked for a code from your authenticator app each time you sign in.</p>
          <p class="small muted">${who.recovery_codes_left} recovery code${who.recovery_codes_left === 1 ? "" : "s"} left.</p>
          ${who.two_step_required ? `<p class="small muted">Required for everyone. To move it to a new phone, ask an admin to reset it.</p>`
            : `<form id="ts-off" class="row"><input name="code" placeholder="Current code" inputmode="numeric" aria-label="Current code"><button class="btn">Turn off</button></form>`}
        </section>`;
      pane.querySelector("#ts-off")?.addEventListener("submit", act((e) => { e.preventDefault(); return api("POST", "/api/staff/auth/two-step/off", { code: e.target.code.value }).then((x) => { me = { ...me, ...x }; }); }, "Two-step sign-in turned off"));
    }

    if (tab === "system" && isAdmin) {
      const x = await api("GET", "/api/staff/system"), b = x.backup;
      const on = (v, yes, no) => v ? `<span class="ok">${yes}</span>` : `<span class="warn-text">${no}</span>`;
      const size = (n) => n > 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1e6).toFixed(1) + " MB";
      pane.innerHTML = `<section class="panel stack"><h2>Visitors</h2>
          <p>${on(x.analytics, "Cloudflare Web Analytics is on.", "Not set up yet.")} ${x.analytics ? `See visitors at dash.cloudflare.com → Analytics &amp; Logs → Web Analytics.` : `Add LAVE_CF_ANALYTICS_TOKEN in Render (see LAUNCH.md, "Analytics").`}</p></section>
        <section class="panel stack"><h2>Alerts</h2>
          <p>Website errors and failed background jobs are emailed to <strong>${esc(x.alert_email)}</strong>, at most once every 30 minutes for each kind of problem.${x.email ? "" : ` <span class="warn-text">Email sending isn't set up, so alerts can't go out.</span>`}</p>
          <div class="row"><button class="btn sm" id="test-alert">Send a test alert</button></div>
          <p class="small">Is the website up? That needs a watcher outside it: a free UptimeRobot monitor on <span class="tag">${esc(x.health_url)}</span> every 5 minutes (LAUNCH.md, "Uptime").</p>
          <h3>Recent problems</h3>
          ${x.problems.length ? `<ul class="timeline">${x.problems.map((p) => `<li><span class="small muted">${DT.format(parse(p.at))}</span><span><strong>${esc(p.kind)}</strong><br><span class="small">${esc(p.detail.split("\n").slice(0, 3).join(" · "))}</span></span></li>`).join("")}</ul>` : `<p class="small muted">None since the website last restarted.</p>`}</section>
        <section class="panel stack"><h2>Photo backups</h2>
          ${!x.photos_in_bucket ? `<p class="small muted">Photos aren't in R2 on this machine.</p>` : b.configured
            ? `<p>${on(!b.error, "Weekly copy to", "The last copy failed:")} ${b.error ? esc(b.error) : `<strong>${esc(b.bucket)}</strong>, keeping the newest ${b.keep}.`}</p>
               ${b.finished_at ? `<p class="small">Last copy: ${DT.format(parse(b.finished_at))}, ${b.photos} photos (${size(b.bytes || 0)})${b.removed_folders?.length ? `; removed ${b.removed_folders.length} older cop${b.removed_folders.length === 1 ? "y" : "ies"}` : ""}.</p>` : `<p class="small muted">${b.running ? "Copying now…" : "No copy yet: the first runs within a day."}</p>`}
               <div class="row"><button class="btn sm" id="backup-now">Back up now</button></div>`
            : `<p class="warn-text">Not set up yet.</p><p class="small">Create a second R2 bucket (e.g. lave-media-backup), give the R2 API token access to it, then add LAVE_STORAGE_BACKUP_BUCKET in Render (LAUNCH.md, "Photo backups").</p>`}</section>
        <section class="panel"><h2>Other services</h2><dl class="kv">
          <dt>Email</dt><dd>${on(x.email, "Sending (Resend)", "Not set up")}</dd>
          <dt>Text messages</dt><dd>${on(x.texts, "Sending (Twilio)", "Not set up: driver messages go by email")}</dd>
          <dt>Sign-up bot check</dt><dd>${on(x.turnstile, "Cloudflare Turnstile on", "Turnstile off (other checks still run)")}</dd></dl></section>`;
      pane.querySelector("#test-alert").addEventListener("click", async () => {
        try { const r = await api("POST", "/api/staff/system/test-alert"); toast(r.sent ? `Test alert sent to ${r.to}` : "Not sent: check email settings", !r.sent); } catch (e) { toast(e.message, true); }
      });
      pane.querySelector("#backup-now")?.addEventListener("click", act(() => api("POST", "/api/staff/system/backup"), "Backup started. Refresh in a minute."));
    }

    if (tab === "team" && isAdmin) {
      const rows = await api("GET", "/api/staff/team");
      const who = await api("GET", "/api/staff/me");
      pane.innerHTML = `<section class="panel row between"><span><strong>Two-step sign-in</strong> <span class="small muted">${who.two_step_required ? "Required for everyone: anyone without it sets it up at their next sign-in." : "Optional: each person turns it on under Settings → Two-step sign-in."}</span></span>
          <button class="btn sm" id="ts-require">${who.two_step_required ? "Make it optional" : "Require it for everyone"}</button></section>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Two-step</th></tr></thead>
        <tbody>${rows.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.email)}</td>
          <td><select data-role="${s.id}" aria-label="Role">${["admin", "operator", "driver"].map((r) => `<option ${s.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
          <td><input type="checkbox" data-active="${s.id}" ${s.active ? "checked" : ""} aria-label="Active"></td>
          <td>${s.two_step ? `${pill("on")} <button class="link small" data-ts-reset="${s.id}">Reset</button>` : `<span class="muted small">Off</span>`}</td></tr>`).join("")}</tbody></table></div>
        <form id="team-add" class="panel form-grid"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label>
          <label>Temporary password<input name="password" type="text" minlength="10" required></label>
          <label>Role<select name="role"><option>operator</option><option>driver</option><option>admin</option></select></label><button class="btn primary">Add team member</button></form>`;
      pane.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", act(() => api("PATCH", `/api/staff/team/${s.dataset.role}`, { role: s.value }), "Role updated")));
      pane.querySelector("#ts-require").addEventListener("click", act(() => api("PUT", "/api/staff/team/two-step-required", { on: !who.two_step_required }), who.two_step_required ? "Two-step sign-in is now optional" : "Two-step sign-in is now required"));
      pane.querySelectorAll("[data-ts-reset]").forEach((b) => b.addEventListener("click", act(() => api("POST", `/api/staff/team/${b.dataset.tsReset}/two-step/reset`), "Reset: they'll set it up again")));
      pane.querySelectorAll("[data-active]").forEach((i) => i.addEventListener("change", act(() => api("PATCH", `/api/staff/team/${i.dataset.active}`, { active: i.checked }), "Updated")));
      pane.querySelector("#team-add").addEventListener("submit", act((e) => { e.preventDefault(); return api("POST", "/api/staff/team", Object.fromEntries(new FormData(e.target).entries())); }, "Team member added"));
    }
  }

  /* Profitability: what orders earn, what route days cost, and the settings that move both. */

  async function viewProfit() {
    const c = shell("profit", "Profitability");
    const isAdmin = me.role === "admin";
    const P = await api("GET", "/api/staff/profit");
    const signed = (p) => (p < 0 ? "−" : "") + money(Math.abs(p));
    const a = P.assumptions, L = P.levers, W = P.weeks;
    const recent = W.slice(-4);
    const sum = (k) => recent.reduce((n, w) => n + (w[k] || 0), 0);
    const orders = sum("orders"), valued = sum("valued_orders"), days = sum("route_days"), jobs = sum("jobs");
    const weighted = (k) => valued ? Math.round(recent.reduce((n, w) => n + (w[k] || 0) * w.valued_orders, 0) / valued) : null;
    const tile = (value, label, good, note) => `<div class="stat-tile"><strong class="${value == null ? "" : good ? "ok" : "warn-text"}">${value ?? "–"}</strong><span>${esc(label)}</span>${note ? `<small class="muted">${esc(note)}</small>` : ""}</div>`;
    const perDay = days ? Math.round(jobs / days * 10) / 10 : null;
    const avg = weighted("average_order_pence"), under = weighted("under_free_share"), contrib = weighted("contribution_per_order_pence");
    const afterRoute = sum("after_route_pence");
    const day = (wd) => WEEKDAYS[wd];
    const goodBad = (v, target) => v == null ? "" : v >= target ? "ok" : "warn-text";
    const lever = (label, value, href, note) => `<tr><td>${label}</td><td><strong>${value}</strong></td><td class="small muted">${note}</td><td>${href ? `<a class="link small" href="${href}">Change</a>` : ""}</td></tr>`;

    c.innerHTML = `
      <section class="stack"><h2>Last 4 weeks</h2>
        <div class="stat-tiles">
          ${tile(perDay, "Jobs per route day", perDay != null && perDay >= a.target_jobs_per_day, `target ${a.target_jobs_per_day}+, run a day from ${a.min_jobs_per_day}`)}
          ${tile(avg == null ? null : money(avg), "Average order", avg != null && avg >= a.target_order_pence, `target ${money(a.target_order_pence)}+`)}
          ${tile(under == null ? null : under + "%", `Orders under ${money(L.free_saver_threshold_pence)}`, under != null && under <= 50, "pay the under-threshold charge")}
          ${tile(contrib == null ? null : money(contrib), "Contribution per order", contrib != null && contrib >= a.target_contribution_pence, `target ${money(a.target_contribution_pence)}+, before route costs`)}
          ${tile(orders ? signed(afterRoute) : null, "After route-day costs", afterRoute >= 0, `${days} route day${days === 1 ? "" : "s"} at ${money(a.route_day_pence)}`)}
        </div>
        <p class="small muted">A job is one collection and its return (two stops). Contribution is what an order leaves after cleaning (${100 - a.margin_pct}% of item prices), packaging and card fees; a top-up to the minimum order has no cleaning cost. Orders booked without a list join the averages once they're itemised.</p>
      </section>

      <section class="panel"><h2>Week by week</h2><div class="table-wrap"><table>
        <thead><tr><th>Week of</th><th class="num">Route days</th><th class="num">Jobs</th><th class="num">Jobs / day</th><th class="num">Trip cost / job</th><th class="num">Orders</th><th class="num">Average order</th><th class="num">Under ${money(L.free_saver_threshold_pence)}</th><th class="num">Contribution / order</th><th class="num">After route costs</th><th class="num">After fixed costs</th></tr></thead>
        <tbody>${W.slice().reverse().map((w) => `<tr${w.current ? ' class="muted"' : ""}><td>${D.format(parse(w.week))}${w.current ? " (this week)" : ""}</td>
          <td class="num">${w.route_days}</td><td class="num">${w.jobs}</td>
          <td class="num ${goodBad(w.jobs_per_route_day, a.target_jobs_per_day)}">${w.jobs_per_route_day ?? "–"}</td>
          <td class="num">${w.trip_cost_per_job_pence == null ? "–" : money(w.trip_cost_per_job_pence)}</td>
          <td class="num">${w.orders}</td><td class="num ${goodBad(w.average_order_pence, a.target_order_pence)}">${w.average_order_pence == null ? "–" : money(w.average_order_pence)}</td>
          <td class="num">${w.under_free_share == null ? "–" : w.under_free_share + "%"}</td>
          <td class="num ${goodBad(w.contribution_per_order_pence, a.target_contribution_pence)}">${w.contribution_per_order_pence == null ? "–" : money(w.contribution_per_order_pence)}</td>
          <td class="num">${w.orders || w.route_days ? signed(w.after_route_pence) : "–"}</td><td class="num">${w.orders || w.route_days ? signed(w.after_fixed_pence) : "–"}</td></tr>`).join("")}</tbody>
      </table></div><p class="small muted">Fixed costs are spread evenly: ${money(a.fixed_month_pence)} a month is ${money(Math.round(a.fixed_month_pence * 12 / 52))} a week.</p></section>

      <section class="panel"><h2>Your levers</h2><div class="table-wrap"><table><tbody>
        ${lever("1. Minimum order, home collection", money(L.home_minimum_pence), "#/settings?tab=delivery", "No home order earns less than this covers.")}
        ${lever("2. Minimum order, atelier drop-off", money(L.dropoff_minimum_pence), "#/settings?tab=delivery", "Only the return trip needs covering.")}
        ${lever("3. Charge under the free threshold (non-members)", money(L.nonmember_saver_under_pence), "#/settings?tab=delivery", "Tops up mid-sized orders.")}
        ${lever("4. Free Saver delivery from", money(L.free_saver_threshold_pence), "#/settings?tab=delivery", "About where an order pays its full share.")}
        ${lever("5. One-hour window (non-members)", money(L.nonmember_one_hour_pence), "#/settings?tab=delivery", "Fixed-time stops break up routes, so they're always charged.")}
        ${lever("7. Essence one-hour", money(L.essence_one_hour_pence), "#/settings?tab=delivery", "Saver is free for members; one-hour is included for Elevate and Éclat.")}
        ${lever("12. Item margins", L.items_missing_cost ? `${L.items_missing_cost} items without a cost` : "All costed", isAdmin ? "#/products" : "", `${L.items_below_margin} below ${L.minimum_margin}%. Costs keep the ${a.margin_pct}% margin used here honest.`)}
        ${lever("13. Route days open", L.route_weekdays.length ? L.route_weekdays.map(day).join(", ") : "None", "#/settings?tab=slots", `${L.weekly_home_capacity} home bookings a week at most.`)}
        ${lever("15. Atelier drop-offs", L.dropoff_enabled ? `${L.ateliers_active} active atelier${L.ateliers_active === 1 ? "" : "s"}` : "Switched off", "#/settings?tab=ateliers", "One stop fewer per order.")}
      </tbody></table></div>
        <p class="small muted">Built in, nothing to set: 6. one charge per booking covers both legs · 8. quotes count towards the minimum at their "from" price · 9. booked without a list, we charge up to the minimum at review · 10. review sets the final figures · 11. curated packs can always be booked.</p></section>

      <div class="grid-2">
        <section class="panel"><h2>What one order earns now</h2><div class="table-wrap"><table>
          <thead><tr><th>Order</th><th class="num">Items</th><th class="num">Delivery</th><th class="num">Contribution</th></tr></thead>
          <tbody>${P.examples.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${money(x.items_pence)}</td><td class="num">${x.fee_pence ? money(x.fee_pence) : "Free"}</td><td class="num"><strong>${money(x.contribution_pence)}</strong></td></tr>`).join("")}</tbody>
        </table></div><p class="small muted">Compare with the trip cost of a job, opposite, and the ${money(a.target_contribution_pence)} target that also covers overheads.</p></section>
        <section class="panel"><h2>Trip cost per job</h2><div class="table-wrap"><table>
          <thead><tr><th class="num">Jobs on the day</th><th class="num">Cost per job</th></tr></thead>
          <tbody>${P.trip_costs.map((t) => `<tr><td class="num">${t.jobs}</td><td class="num">${money(t.per_job_pence)}</td></tr>`).join("")}</tbody>
        </table></div><p class="small muted">Driver and charging (${money(a.route_day_pence)} a day) shared across the day's jobs, plus packaging.</p></section>
      </div>

      ${ROUTE_DAY_NOTE}

      <form id="assumptions" class="panel stack"><h2>Cost figures</h2>
        <p class="small muted">Your estimates. Change them as real costs come in; everything on this page follows.</p>
        <div class="form-grid">
          <label>Item margin after cleaning (%)<input name="margin_pct" type="number" min="0" max="100" value="${a.margin_pct}" ${isAdmin ? "" : "disabled"}></label>
          <label>Route day: driver and charging (£)<input name="route_day_pence" data-pence value="${(a.route_day_pence / 100).toFixed(2)}" ${isAdmin ? "" : "disabled"}></label>
          <label>Packaging per order (£)<input name="packaging_pence" data-pence value="${(a.packaging_pence / 100).toFixed(2)}" ${isAdmin ? "" : "disabled"}></label>
          <label>Card fee (%)<input name="card_fee_pct" type="number" step="0.1" min="0" value="${a.card_fee_pct}" ${isAdmin ? "" : "disabled"}></label>
          <label>Card fee per payment (£)<input name="card_fee_fixed_pence" data-pence value="${(a.card_fee_fixed_pence / 100).toFixed(2)}" ${isAdmin ? "" : "disabled"}></label>
          <label>Fixed costs a month, incl. van lease (£)<input name="fixed_month_pence" data-pence value="${(a.fixed_month_pence / 100).toFixed(2)}" ${isAdmin ? "" : "disabled"}></label>
          <label>Target jobs per route day<input name="target_jobs_per_day" type="number" min="1" value="${a.target_jobs_per_day}" ${isAdmin ? "" : "disabled"}></label>
          <label>Fewest jobs to run a day<input name="min_jobs_per_day" type="number" min="1" value="${a.min_jobs_per_day}" ${isAdmin ? "" : "disabled"}></label>
          <label>Target average order (£)<input name="target_order_pence" data-pence value="${(a.target_order_pence / 100).toFixed(2)}" ${isAdmin ? "" : "disabled"}></label>
          <label>Target contribution per order (£)<input name="target_contribution_pence" data-pence value="${(a.target_contribution_pence / 100).toFixed(2)}" ${isAdmin ? "" : "disabled"}></label>
        </div>
        ${isAdmin ? `<div><button class="btn primary">Save figures</button></div>` : ""}
      </form>`;
    c.querySelector("#assumptions").addEventListener("submit", act((e) => {
      e.preventDefault();
      const body = {};
      e.target.querySelectorAll("input").forEach((i) => { body[i.name] = i.dataset.pence !== undefined ? toPence(i.value) : Number(i.value); });
      return api("PUT", "/api/staff/profit/assumptions", body);
    }, "Figures saved"));
  }

  /* Router */

  async function route() {
    if (location.hash.startsWith("#/reset/")) { renderReset(location.hash.slice("#/reset/".length)); return; }
    if (!me) {
      try { me = await api("GET", "/api/staff/me"); } catch (_) { return; }
    }
    const [path, query] = (location.hash.slice(1) || "/today").split("?");
    const params = new URLSearchParams(query || "");
    const parts = path.split("/").filter(Boolean);
    if (me.setup_two_step) {
      app.innerHTML = `<div class="login" style="align-items:flex-start;padding-top:40px"><div id="forced" style="width:100%;max-width:560px"></div></div>`;
      try { await twoStepSetup(document.getElementById("forced"), { forced: true }); } catch (e) { toast(e.message, true); }
      return;
    }
    if (me.role === "driver" && parts[0] !== "today") { location.hash = "#/today"; return; }
    try {
      if (parts[0] === "orders" && parts[1]) await viewOrder(parts[1]);
      else if (parts[0] === "orders") await viewOrders(params);
      else if (parts[0] === "clients" && parts[1]) await viewClient(parts[1]);
      else if (parts[0] === "clients") await viewClients(params);
      else if (parts[0] === "vault") await viewVault(params);
      else if (parts[0] === "shop") await viewShop(params);
      else if (parts[0] === "website" && parts[1] === "content" && parts[2]) await viewContent(parts[2]);
      else if (parts[0] === "website" && parts[1] === "services" && parts[2]) await viewServiceEdit(parts[2]);
      else if (parts[0] === "website" && parts[1] === "products" && parts[2]) await viewProductEdit(parts[2]);
      else if (parts[0] === "website" && parts[1] === "resell" && parts[2]) await viewResellEdit(parts[2]);
      else if (parts[0] === "website") await viewWebsite(params);
      else if (parts[0] === "products") await viewProducts(params);
      else if (parts[0] === "journal" && parts[1]) await viewPost(parts[1]);
      else if (parts[0] === "journal") await viewJournal(params);
      else if (parts[0] === "settings") await viewSettings(params);
      else if (parts[0] === "profit") await viewProfit();
      else await viewToday(params);
    } catch (e) {
      if (e.message === "Signed out") return;
      const c = document.getElementById("content");
      if (c) c.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
