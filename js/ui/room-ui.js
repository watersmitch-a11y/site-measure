// Rooms: tabs, the room card (details, squareness check, separating), placing new rooms on the plan and deleting rooms.

import * as rm from '../rooms.js';
import * as units from '../units.js';
import { buildLengthInput, readLength, setLength } from '../length-input.js';
import { $, activeLabel, activeRoom, allWalls, els, geometryOf, levelOf, levelRooms, roomIndex, state, ui } from './core.js';
import { END_ARROWS, closeWallPanel, isShapeClosed, planEnds } from './walls.js';
import { anchorDescription, buildCeilingInput, resetEntryForm } from './entry.js';
import { canMove, endMove } from './move.js';
import { persist, saveSoon } from './history.js';
import { render } from './view.js';
import { showInSheet } from './layout.js';
import { renderPhotoStrip } from './photo-ui.js';
import { showAlert, showConfirm } from './dialogs.js';

// Room tabs with each room's floor area; past six rooms, a drop-down list.
export function renderRoomTabs() {
  els.roomTabs.innerHTML = '';
  const geom = rm.roomGeometry(state.rooms);
  const areaOf = (room) => {
    const a = rm.roomClosed(room, geom.get(room.id)) ? rm.roomArea(room, geom.get(room.id)) : null;
    return a != null ? units.formatArea(a, state.unit) : '';
  };
  if (levelRooms().length > 6) {
    const select = document.createElement('select');
    select.className = 'room-select';
    select.setAttribute('aria-label', 'Room');
    levelRooms().forEach((room) => {
      const i = roomIndex(room);
      const opt = document.createElement('option');
      opt.value = room.id;
      opt.textContent = [rm.roomLabel(room, i), areaOf(room)].filter(Boolean).join(' · ');
      opt.selected = room.id === state.activeRoomId;
      select.appendChild(opt);
    });
    els.roomTabs.appendChild(select);
  } else {
    levelRooms().forEach((room) => {
      const i = roomIndex(room);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'room-tab' + (room.id === state.activeRoomId ? ' selected' : '');
      btn.dataset.roomId = room.id;
      btn.textContent = rm.roomLabel(room, i);
      const area = areaOf(room);
      if (area) {
        const small = document.createElement('small');
        small.textContent = area;
        btn.appendChild(small);
      }
      els.roomTabs.appendChild(btn);
    });
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'room-tab add';
  add.dataset.addRoom = '1';
  add.textContent = '+ Room';
  els.roomTabs.appendChild(add);
  // keep the selected room's tab in view (centred where it can be)
  const sel = els.roomTabs.querySelector('.room-tab.selected');
  if (sel) {
    const strip = els.roomTabs.getBoundingClientRect();
    const tab = sel.getBoundingClientRect();
    els.roomTabs.scrollLeft += (tab.left + tab.width / 2) - (strip.left + strip.width / 2);
  }
}

export function renderRoomCard() {
  const room = activeRoom();
  if (document.activeElement !== els.roomName) els.roomName.value = room.name || '';
  els.roomName.placeholder = rm.roomLabel({ ...room, name: '' }, roomIndex(room));
  els.deleteRoomBtn.classList.toggle('hidden', state.rooms.length < 2);
  els.moveRoomBtn.classList.toggle('hidden', !canMove(room) || !!ui.moving);
  const joined = room.walls.length ? rm.joinedRooms(levelRooms(), rm.roomGeometry(levelRooms()), room, true) : [];
  els.separateRoomBtn.classList.toggle('hidden', !joined.length || !!ui.moving);
  renderPhotoStrip(els.roomPhotos, room);
  renderRoomDetails();
  const anchorText = anchorDescription(room);
  els.roomAnchorNote.textContent = anchorText;
  els.roomAnchorNote.classList.toggle('hidden', !anchorText);
}

export function setActiveRoom(id) {
  if (!state.rooms.some((r) => r.id === id)) return;
  if (ui.moving) endMove(true);
  state.activeRoomId = id;
  state.level = levelOf(state.rooms.find((r) => r.id === id));
  ui.insertAt = null;
  closeWallPanel();
  resetEntryForm();
  buildCeilingInput();
  persist();
  render();
}

// Unjoin the room from the rooms it shares or touches walls with, so it can be
// moved on its own; a shared wall becomes a wall of each room.
export async function handleSeparateRoom() {
  const room = activeRoom();
  const geom = rm.roomGeometry(state.rooms);
  const joined = rm.joinedRooms(levelRooms(), geom, room, true);
  if (!joined.length) return;
  if (room.anchor && room.anchor.shared && !rm.roomClosed(room, geom.get(room.id))) {
    await showAlert(`Finish ${activeLabel()}'s walls back to the shared wall first, then separate it.`);
    return;
  }
  const names = joined.map((r) => rm.roomLabel(r, roomIndex(r))).join(', ');
  const ok = await showConfirm(`Separate ${activeLabel()} from ${names}? Each room keeps its own copy of any shared wall, ` +
    'with its doors and windows, and they no longer move together.');
  if (!ok) return;
  rm.separateRoom(state.rooms, room);
  persist();
  render();
}

export const ROOM_DETAIL_FIELDS = { rdFloor: 'floor', rdCeiling: 'ceiling', rdCeilingNotes: 'ceilingNotes', rdWalls: 'walls', rdNotes: 'notes' };

export function renderRoomDetails() {
  const d = activeRoom().details || {};
  Object.entries(ROOM_DETAIL_FIELDS).forEach(([id, key]) => {
    const input = $(`#${id}`);
    if (document.activeElement !== input) input.value = d[key] || '';
  });
}

// Saved as you type (and straight away if the phone locks), as one undo step.
export function saveRoomDetails() {
  const room = activeRoom();
  const d = {};
  Object.entries(ROOM_DETAIL_FIELDS).forEach(([id, key]) => {
    const v = $(`#${id}`).value.trim();
    if (v) d[key] = v;
  });
  saveSoon(`room-details:${room.id}`, () => {
    if (Object.keys(d).length) room.details = d;
    else delete room.details;
  });
}

export async function handleSpreadGap() {
  const room = activeRoom();
  const gap = rm.closingGap(room, geometryOf(room));
  const change = rm.spreadClosingGap(state.rooms, room, false);
  if (change == null) return;
  const ok = await showConfirm(`Share the ${units.formatLength(gap, state.unit)} gap out over all the walls? ` +
    `No wall changes by more than ${units.formatLength(change, state.unit)}, and the corners turn slightly.`);
  if (!ok) return;
  rm.spreadClosingGap(state.rooms, room);
  persist();
  render();
}

export function renderSquareCheck() {
  const room = activeRoom();
  const n = room.walls.length;
  const show = n >= 3 && rm.roomClosed(room, geometryOf(room));
  els.squareCheck.classList.toggle('hidden', !show);
  if (!show) return;
  const names = rm.cornerNames(state.rooms, room);
  const key = names.join('|');
  if (els.squareCheck.dataset.key !== `${room.id}|${key}`) {
    els.squareCheck.dataset.key = `${room.id}|${key}`;
    [els.diagFrom, els.diagTo].forEach((sel, which) => {
      sel.innerHTML = '';
      names.forEach((name, k) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      sel.value = which === 0 ? 0 : Math.min(2, n - 1);
    });
    if (!$('#diagInputs').children.length || els.squareCheck.dataset.unit !== state.unit) {
      buildLengthInput($('#diagInputs'), state.unit, 'diag', 'Measured diagonal');
      els.squareCheck.dataset.unit = state.unit;
    }
    const d = room.diagonal;
    if (d) {
      els.diagFrom.value = d.a;
      els.diagTo.value = d.b;
      setLength(state.unit, 'diag', d.lengthM);
    } else {
      setLength(state.unit, 'diag', null);
    }
    els.diagResult.classList.add('hidden');
    els.diagFixBtn.classList.add('hidden');
  }
}

export function handleDiagCheck() {
  const room = activeRoom();
  const a = Number(els.diagFrom.value);
  const b = Number(els.diagTo.value);
  const measured = readLength(state.unit, 'diag');
  if (a === b || measured == null) {
    els.diagResult.textContent = 'Pick two different corners and enter the measured diagonal.';
    els.diagResult.classList.remove('hidden');
    return;
  }
  const plan = rm.cornerDistance(state.rooms, room, a, b);
  const off = measured - plan;
  const fmt = (m) => units.formatLength(m, state.unit);
  const square = Math.abs(off) <= 0.01;
  els.diagResult.textContent = `Plan ${fmt(plan)} · measured ${fmt(measured)} · ` +
    (square ? 'within 10 mm, the room is as drawn ✓' : `${fmt(Math.abs(off))} ${off > 0 ? 'longer' : 'shorter'} than the plan`);
  els.diagResult.classList.remove('hidden');
  room.diagonal = { a, b, lengthM: measured, planM: plan };
  const fixable = !square && room.walls.length === 4 && Math.abs(a - b) === 2 && !(room.anchor && room.anchor.shared);
  els.diagFixBtn.classList.toggle('hidden', !fixable);
  persist();
}

export function handleDiagFix() {
  const room = activeRoom();
  const d = room.diagonal;
  if (!d) return;
  if (!rm.squareFromDiagonal(state.rooms, room, d.a, d.b, d.lengthM)) {
    els.diagResult.textContent = "Those lengths can't make a four-sided room; check the walls and the diagonal.";
    return;
  }
  room.diagonal.planM = rm.cornerDistance(state.rooms, room, d.a, d.b);
  els.diagResult.textContent = 'Corners adjusted so the plan matches the diagonal ✓';
  els.diagFixBtn.classList.add('hidden');
  persist();
  render();
}

export function startPlacing() {
  if (allWalls().length === 0) {
    // nothing drawn to place against yet
    createRoom({ type: 'fixed', x: 0, y: 0, heading: null });
    return;
  }
  closeWallPanel();
  ui.placingRoom = true;
  els.placeBanner.classList.remove('hidden');
  els.planWrap.classList.add('placing');
  render();
}

export function stopPlacing() {
  ui.placingRoom = false;
  ui.placement = null;
  els.placeBanner.classList.add('hidden');
  els.planWrap.classList.remove('placing');
  els.roomPanel.classList.add('hidden');
}

export function svgPoint(e) {
  const ctm = els.planSvg.getScreenCTM();
  return ctm ? new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()) : null;
}

// A tap on the plan while adding a room: the nearest wall within reach is the
// shared wall, and the side of it tapped is where the new room goes. Open
// space starts a separate room there.
export function placementFromTap(pt) {
  const pointsById = rm.computeRoomPoints(state.rooms);
  const vb = els.planSvg.viewBox.baseVal;
  const reach = Math.max(vb.width, vb.height) * 0.045; // a label's height, as in render.js
  let best = null;
  levelRooms().forEach((room) => {
    const pts = pointsById.get(room.id);
    room.walls.forEach((wall, i) => {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const t = Math.max(0, Math.min(len, (pt.x - a.x) * ux + (pt.y - a.y) * uy));
      const d = Math.hypot(pt.x - (a.x + ux * t), pt.y - (a.y + uy * t));
      if (d <= reach && (!best || d < best.d)) {
        const side = (pt.x - a.x) * -uy + (pt.y - a.y) * ux >= 0 ? 1 : -1;
        best = { d, roomId: room.id, wallId: wall.id, side };
      }
    });
  });
  return best ? { type: 'wall', roomId: best.roomId, wallId: best.wallId, side: best.side } : { type: 'free' };
}

export function handlePlacementTap(e) {
  const pt = svgPoint(e);
  if (!pt) return;
  const placement = placementFromTap(pt);
  if (placement.type === 'free') {
    createRoom({ type: 'fixed', x: Math.round(pt.x * 100) / 100, y: Math.round(pt.y * 100) / 100, heading: null });
    return;
  }
  ui.placement = placement;
  openPlacementSheet();
}

export function placementHost() {
  const p = ui.placement;
  const room = p && state.rooms.find((r) => r.id === p.roomId);
  const wallIdx = room ? room.walls.findIndex((w) => w.id === p.wallId) : -1;
  return wallIdx >= 0 ? { room, wallIdx, wall: room.walls[wallIdx] } : null;
}

// Fill the start and length fields with the shared part of the wall for the
// thickness entered (see rm.sharedWallSpan).
export function fillSharedSpan() {
  const host = placementHost();
  if (!host) return;
  const thick = readLength(state.unit, 'thick', { allowZero: true }) ?? rm.DEFAULT_WALL_THICKNESS_M;
  const pts = rm.computeRoomPoints(state.rooms).get(host.room.id);
  // a shared-wall host's first and last walls meet the shared wall, not each other
  const wrap = isShapeClosed(host.room) && !(host.room.anchor && host.room.anchor.shared);
  const span = rm.sharedWallSpan(pts, host.room.walls, host.wallIdx, ui.placement.side, thick, wrap);
  setLength(state.unit, 'anchorOff', Math.round(span.startM * 1000) / 1000);
  setLength(state.unit, 'sharedLen', Math.round(span.lengthM * 1000) / 1000);
}

export function openPlacementSheet() {
  const host = placementHost();
  if (!host) return;
  const ends = planEnds(host.wallIdx, host.room);
  els.sharedStartLabel.textContent = `${END_ARROWS[ends.start]} Shared part starts this far from the ${ends.start} end`;
  buildLengthInput($('#thicknessInputs'), state.unit, 'thick');
  const placeHost = placementHost();
  setLength(state.unit, 'thick', rm.wallThickness(placeHost && placeHost.wall)); // the shared wall's own thickness
  buildLengthInput($('#anchorOffsetInputs'), state.unit, 'anchorOff');
  buildLengthInput($('#sharedLengthInputs'), state.unit, 'sharedLen');
  ui.placementEdited = false;
  fillSharedSpan();
  els.placeSummary.textContent =
    `The new room shares ${rm.roomLabel(host.room, roomIndex(host.room))} · ` +
    `Wall ${host.wallIdx + 1} (${units.formatLength(host.wall.lengthM, state.unit)}).`;
  els.roomError.classList.add('hidden');
  els.roomPanel.classList.remove('hidden');
  render();
}

// The new room's anchor and shared length as the sheet describes them.
export function placementDraft() {
  const p = ui.placement;
  const host = placementHost();
  if (!host || els.roomPanel.classList.contains('hidden')) return null;
  const offsetM = readLength(state.unit, 'anchorOff', { allowZero: true });
  const lengthM = readLength(state.unit, 'sharedLen');
  const thicknessM = readLength(state.unit, 'thick', { allowZero: true });
  return {
    host,
    offsetM,
    lengthM,
    thicknessM,
    anchor: {
      type: 'wall',
      shared: true,
      roomId: p.roomId,
      wallId: p.wallId,
      offsetM: offsetM ?? 0,
      lengthM: lengthM ?? 0,
      thicknessM: thicknessM ?? rm.DEFAULT_WALL_THICKNESS_M,
      side: p.side,
    },
  };
}

// The shared part of the wall, drawn on the plan while placing; the dot is
// where the new room starts.
export function previewLine() {
  const draft = ui.placement && placementDraft();
  if (!draft || !draft.lengthM) return null;
  const g = rm.roomGeometry([...state.rooms, { id: '__preview', walls: [], anchor: draft.anchor }]).get('__preview');
  return { x1: g.frame.x, y1: g.frame.y, x2: g.target.x, y2: g.target.y };
}

export function closeRoomPanel() {
  els.roomPanel.classList.add('hidden');
  ui.placement = null;
  render();
}

export function showRoomError(message) {
  els.roomError.textContent = message;
  els.roomError.classList.remove('hidden');
}

export function handleCreateRoom() {
  const draft = placementDraft();
  if (!draft) return;
  const { host, offsetM, lengthM, thicknessM } = draft;
  if (thicknessM == null) return showRoomError('Enter the wall thickness.');
  if (offsetM == null) return showRoomError('Enter where the shared part starts (0 for the corner).');
  if (lengthM == null) return showRoomError('Enter the shared length.');
  if (offsetM + lengthM > host.wall.lengthM + 0.001) {
    return showRoomError(`That runs past the end of the wall (${units.formatLength(host.wall.lengthM, state.unit)}).`);
  }
  createRoom(draft.anchor);
}

export function createRoom(anchor, walls = []) {
  stopPlacing();
  const room = rm.newRoom(anchor);
  room.number = rm.nextRoomNumber(state.rooms);
  room.level = state.level;
  room.walls = walls;
  // ceiling heights rarely change through a job: start from the last one set
  const lastCeiling = [...state.rooms].reverse().find((r) => r.ceilingHeightM);
  room.ceilingHeightM = lastCeiling ? lastCeiling.ceilingHeightM : null;
  state.rooms.push(room);
  setActiveRoom(room.id);
  showInSheet(els.entryTitle);
}

export async function handleDeleteRoom() {
  if (state.rooms.length < 2) return;
  const room = activeRoom();
  const ok = await showConfirm(`Delete ${activeLabel()} and all its walls and openings? This cannot be undone.`);
  if (!ok) return;
  rm.pinAttachedRooms(state.rooms, (a) => a.roomId === room.id);
  state.rooms = state.rooms.filter((r) => r.id !== room.id);
  setActiveRoom((levelRooms()[0] || state.rooms[0]).id);
}
