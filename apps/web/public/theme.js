// Run synchronously before styles/React to preserve the selected appearance.
(() => {
  let preference = 'dark';
  try {
    const stored = localStorage.getItem('orbit.theme.v1');
    if (['dark', 'light', 'system'].includes(stored)) preference = stored;
  } catch {
    // Storage may be disabled. The default remains usable.
  }
  document.documentElement.dataset.theme =
    preference === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
})();
