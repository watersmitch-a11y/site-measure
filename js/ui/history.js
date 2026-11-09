// Saving the job, and undo / redo over every saved change.

import * as store from '../storage.js';
import { activeRoom, els, levelOf, state, ui } from './core.js';
import { buildCeilingInput, buildLengthInputs, resetEntryForm } from './entry.js';
import { closeWallPanel } from './walls.js';
import { endMove } from './move.js';
import { render } from './view.js';
import { stopPlacing } from './room-ui.js';

export function saveJob() {
  if (!state.jobId) state.jobId = store.newJobId();
  store.saveJob({
    id: state.jobId,
    name: state.jobName,
    unit: state.unit,
    rooms: state.rooms,
    activeRoomId: state.activeRoomId,
    details: state.details,
    levels: state.levels,
  });
  const t = new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  els.saveState.textContent = `Saved ✓ ${t}`;
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

export function recordHistory() {
  const key = jobSnapshot();
  if (history.last && key === history.last.key) {
    history.last.activeRoomId = state.activeRoomId;
    return;
  }
  if (history.last) {
    history.undo.push(history.last);
    if (history.undo.length > HISTORY_MAX) history.undo.shift();
  }
  history.redo = [];
  history.last = { key, activeRoomId: state.activeRoomId };
  renderUndoButtons();
}

export function persist() {
  saveJob();
  recordHistory();
}

export function renderUndoButtons() {
  els.undoActionBtn.disabled = history.undo.length === 0;
  els.redoActionBtn.disabled = history.redo.length === 0;
}

export function stepHistory(from, to) {
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
