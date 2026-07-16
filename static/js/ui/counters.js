function run(el) {
  const raw = el.getAttribute('data-count');
  if (!/^[0-9]+$/.test(raw)) return;
  const end = parseInt(raw, 10);
  let t0 = null;

  function step(ts) {
    if (!t0) t0 = ts;
    const p = Math.min((ts - t0) / 900, 1);
    el.textContent = Math.round(end * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function initCounters(reduced) {
  if (reduced) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        run(e.target);
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.6 });
  document.querySelectorAll('[data-count]').forEach((el) => io.observe(el));
}
