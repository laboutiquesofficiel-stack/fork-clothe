// FORK : l'histoire de la marque présentée comme un vrai livre.
// Couverture → pages (2 par 2 sur ordinateur, 1 par 1 sur téléphone) → quatrième de couverture.
// Glisser à gauche/droite ou utiliser les flèches pour tourner les pages ; toucher une page l'agrandit.
(() => {
  const book = document.querySelector("[data-book]");
  if (!book) return;
  const pages = [...book.querySelectorAll(".bk-page")];
  const count = book.querySelector("[data-book-count]");
  const prevBtn = book.querySelector("[data-book-prev]");
  const nextBtn = book.querySelector("[data-book-next]");
  const zoom = document.querySelector("[data-book-zoom]");
  const zoomBody = document.querySelector("[data-book-zoom-body]");
  const wide = window.matchMedia("(min-width: 761px)");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Position : -1 = couverture, 0..n-1 = première page affichée, "back" = dos.
  let pos = -1;
  const step = () => (wide.matches ? 2 : 1);
  const lastStart = () => (wide.matches ? pages.length - 2 : pages.length - 1);

  function render() {
    const state = pos === -1 ? "closed" : pos === "back" ? "back" : "open";
    book.dataset.state = state;
    pages.forEach((p) => p.classList.remove("is-shown", "is-left", "is-right", "is-single"));
    if (state === "open") {
      const shown = pages.slice(pos, pos + step());
      shown.forEach((p, i) => {
        p.classList.add("is-shown");
        if (shown.length === 2) p.classList.add(i === 0 ? "is-left" : "is-right");
        else p.classList.add("is-single");
      });
      const a = pos + 1;
      const b = Math.min(pos + step(), pages.length);
      count.textContent = a === b ? `Page ${a} / ${pages.length}` : `Pages ${a}–${b} / ${pages.length}`;
    } else {
      count.textContent = state === "closed" ? "Couverture" : "Quatrième de couverture";
    }
    prevBtn.disabled = state === "closed";
    nextBtn.disabled = state === "back";
  }

  function open() {
    if (pos !== -1) { pos = 0; render(); return; }
    if (reduce.matches) { pos = 0; render(); return; }
    book.classList.add("is-opening");
    setTimeout(() => { book.classList.remove("is-opening"); pos = 0; render(); }, 450);
  }
  function close() { pos = -1; render(); }
  function showBack() { pos = "back"; render(); }
  function next() {
    if (pos === -1) return open();
    if (pos === "back") return;
    if (pos >= lastStart()) return showBack();
    pos = Math.min(pos + step(), lastStart());
    render();
  }
  function prev() {
    if (pos === -1) return;
    if (pos === "back") { pos = lastStart(); return render(); }
    if (pos <= 0) return close();
    pos = Math.max(pos - step(), 0);
    render();
  }

  book.querySelectorAll("[data-book-open]").forEach((b) => b.addEventListener("click", open));
  book.querySelector("[data-book-close]")?.addEventListener("click", close);
  book.querySelector("[data-book-back]")?.addEventListener("click", showBack);
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);

  // Glisser pour tourner les pages (téléphone)
  let x0 = null;
  book.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  book.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 45) return;
    if (dx < 0) next(); else prev();
  });

  // Clavier : flèches quand le livre a le focus
  book.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  });

  // Agrandir une page
  function openZoom(page) {
    if (!zoom || typeof zoom.showModal !== "function") return;
    zoomBody.innerHTML = page.innerHTML;
    zoom.showModal();
  }
  pages.forEach((p) => {
    p.addEventListener("click", () => openZoom(p));
    p.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openZoom(p); } });
  });
  document.querySelector("[data-book-zoom-close]")?.addEventListener("click", () => zoom.close());
  zoom?.addEventListener("click", (e) => { if (e.target === zoom) zoom.close(); });

  // Passage ordinateur ↔ téléphone : on recale la page affichée
  wide.addEventListener("change", () => {
    if (typeof pos === "number" && pos >= 0) {
      if (wide.matches && pos % 2 === 1) pos -= 1;
      pos = Math.min(pos, lastStart());
    }
    render();
  });

  render();
})();
