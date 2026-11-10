// The screen's layout: the bottom sheet and its three heights, the number pad
// for wall lengths, and the menu.

import { $, els, state, ui } from './core.js';
import { drawPlan } from './view.js';

const SIZES = ['low', 'half', 'full'];
const PAD_OFF_KEY = 'siteMeasure.padOff';

ui.sheetSize = 'low';
ui.padTarget = null; // id of the wall length box the pad types into (feet or inches)

// ---------- the sheet ----------

export function setSheetSize(size) {
  ui.sheetSize = size;
  $('#sheet').dataset.size = size;
  measurePeek();
}

function stepSheet(dir) {
  const i = SIZES.indexOf(ui.sheetSize);
  setSheetSize(SIZES[Math.min(Math.max(i + dir, 0), SIZES.length - 1)]);
}

// At its lowest the sheet shows just the wall entry (or the move controls).
function measurePeek() {
  const sheet = $('#sheet');
  const target = ui.moving ? $('#moveBar') : els.entryCard || $('#entryCard');
  if (!target) return;
  const h = target.offsetHeight;
  if (h > 0) sheet.style.setProperty('--peek', `${h + 6}px`);
}

// Bring something in the sheet into view, scrolling only the sheet.
export function showInSheet(el) {
  const scroller = $('#sheetScroll');
  if (!el || !scroller.contains(el)) return;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(top - 4, 0), behavior: 'smooth' });
}

// ---------- the number pad ----------

const padOff = () => document.body.classList.contains('pad-off');

function lengthBoxes() {
  return [...$('#lengthInputs').querySelectorAll('input')];
}

// The wall length boxes don't call up the phone keyboard while the pad's on.
function applyPadMode() {
  const mode = padOff() ? 'decimal' : 'none';
  lengthBoxes().forEach((input) => {
    input.inputMode = mode;
    input.dataset.mode = mode;
  });
}

function padTarget() {
  const boxes = lengthBoxes();
  return boxes.find((b) => b.id === ui.padTarget) || boxes[0] || null;
}

function typeKey(key) {
  if (key === 'kb') {
    const off = !padOff();
    document.body.classList.toggle('pad-off', off);
    try { localStorage.setItem(PAD_OFF_KEY, off ? '1' : ''); } catch { /* not kept */ }
    applyPadMode();
    const box = padTarget();
    if (off && box) {
      box.blur();
      box.focus(); // brings up the phone's keyboard
    }
    measurePeek();
    return;
  }
  if (key === 'laser') {
    $('#laserBtn').click();
    return;
  }
  const box = padTarget();
  if (!box) return;
  const focused = document.activeElement === box;
  const start = focused ? box.selectionStart : box.value.length;
  const end = focused ? box.selectionEnd : box.value.length;
  if (key === 'back') {
    if (start !== end) box.setRangeText('', start, end, 'end');
    else if (start > 0) box.setRangeText('', start - 1, start, 'end');
  } else {
    box.setRangeText(key, start, end, 'end');
  }
  box.dispatchEvent(new Event('input', { bubbles: true }));
  if (navigator.vibrate) navigator.vibrate(8);
}

// ---------- keeping it in step with the rest of the screen ----------

// After each render: which mode the screen's in, and how tall the sheet's peek is.
export function updateLayout() {
  const formShown = !els.wallForm.classList.contains('hidden');
  document.body.classList.toggle('entering', formShown && !ui.moving);
  document.body.classList.toggle('moving-room', !!ui.moving);
  applyPadMode();
  const laserKey = $('#numPad [data-key="laser"]');
  laserKey.disabled = $('#laserBtn').classList.contains('hidden');
  measurePeek();
}

export function initLayout() {
  try { document.body.classList.toggle('pad-off', localStorage.getItem(PAD_OFF_KEY) === '1'); } catch { /* default: pad on */ }

  // the handle: tap to step the sheet up (and back down from the top); drag it
  const handle = $('#sheetHandle');
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, moved: false };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (drag && Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
  });
  handle.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (drag.moved && Math.abs(dy) > 30) stepSheet(dy < 0 ? 1 : -1);
    else stepSheet(ui.sheetSize === 'full' ? -2 : 1);
    drag = null;
  });
  handle.addEventListener('pointercancel', () => { drag = null; });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stepSheet(ui.sheetSize === 'full' ? -2 : 1); }
  });

  // the pad keeps focus where it is, and types into the wall length box
  const pad = $('#numPad');
  pad.addEventListener('pointerdown', (e) => { if (e.target.closest('.pad-key')) e.preventDefault(); });
  pad.addEventListener('click', (e) => {
    const key = e.target.closest('.pad-key');
    if (key && !key.disabled) typeKey(key.dataset.key);
  });
  $('#lengthInputs').addEventListener('focusin', (e) => { if (e.target.id) ui.padTarget = e.target.id; });

  // typing in any other box uses the phone's keyboard, so the pad steps aside
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    const textish = t.matches && t.matches('input:not([type=checkbox]):not([type=file]), textarea');
    document.body.classList.toggle('typing', !!textish && !t.closest('#lengthInputs'));
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const t = document.activeElement;
      const textish = t && t.matches && t.matches('input:not([type=checkbox]):not([type=file]), textarea');
      document.body.classList.toggle('typing', !!textish && !t.closest('#lengthInputs'));
    }, 0);
  });

  // the menu
  const menu = $('#menuPanel');
  const closeMenu = () => menu.classList.add('hidden');
  $('#menuBtn').addEventListener('click', () => menu.classList.remove('hidden'));
  menu.addEventListener('click', (e) => {
    if (e.target === menu || e.target.closest('button.menu-item')) closeMenu();
  });
  els.unitSelect.addEventListener('change', closeMenu);

  // stats over the plan: tap for the full set
  els.statsBar.addEventListener('click', () => els.statsBar.classList.toggle('expanded'));

  // the plan box changes shape as the sheet moves: redraw to fill it
  let frame = null;
  new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = null; drawPlan(); });
  }).observe(els.planSvg);
  // the peek follows the entry card as its contents change
  new ResizeObserver(() => { if (ui.sheetSize === 'low') measurePeek(); })
    .observe($('#entryCard'));
  new ResizeObserver(() => { if (ui.sheetSize === 'low') measurePeek(); })
    .observe($('#moveBar'));
  void state;
}
