// Pre-paint theme application (no-flash). Served as an external file (not inline)
// so a strict CSP `script-src 'self'` allows it with no hash/nonce. Render-blocking
// in <head> on purpose: it sets the `.dark` class + background BEFORE first paint,
// so dark-mode users never see a light flash. Mirrors Narratorr's boot script;
// `src/client/hooks.ts useTheme()` keeps it in sync once React mounts.
(function () {
  try {
    let t = localStorage.getItem('theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.classList.add('dark');
    document.documentElement.style.background = t === 'dark' ? 'hsl(30 8% 7%)' : 'hsl(30 10% 98%)';
  } catch {
    /* localStorage/matchMedia unavailable — fall through to the CSS default theme. */
  }
})();
