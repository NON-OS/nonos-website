export function initCopy() {
  document.querySelectorAll('button.copy[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
      } catch {
        return;
      }
      const prev = btn.textContent;
      btn.textContent = 'copied';
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove('done');
      }, 1400);
    });
  });
}
