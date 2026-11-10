// The Bluetooth laser button: readings go into the length box in use.

import { setLength } from '../length-input.js';
import * as units from '../units.js';
import * as laser from '../laser.js';
import { $, state, ui } from './core.js';
import { showAlert } from './dialogs.js';

// A reading goes into the length box last used (wall length unless another
// was picked), as if typed.
ui.laserTarget = null;

 // id prefix of the length box last focused
document.addEventListener('focusin', (e) => {
  const input = e.target.closest && e.target.closest('.length-inputs input');
  if (input) ui.laserTarget = input.id.replace(/(Single|Feet|Inches)$/, '');
});

export function laserReading(m) {
  let prefix = ui.laserTarget;
  const exists = prefix && ($(`#${prefix}Single`) || $(`#${prefix}Feet`));
  const visible = exists && exists.offsetParent !== null;
  if (!visible) prefix = 'len';
  setLength(state.unit, prefix, m);
  const box = $(`#${prefix}Single`) || $(`#${prefix}Feet`);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.classList.add('laser-filled');
  setTimeout(() => box.classList.remove('laser-filled'), 900);
  $('#laserBtn').textContent = `📏 ${units.formatLength(m, state.unit)} ✓`;
}

// the laser key on the number pad shows when one's connected
function padKey(on) {
  const key = document.querySelector('#numPad [data-key="laser"]');
  if (key) {
    key.classList.toggle('connected', on);
    key.title = on ? `${ui.laserName} connected` : 'Connect a Bluetooth laser';
  }
}

export async function handleLaserBtn() {
  const btn = $('#laserBtn');
  if (ui.laserName) {
    laser.disconnectLaser();
    return;
  }
  btn.textContent = '📏 Connecting…';
  try {
    ui.laserName = await laser.connectLaser(laserReading, () => {
      ui.laserName = null;
      btn.textContent = '📏 Connect laser';
      btn.classList.remove('connected');
      padKey(false);
    });
    btn.textContent = `📏 ${ui.laserName} connected`;
    btn.classList.add('connected');
    padKey(true);
  } catch (err) {
    btn.textContent = '📏 Connect laser';
    if (err && err.name !== 'NotFoundError') showAlert(`Couldn't connect the laser: ${err.message}`);
  }
}
