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
