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
    awaiting_collection: "Awaiting collection", collected: "Collected", inspected: "Inspected", in_care: "In care",
    quality_check: "Quality check", ready: "Ready", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled",
  };
  // Mirrors app/services/orders.py TRANSITIONS; the server is the authority.
  const NEXT = {
    awaiting_collection: ["collected", "cancelled"], collected: ["inspected", "cancelled"], inspected: ["in_care"],
    in_care: ["quality_check"], quality_check: ["ready", "in_care"], ready: ["out_for_delivery", "delivered"],
    out_for_delivery: ["delivered", "ready"], delivered: [], cancelled: [],
  };
  const ACTION_LABEL = {
    collected: "Mark collected", inspected: "Mark inspected", in_care: "Start care", quality_check: "Send to quality check",
    ready: "Mark ready", out_for_delivery: "Out for delivery", delivered: "Mark delivered", cancelled: "Cancel order",
  };
  const PIPE = ["awaiting_collection", "collected", "inspected", "in_care", "quality_check", "ready", "out_for_delivery"];

  const pill = (status) => {
    const cls = { delivered: "ok", paid: "ok", completed: "ok", stored: "ok", waived: "ok", cancelled: "err", failed: "err", missed: "err",
      unpaid: "warn", retrieval_requested: "warn", ready: "ink", en_route: "ink", dispatched: "ok", collected: "ok",
      pending_payment: "warn" }[status] || "";
    return `<span class="pill ${cls}">${esc(STATUS_LABEL[status] || human(status))}</span>`;
  };

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
    </form></div>`;
    document.getElementById("login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      try {
        me = (await api("POST", "/api/staff/auth/login", f)).staff;
        route();
      } catch (ex) { const el = e.target.querySelector(".error"); el.textContent = ex.message; el.hidden = false; }
    });
  }

  function shell(active, title, actionsHtml = "") {
    const isOps = me.role !== "driver";
    const links = [["today", "Today"], ...(isOps ? [["orders", "Orders"], ["clients", "Clients"], ["vault", "Vault"], ["shop", "Shop"], ["journal", "Journal"], ["website", "Website"], ["settings", "Settings"]] : [])];
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
    return document.getElementById("content");
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
        <div><div class="time">${T.format(parse(b.starts_at))}–${T.format(parse(b.ends_at))}</div><span class="small muted">${b.window_type === "saver" ? "Saver" : "1 hour"}</span></div>
        <div class="stack" style="gap:2px">
          <strong>${esc(b.client.name)}</strong>
          <span class="small">${b.address ? esc(b.address.one_line) : "At the atelier"}${b.client.phone ? " · " + esc(b.client.phone) : ""}</span>
          ${b.address?.instructions ? `<span class="small muted">${esc(b.address.instructions)}</span>` : ""}
          ${b.notes ? `<span class="small muted">${esc(b.notes)}</span>` : ""}
          ${b.order_id && me.role !== "driver" ? `<a class="small" href="#/orders/${b.order_id}">${esc(b.order_ref)}</a>` : b.order_ref ? `<span class="small">${esc(b.order_ref)}</span>` : ""}
        </div>
        <div class="acts">
          ${pill(b.status)}
          ${b.mode === "lave_collects" && me.role !== "driver" ? `<select data-driver="${b.id}" aria-label="Driver"><option value="">Unassigned</option>${drivers.map((x) => `<option value="${x.id}" ${b.driver?.id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : b.driver ? `<span class="small">${esc(b.driver.name)}</span>` : ""}
          ${["scheduled", "en_route"].includes(b.status) ? `<div class="row">
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
      <div class="cols">
        <section class="panel"><div class="row between"><h2>Collections</h2><span class="muted">${d.collections.length}</span></div>
          ${d.collections.length ? d.collections.map(run).join("") : `<p class="empty">No collections ${day === isoDay(new Date()) ? "today" : "on " + D.format(parse(day))}.</p>`}</section>
        <section class="panel"><div class="row between"><h2>Deliveries</h2><span class="muted">${d.deliveries.length}</span></div>
          ${d.deliveries.length ? d.deliveries.map(run).join("") : `<p class="empty">No deliveries ${day === isoDay(new Date()) ? "today" : "on " + D.format(parse(day))}.</p>`}</section>
      </div>`;
    c.querySelectorAll("[data-bstatus]").forEach((b) => b.addEventListener("click", act(() => api("PATCH", `/api/staff/bookings/${b.dataset.id}`, { status: b.dataset.bstatus }), "Updated")));
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
    const svcOptions = (sel) => `<option value="">No service</option>` + services.filter((s) => s.active || s.id === sel).map((s) => `<option value="${s.id}" data-price="${s.price_pence}" ${s.id === sel ? "selected" : ""}>${esc(s.name)} · ${money(s.price_pence)}</option>`).join("");

    c.innerHTML = `
      <div class="row between">
        <div class="row">${pill(o.status)} ${pill(o.payment_status)} <a href="#/clients/${o.client.id}"><strong>${esc(o.client.name)}</strong></a> <span class="muted small">${esc(o.client.email)}</span></div>
        <div class="row">
          ${NEXT[o.status].map((s) => `<button class="btn ${s === "cancelled" ? "danger" : "primary"}" data-next="${s}">${ACTION_LABEL[s]}</button>`).join("")}
        </div>
      </div>
      ${o.requested_wardrobe?.length ? `<div class="notice"><strong>Sending again from their Wardrobe:</strong> ${o.requested_wardrobe.map((w) => esc(w.title)).join(", ")}</div>` : ""}
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
                <tr><td colspan="5">Slot fees</td><td class="num">${paid ? money(o.fees_pence) : `<input id="fees" value="${(o.fees_pence / 100).toFixed(2)}" size="6" style="text-align:right" aria-label="Fees">`}</td><td></td></tr>
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
            <dl class="kv"><dt>Total</dt><dd><strong>${money(o.total_pence)}</strong></dd><dt>Status</dt><dd>${pill(o.payment_status)}${o.paid_at ? ` <span class="small muted">${DT.format(parse(o.paid_at))}</span>` : ""}</dd>
              <dt>Card</dt><dd>${o.client.has_card_on_file ? "On file" : '<span class="muted">None. Ask the client to add one from their account.</span>'}</dd></dl>
            ${!paid ? `<div class="row">
              <button class="btn primary" id="charge" ${o.items.length && o.client.has_card_on_file ? "" : "disabled"}>Charge ${money(o.total_pence)} to card</button>
              ${me.role === "admin" ? `<button class="btn" data-manual="paid">Record paid in person</button><button class="btn ghost" data-manual="waived">Waive</button>` : ""}
            </div>` : ""}
          </section>
        </div>
        <div class="stack">
          <section class="panel"><h2>Bookings</h2>
            ${o.bookings.length ? o.bookings.map((b) => `<div class="stack" style="gap:2px"><div class="row between"><strong>${b.kind === "collection" ? "Collection" : "Return"}</strong>${pill(b.status)}</div>
              <span class="small">${D.format(parse(b.starts_at))}, ${T.format(parse(b.starts_at))}–${T.format(parse(b.ends_at))} · ${b.mode === "lave_collects" ? "LAVE" : "Atelier counter"}</span>
              ${b.address ? `<span class="small muted">${esc(b.address.one_line)}</span>` : ""}</div>`).join("") : `<p class="muted small">Walk-in order, no bookings.</p>`}
          </section>
          <section class="panel"><h2>Staff notes</h2>
            <textarea id="staff-notes" placeholder="Visible to staff only">${esc(o.staff_notes)}</textarea>
            <button class="btn sm" id="save-notes">Save notes</button></section>
          <section class="panel"><h2>History</h2>
            <ul class="timeline">${o.timeline.slice().reverse().map((e) => `<li><span class="small muted">${DT.format(parse(e.at))}</span><span>${esc(STATUS_LABEL[e.status] || human(e.status))}${e.note ? ` <span class="muted">· ${esc(e.note)}</span>` : ""}</span></li>`).join("")}</ul></section>
        </div>
      </div>
      <div class="tags-print">${o.items.map((i) => `<div><strong>${esc(i.tag_code)}</strong>${esc(o.client.name)}<br>${esc(i.description)}<br>${esc(i.service?.name || "")}</div>`).join("")}</div>`;

    c.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.next === "cancelled") {
        b.outerHTML = `<span class="row"><span class="small">Cancel this order?</span><button class="btn danger" id="confirm-cancel">Yes, cancel</button></span>`;
        c.querySelector("#confirm-cancel").addEventListener("click", act(() => api("POST", `/api/staff/orders/${id}/status`, { status: "cancelled" }), "Order cancelled"));
        return;
      }
      act(() => api("POST", `/api/staff/orders/${id}/status`, { status: b.dataset.next }), STATUS_LABEL[b.dataset.next])();
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
    c.querySelector("#save-notes").addEventListener("click", act(() => api("PATCH", `/api/staff/orders/${id}`, { staff_notes: c.querySelector("#staff-notes").value }), "Notes saved"));
    c.querySelector("#charge")?.addEventListener("click", act(() => api("POST", `/api/staff/orders/${id}/charge`), "Payment taken"));
    c.querySelectorAll("[data-manual]").forEach((b) => b.addEventListener("click", act(() => api("POST", `/api/staff/orders/${id}/payment`, { status: b.dataset.manual }), "Payment recorded")));
    c.querySelector("#print")?.addEventListener("click", () => window.print());
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
    const rows = await api("GET", "/api/staff/clients" + (q ? "?q=" + encodeURIComponent(q) : ""));
    c.querySelector("#list").innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Membership</th><th>Card</th><th>Joined</th></tr></thead>
      <tbody>${rows.map((x) => `<tr class="click" data-href="#/clients/${x.id}"><td><strong>${esc(x.full_name)}</strong></td><td>${esc(x.email)}</td><td>${esc(x.phone)}</td>
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
        <span class="muted small">${x.paid_orders} paid orders</span></div>
        <button class="btn primary" id="walk-in">New walk-in order</button></div>
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
          <section class="panel"><h2>Account</h2><dl class="kv">
            <dt>Card</dt><dd>${x.has_card_on_file ? "On file" : "None"}</dd>
            <dt>Website</dt><dd>${x.wp_user_id ? "Linked (user " + x.wp_user_id + ")" : "Not linked yet"}</dd>
            <dt>Stripe</dt><dd class="small">${esc(x.stripe_customer_id || "–")}</dd></dl></section>
        </div>
      </div>`;
    c.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => { location.hash = tr.dataset.href; }));
    c.querySelector("#client-edit").addEventListener("submit", act((e) => { e.preventDefault(); return api("PATCH", "/api/staff/clients/" + id, Object.fromEntries(new FormData(e.target).entries())); }, "Saved"));
    c.querySelector("#walk-in").addEventListener("click", async () => {
      try { const o = await api("POST", "/api/staff/orders", { client_id: Number(id) }); location.hash = "#/orders/" + o.id; }
      catch (e) { toast(e.message, true); }
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

  const VIEW_ON_SITE = { "home": "/", "page.atelier": "/atelier/", "page.apothecary": "/apothecary/", "page.membership": "/memberships/",
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
    c.innerHTML = `<div class="row">${[["pages", "Pages & menus"], ["services", "Atelier services"], ["products", "Apothecary products"], ["images", "Images"]]
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

  /* Settings */

  async function viewSettings(params) {
    const tab = params.get("tab") || "services";
    const isAdmin = me.role === "admin";
    const c = shell("settings", "Settings");
    const tabs = [["services", "Price list"], ["slots", "Slots"], ["closures", "Closures"], ...(isAdmin ? [["team", "Team"], ["email", "Email"]] : [])];
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
      const groupName = { "lave_collects|hour": "LAVE collects · 1 hour", "lave_collects|saver": "LAVE collects · Saver", "drop_off|hour": "Atelier counter" };
      pane.innerHTML = `<p class="muted">Capacity is how many bookings each window can take. Changes apply to new bookings.</p>
        ${Object.entries(groups).map(([k, list]) => {
          const times = [...new Set(list.map((t) => t.start + "–" + t.end))].sort();
          return `<section class="panel"><h2>${groupName[k] || k}</h2><div class="table-wrap"><table>
            <thead><tr><th>Window</th>${WEEKDAYS.map((d) => `<th>${d}</th>`).join("")}<th class="num">Fee (£)</th></tr></thead>
            <tbody>${times.map((tm) => {
              const cells = WEEKDAYS.map((_, wd) => list.find((t) => t.weekday === wd && t.start + "–" + t.end === tm));
              const any = cells.find(Boolean);
              return `<tr><td class="tag">${tm}</td>${cells.map((t) => `<td>${t ? `<input data-tpl="${t.id}" data-f="capacity" value="${t.active ? t.capacity : 0}" size="2" ${dis} aria-label="Capacity">` : `<span class="muted">–</span>`}</td>`).join("")}
                <td class="num"><input data-tpl-fee="${cells.filter(Boolean).map((t) => t.id).join(",")}" value="${(any.fee_pence / 100).toFixed(2)}" size="5" style="text-align:right" ${dis} aria-label="Fee"></td></tr>`;
            }).join("")}</tbody></table></div></section>`;
        }).join("")}`;
      pane.querySelectorAll("[data-tpl]").forEach((i) => i.addEventListener("change", act(() => {
        const n = Math.max(0, parseInt(i.value, 10) || 0);
        return api("PATCH", `/api/staff/slots/templates/${i.dataset.tpl}`, n ? { capacity: n, active: true } : { active: false });
      }, "Capacity saved")));
      pane.querySelectorAll("[data-tpl-fee]").forEach((i) => i.addEventListener("change", act(() =>
        Promise.all(i.dataset.tplFee.split(",").map((tid) => api("PATCH", `/api/staff/slots/templates/${tid}`, { fee_pence: toPence(i.value) }))), "Fee saved")));
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

    if (tab === "team" && isAdmin) {
      const rows = await api("GET", "/api/staff/team");
      pane.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>${rows.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.email)}</td>
          <td><select data-role="${s.id}" aria-label="Role">${["admin", "operator", "driver"].map((r) => `<option ${s.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
          <td><input type="checkbox" data-active="${s.id}" ${s.active ? "checked" : ""} aria-label="Active"></td></tr>`).join("")}</tbody></table></div>
        <form id="team-add" class="panel form-grid"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label>
          <label>Temporary password<input name="password" type="text" minlength="10" required></label>
          <label>Role<select name="role"><option>operator</option><option>driver</option><option>admin</option></select></label><button class="btn primary">Add team member</button></form>`;
      pane.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", act(() => api("PATCH", `/api/staff/team/${s.dataset.role}`, { role: s.value }), "Role updated")));
      pane.querySelectorAll("[data-active]").forEach((i) => i.addEventListener("change", act(() => api("PATCH", `/api/staff/team/${i.dataset.active}`, { active: i.checked }), "Updated")));
      pane.querySelector("#team-add").addEventListener("submit", act((e) => { e.preventDefault(); return api("POST", "/api/staff/team", Object.fromEntries(new FormData(e.target).entries())); }, "Team member added"));
    }
  }

  /* Router */

  async function route() {
    if (!me) {
      try { me = await api("GET", "/api/staff/me"); } catch (_) { return; }
    }
    const [path, query] = (location.hash.slice(1) || "/today").split("?");
    const params = new URLSearchParams(query || "");
    const parts = path.split("/").filter(Boolean);
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
      else if (parts[0] === "website") await viewWebsite(params);
      else if (parts[0] === "journal" && parts[1]) await viewPost(parts[1]);
      else if (parts[0] === "journal") await viewJournal(params);
      else if (parts[0] === "settings") await viewSettings(params);
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
