export function initSidebarFilter() {
  const input = document.getElementById('side-filter');
  if (!input) return;
  const nav = input.parentElement.querySelector('nav');
  const links = [...nav.querySelectorAll('li a, summary a')];

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      nav.querySelectorAll('li, details').forEach((el) => { el.style.display = ''; });
      nav.querySelectorAll('details').forEach((d) => { d.open = d.dataset.wasOpen === '1'; });
      return;
    }
    nav.querySelectorAll('details').forEach((d) => {
      if (d.dataset.wasOpen === undefined) d.dataset.wasOpen = d.open ? '1' : '0';
    });
    nav.querySelectorAll('li').forEach((li) => {
      const a = li.querySelector(':scope > a, :scope > details > summary a');
      const hit = a && a.textContent.toLowerCase().includes(q);
      const childHit = [...li.querySelectorAll('a')].some((x) => x.textContent.toLowerCase().includes(q));
      li.style.display = hit || childHit ? '' : 'none';
    });
    nav.querySelectorAll('details').forEach((d) => {
      const anyHit = [...d.querySelectorAll('a')].some((x) => x.textContent.toLowerCase().includes(q));
      d.style.display = anyHit ? '' : 'none';
      if (anyHit) d.open = true;
    });
  });
  void links;
}

/* the docs-hub search jumps to the docs tree filtered; simplest useful
   behaviour is to send the query to the first matching area, but a live
   client-side filter over the visible cards is friendlier on the hub. */
export function initHubSearch() {
  const input = document.getElementById('hub-search');
  if (!input) return;
  const cards = [...document.querySelectorAll('.area-card, .start-card')];
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    cards.forEach((c) => {
      const hit = !q || c.textContent.toLowerCase().includes(q);
      c.style.display = hit ? '' : 'none';
    });
  });
}

export function initScrollspy() {
  const toc = document.querySelector('.doc-toc');
  if (!toc || !('IntersectionObserver' in window)) return;
  const links = [...toc.querySelectorAll('a[href*="#"]')];
  const map = new Map();
  links.forEach((a) => {
    const id = decodeURIComponent(a.hash.slice(1));
    const el = document.getElementById(id);
    if (el) map.set(el, a);
  });
  if (!map.size) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove('on'));
      map.get(e.target).classList.add('on');
    }
  }, { rootMargin: '-80px 0px -72% 0px' });
  map.forEach((_, el) => io.observe(el));
}

export function initCodeCopy() {
  document.querySelectorAll('.doc-body pre, .prose pre, .verify-steps pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || code.textContent.length < 8) return;
    const btn = document.createElement('button');
    btn.className = 'pre-copy';
    btn.type = 'button';
    btn.textContent = 'copy';
    btn.setAttribute('aria-label', 'Copy code');
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
      } catch {
        return;
      }
      btn.textContent = 'copied';
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = 'copy';
        btn.classList.remove('done');
      }, 1400);
    });
    pre.appendChild(btn);
  });
}
