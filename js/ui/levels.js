// Levels (floors): the level bar, switching, adding and renaming.

import * as rm from '../rooms.js';
import { $, levelOf, levelRooms, state, ui } from './core.js';
import { endMove } from './move.js';
import { persist } from './history.js';
import { render } from './view.js';
import { setActiveRoom, stopPlacing } from './room-ui.js';
import { showAlert, showConfirm, showPrompt } from './dialogs.js';

export function renderLevelBar() {
  const sel = $('#levelSelect');
  sel.innerHTML = '';
  state.levels.forEach((name) => {
    const n = levelRooms(name).filter((r) => r.walls.length).length;
    sel.add(new Option(`${name}${n ? ` (${n} room${n > 1 ? 's' : ''})` : ''}`, name, false, name === state.level));
  });
  $('#deleteLevelBtn').classList.toggle('hidden', !canDeleteLevel());
  // the level picker only shows once there's more than one level
  sel.classList.toggle('hidden', state.levels.length < 2);
}

// A room made just because a level was opened, and never used.
const blankAuto = (r) => r.auto && !r.walls.length && !r.name && !(r.photos || []).length && !r.details;

export function switchLevel(name) {
  if (ui.moving) endMove(true);
  stopPlacing();
  const left = state.level;
  state.level = name;
  ui.view = null;
  const here = levelRooms();
  if (here.length) {
    setActiveRoom((here.find((r) => r.id === state.activeRoomId) || here[0]).id);
  } else {
    // a level needs a room to draw in; it goes again if left unused
    const room = rm.newRoom({ type: 'fixed', x: 0, y: 0, heading: null });
    room.number = rm.nextRoomNumber(state.rooms);
    room.level = name;
    room.auto = true;
    const lastCeiling = [...state.rooms].reverse().find((r) => r.ceilingHeightM);
    room.ceilingHeightM = lastCeiling ? lastCeiling.ceilingHeightM : null;
    state.rooms.push(room);
    setActiveRoom(room.id);
  }
  // tidy away the unused room on the level just left, freeing its number
  if (left !== name) {
    const before = state.rooms.length;
    state.rooms = state.rooms.filter((r) => !(levelOf(r) === left && blankAuto(r)));
    if (state.rooms.length !== before) {
      persist();
      render();
    }
  }
}

export function canDeleteLevel(name = state.level) {
  return state.levels.length > 1 && !levelRooms(name).some((r) => r.walls.length);
}

// Only an empty level (no walls drawn on it) can be deleted.
export async function handleDeleteLevel() {
  const name = state.level;
  if (!canDeleteLevel(name)) return;
  if (!(await showConfirm(`Delete the level "${name}"? It has no walls drawn.`))) return;
  const gone = new Set(levelRooms(name).map((r) => r.id));
  state.levels = state.levels.filter((l) => l !== name);
  state.level = state.levels[0];
  const stay = levelRooms(state.level);
  if (stay.length) state.activeRoomId = stay[0].id;
  state.rooms = state.rooms.filter((r) => !gone.has(r.id));
  if (!stay.length) {
    switchLevel(state.level);
  } else {
    setActiveRoom(state.activeRoomId);
  }
  persist();
  render();
}

export async function handleAddLevel() {
  const name = await showPrompt('Name of the new level', `Level ${state.levels.length}`);
  if (!name) return;
  if (state.levels.includes(name)) return showAlert(`There's already a level called "${name}".`);
  state.levels.push(name);
  switchLevel(name);
}

export async function handleRenameLevel() {
  const old = state.level;
  const name = await showPrompt('Rename this level', old);
  if (!name || name === old) return;
  if (state.levels.includes(name)) return showAlert(`There's already a level called "${name}".`);
  state.rooms.forEach((r) => { if (levelOf(r) === old) r.level = name; });
  state.levels = state.levels.map((l) => (l === old ? name : l));
  state.level = name;
  persist();
  render();
}
