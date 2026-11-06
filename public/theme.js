/* Open NPV — AGPL-3.0-only. Runs before first paint to avoid a theme flash. */
(function () {
  var theme = 'dark';
  try {
    var stored = localStorage.getItem('open-npv-theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
  } catch (error) { /* Storage may be blocked; fall back to dark. */ }
  document.documentElement.dataset.theme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f7fa' : '#0d151d');
})();
