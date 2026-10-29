// Applies the saved theme before first paint to avoid a flash of the wrong theme.
(function () {
  try {
    var theme = localStorage.getItem('lang-map:theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) {
    /* storage unavailable: follow the OS setting */
  }
})();
