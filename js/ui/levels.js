// Levels (floors): the level bar, switching, adding and renaming.

import * as rm from '../rooms.js';
import { $, levelOf, levelRooms, state, ui } from './core.js';
import { endMove } from './move.js';
import { persist } from './history.js';
import { render } from './view.js';
import { setActiveRoom, stopPlacing } from './room-ui.js';
import { showAlert, showPrompt } from './dialogs.js';

export function renderLevelBar() {
  const sel = $('#levelSelect');
  sel.innerHTML = '';
  state.levels.forEach((name) => {
    const n = levelRooms(name).filter((r) => r.walls.length).length;
    sel.add(new Option(`${name}${n ? ` (${n} room${n > 1 ? 's' : ''})` : ''}`, name, false, name === state.level));
  });
}

export function switchLevel(name) {
  if (ui.moving) endMove(true);
  stopPlacing();
  state.level = name;
  ui.view = null;
  const here = levelRooms();
  if (here.length) {
    setActiveRoom((here.find((r) => r.id === state.activeRoomId) || here[0]).id);
  } else {
    const room = rm.newRoom({ type: 'fixed', x: 0, y: 0, heading: null });
    room.number = rm.nextRoomNumber(state.rooms);
    room.level = name;
    const lastCeiling = [...state.rooms].reverse().find((r) => r.ceilingHeightM);
    room.ceilingHeightM = lastCeiling ? lastCeiling.ceilingHeightM : null;
    state.rooms.push(room);
    setActiveRoom(room.id);
  }
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
