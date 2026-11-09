// Site Measure: starts the app. The work is done by the modules in js/ui/.

import * as store from './storage.js';
import { $, APP_VERSION, els } from './ui/core.js';
import { SITE_MODE_KEY, applyJob, setSiteMode } from './ui/jobs.js';
import { buildCeilingInput, buildLengthInputs, setCustomSide, setSelectedHeading } from './ui/entry.js';
import { flushPending, history, persist, resetHistory } from './ui/history.js';
import { render } from './ui/view.js';
import { cleanUpPhotos } from './ui/photo-ui.js';
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
  cleanUpPhotos(); // in the background: tidies photos left by deleted jobs

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

// Details → Check for updates: fetch the newest version now, rather than
// waiting for the phone to check by itself. The page reloads when it lands.
async function checkForUpdates() {
  const status = $('#updateStatus');
  const say = (text) => { status.textContent = text; status.classList.remove('hidden'); };
  if (!('serviceWorker' in navigator)) return location.reload();
  say('Checking…');
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return location.reload();
    await reg.update();
    const incoming = reg.installing || reg.waiting;
    if (!incoming) {
      say(`You have the latest version (v${APP_VERSION}).`);
      return;
    }
    say('Downloading the new version… the app will restart in a moment.');
    flushPending();
    persist();
    // it takes over and the page reloads (see registerServiceWorker); just in case:
    setTimeout(() => location.reload(), 10000);
  } catch {
    say("Couldn't check: no internet connection? Try again when you have signal.");
  }
}

$('#versionText').textContent = `Version ${APP_VERSION}`;
$('#checkUpdateBtn').addEventListener('click', checkForUpdates);

init();
