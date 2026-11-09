// Site Measure: starts the app. The work is done by the modules in js/ui/.

import * as store from './storage.js';
import { APP_VERSION, els } from './ui/core.js';
import { SITE_MODE_KEY, applyJob, setSiteMode } from './ui/jobs.js';
import { buildCeilingInput, buildLengthInputs, setCustomSide, setSelectedHeading } from './ui/entry.js';
import { history, persist, resetHistory } from './ui/history.js';
import { render } from './ui/view.js';
import './ui/events.js'; // wires up the page

function init() {
  buildLengthInputs();
  setSelectedHeading(null);
  setCustomSide('left');

  const jobs = store.listJobs();
  if (jobs.length > 0) {
    const mostRecent = [...jobs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    const job = store.loadJob(mostRecent.id);
    if (job) {
      applyJob(job);
      buildLengthInputs();
    }
  }

  buildCeilingInput();
  if (!history.last) resetHistory();
  render();

  els.appVersion.textContent = `Site Measure v${APP_VERSION}`;
  try { setSiteMode(localStorage.getItem(SITE_MODE_KEY) === '1'); } catch { /* default look */ }
  registerServiceWorker();
}

// Keep an installed copy up to date: look for a new version on start and
// whenever the app comes back to the front, and reload once when one takes
// over, so changes show without closing the app by hand.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing old to replace
    reloading = true;
    persist();
    location.reload();
  });
  navigator.serviceWorker.register('service-worker.js').then((reg) => {
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

init();
