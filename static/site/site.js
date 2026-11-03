// Mega menus (hover, keyboard, touch) and the mobile drawer. Everything works without JS except the drawer toggle.
(() => {
  const megas = [...document.querySelectorAll("[data-mega]")];
  const closeAll = (except) => megas.forEach((m) => {
    if (m !== except) { m.classList.remove("open"); m.querySelector(":scope > a").setAttribute("aria-expanded", "false"); }
  });

  megas.forEach((li) => {
    const link = li.querySelector(":scope > a");
    // Touch: first tap opens the menu, second tap follows the link.
    link.addEventListener("click", (e) => {
      if (matchMedia("(hover: hover)").matches || li.classList.contains("open") || innerWidth <= 980) return;
      e.preventDefault();
      closeAll(li);
      li.classList.add("open");
      link.setAttribute("aria-expanded", "true");
    });
    li.addEventListener("mouseenter", () => link.setAttribute("aria-expanded", "true"));
    li.addEventListener("mouseleave", () => { li.classList.remove("open"); link.setAttribute("aria-expanded", "false"); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeAll();
    const t = document.querySelector("[data-menu-toggle][aria-expanded='true']");
    if (t) { t.click(); t.focus(); } else { document.activeElement?.blur(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("[data-mega]")) closeAll(); });

  const toggle = document.querySelector("[data-menu-toggle]");
  const drawer = document.querySelector("[data-drawer]");
  const header = document.querySelector("[data-header]");
  if (toggle && drawer) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      const bar = header.querySelector(".bar");
      drawer.style.setProperty("--drawer-top", (bar ? bar.getBoundingClientRect().bottom : 0) + "px");
      document.body.classList.toggle("drawer-open", open);
      drawer.hidden = !open;
      document.body.style.overflow = open ? "hidden" : "";
    });
  }
})();

// Prices and packs: add to the list without leaving the page, and search the price list as you type.
(() => {
  const fmt = (p) => "£" + (p % 100 === 0 ? (p / 100).toLocaleString("en-GB") : (p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 }));
  document.querySelectorAll("form[data-add]").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const res = await fetch(form.getAttribute("action"), { method: "POST", body: new FormData(form), headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      btn.classList.add("added");
      btn.querySelector(".add-text").textContent = `${data.qty} in list`;
      document.querySelectorAll("[data-list-count]").forEach((el) => { el.textContent = data.count; });
      document.querySelectorAll("[data-list-estimate]").forEach((el) => { el.textContent = fmt(data.estimate_pence); });
      document.querySelectorAll("[data-list-bar], [data-list-link]").forEach((el) => { el.hidden = !data.count; });
    } catch (_) { form.submit(); }
    btn.disabled = false;
  }));

  const search = document.querySelector("[data-price-search]");
  if (search) {
    const rows = [...document.querySelectorAll(".price-row")];
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      rows.forEach((r) => { r.hidden = q && !r.dataset.name.includes(q); });
      document.querySelectorAll("[data-cat]").forEach((c) => { c.hidden = !c.querySelector(".price-row:not([hidden])"); });
      document.querySelectorAll("[data-dept]").forEach((d) => { d.hidden = !d.querySelector("[data-cat]:not([hidden])"); });
      document.querySelector("[data-price-empty]").hidden = !!document.querySelector(".price-row:not([hidden])");
    });
  }
})();

// Keep sticky bars just under the header, whatever its height (it grows when a section's sub-menu shows).
(() => {
  const header = document.querySelector("[data-header]");
  if (!header || !document.querySelector("[data-price-tools]")) return;
  const set = () => {
    const pinned = ["sticky", "fixed"].includes(getComputedStyle(header).position);
    document.documentElement.style.setProperty("--sticky-top", (pinned ? header.offsetHeight : 0) + "px");
  };
  set();
  addEventListener("resize", set);
})();

// Newsletter box: appears after 20 seconds or halfway down the page, never on arrival. Closing it hides it for 30 days,
// joining for a year (remembered in this browser only; see the cookie notice).
(() => {
  const box = document.querySelector("[data-signup]");
  if (!box) return;
  const KEY = "lave_signup";
  const DAY = 864e5;
  const quietUntil = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch (_) { return 0; } };
  const quiet = (days) => { try { localStorage.setItem(KEY, String(Date.now() + days * DAY)); } catch (_) { /* private mode */ } };
  if (quietUntil() > Date.now()) return;

  let timer;
  const show = () => {
    if (!box.hidden) return;
    clearTimeout(timer);
    removeEventListener("scroll", onScroll);
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add("in"));
  };
  const onScroll = () => {
    const page = document.documentElement.scrollHeight - innerHeight;
    if (page > 0 && scrollY / page >= 0.5) show();
  };
  timer = setTimeout(show, 20000);
  addEventListener("scroll", onScroll, { passive: true });

  const close = () => {
    quiet(box.classList.contains("done") ? 365 : 30);
    box.classList.remove("in");
    setTimeout(() => { box.hidden = true; }, 350);
  };
  box.querySelector("[data-signup-close]").addEventListener("click", close);
  box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });

  const form = box.querySelector("[data-signup-form]");
  const msg = box.querySelector("[data-signup-msg]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    msg.className = "signup-msg";
    msg.textContent = "";
    if (!form.email.checkValidity()) { msg.classList.add("err"); msg.textContent = "Please enter a valid email address."; form.email.focus(); return; }
    btn.disabled = true;
    try {
      const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Something went wrong. Please try again.");
      box.classList.add("done");
      msg.textContent = data.confirm ? form.dataset.thanks : "Thank you. You're on the list.";
      quiet(365);
    } catch (err) {
      msg.classList.add("err");
      msg.textContent = err.message;
    }
    btn.disabled = false;
  });
})();
