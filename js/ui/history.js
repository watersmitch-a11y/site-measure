// Saving the job, and undo / redo over every saved change.

import * as store from '../storage.js';
import { activeRoom, els, levelOf, state, ui } from './core.js';
import { buildCeilingInput, buildLengthInputs, resetEntryForm } from './entry.js';
import { closeWallPanel } from './walls.js';
import { endMove } from './move.js';
import { render } from './view.js';
import { showAlert } from './dialogs.js';
import { stopPlacing } from './room-ui.js';

let warnedFull = false;

// Saves the job on the phone. If the phone's storage is full the save fails:
// say so plainly (once, then in the header) rather than losing work quietly.
export function saveJob() {
  if (!state.jobId) state.jobId = store.newJobId();
  try {
    store.saveJob({
    id: state.jobId,
    name: state.jobName,
    unit: state.unit,
    rooms: state.rooms,
    activeRoomId: state.activeRoomId,
    details: state.details,
    levels: state.levels,
    });
  } catch (err) {
    els.saveState.textContent = '⚠ Not saved – phone storage is full';
    els.saveState.classList.add('save-failed');
    if (!warnedFull) {
      warnedFull = true;
      showAlert("This job couldn't be saved: the phone's storage for this app is full. " +
        'Use Export → Job file to keep a copy now, then delete old jobs (folder button) to make room.');
    }
    return false;
  }
  warnedFull = false;
  els.saveState.classList.remove('save-failed');
  const t = new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  els.saveState.textContent = `Saved ✓ ${t}`;
  return true;
}

// Every saved change is a step that can be undone: the job as it was after
// each save is kept (the last 50), and undo goes back one.
export const history = { undo: [], redo: [], last: null };

export const HISTORY_MAX = 50;

export const jobSnapshot = () => JSON.stringify({
  rooms: state.rooms, jobName: state.jobName, unit: state.unit, details: state.details, levels: state.levels,
});

export function resetHistory() {
  history.undo = [];
  history.redo = [];
  history.last = { key: jobSnapshot(), activeRoomId: state.activeRoomId };
  renderUndoButtons();
}

// group: changes saved under the same group one after another (typing a
// note, say) make a single undo step.
export function recordHistory(group = null) {
  const key = jobSnapshot();
  if (history.last && key === history.last.key) {
    history.last.activeRoomId = state.activeRoomId;
    return;
  }
  if (group && history.last && history.last.group === group && history.undo.length) {
    history.last = { key, activeRoomId: state.activeRoomId, group };
    history.redo = [];
    renderUndoButtons();
    return;
  }
  if (history.last) {
    history.undo.push(history.last);
    if (history.undo.length > HISTORY_MAX) history.undo.shift();
  }
  history.redo = [];
  history.last = { key, activeRoomId: state.activeRoomId, group };
  renderUndoButtons();
}

export function persist(group = null) {
  saveJob();
  recordHistory(group);
}

// Typing in a notes or name box saves shortly after the last key, and at
// once if the app goes into the background (phone locked, app switched).
const pending = new Map(); // group -> { timer, run }
export function saveSoon(group, run, delay = 600) {
  const was = pending.get(group);
  if (was) clearTimeout(was.timer);
  const entry = { run, timer: setTimeout(() => { pending.delete(group); run(); persist(group); }, delay) };
  pending.set(group, entry);
}
export function flushPending() {
  pending.forEach(({ timer, run }, group) => {
    clearTimeout(timer);
    run();
    persist(group);
  });
  pending.clear();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
window.addEventListener('pagehide', flushPending);

export function renderUndoButtons() {
  els.undoActionBtn.disabled = history.undo.length === 0;
  els.redoActionBtn.disabled = history.redo.length === 0;
}

export function stepHistory(from, to) {
  flushPending(); // finish any note being typed first, so it's a step of its own
  if (ui.moving) endMove(false);
  if (!from.length) return;
  const target = from.pop();
  to.push(history.last);
  history.last = target;
  const data = JSON.parse(target.key);
  state.rooms = data.rooms;
  state.jobName = data.jobName;
  state.unit = data.unit;
  state.details = data.details || {};
  state.levels = data.levels || ['Ground floor'];
  state.activeRoomId = state.rooms.some((r) => r.id === target.activeRoomId) ? target.activeRoomId : state.rooms[0].id;
  stopPlacing();
  closeWallPanel();
  ui.insertAt = null;
  ui.insertRest = null;
  resetEntryForm();
  buildLengthInputs();
  buildCeilingInput();
  state.level = levelOf(activeRoom());
  saveJob();
  renderUndoButtons();
  render();
}

export const undo = () => stepHistory(history.undo, history.redo);

export const redo = () => stepHistory(history.redo, history.undo);
