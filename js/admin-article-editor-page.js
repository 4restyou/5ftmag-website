(function () {
  'use strict';

  // Retire the browser publishing flow and erase tokens left by older versions.
  // Do not read stored tokens, URL draft selectors, or draft HTML on this route.
  for (const storage of ['localStorage', 'sessionStorage']) {
    try { window[storage].removeItem('5ft-gh-pat'); } catch {}
  }
})();
