/* One delegated handler on the nav. A dropdown header toggles its accordion
   only while the mobile menu is open (which only happens on mobile); every
   other link navigates and closes the menu. Delegation survives touch quirks
   that per-element handlers can miss. */
export function initNav() {
  const nav = document.querySelector('.topnav nav');
  const toggle = document.getElementById('menu-toggle');
  if (!nav) return;

  nav.addEventListener('click', (e) => {
    const head = e.target.closest('.dd > .dd-top');
    const menuOpen = toggle && toggle.checked;

    if (head && menuOpen) {
      e.preventDefault();
      const dd = head.parentElement;
      const wasOpen = dd.classList.contains('open');
      nav.querySelectorAll('.dd.open').forEach((o) => o.classList.remove('open'));
      if (!wasOpen) dd.classList.add('open');
      return;
    }

    const link = e.target.closest('a');
    if (link && !link.classList.contains('dd-top') && toggle) {
      toggle.checked = false;
    }
  });
}
