// Moving rooms (with the rooms joined to them): nudging, turning, exact gap and offset, lining up doorways.

import * as rm from '../rooms.js';
import { buildLengthInput, readLength, setLength } from '../length-input.js';
import * as op from '../openings.js';
import * as units from '../units.js';
import { $, activeLabel, activeRoom, allWalls, els, geometryOf, levelRooms, normalizeAngle180, roomIndex, round3, state, ui } from './core.js';
import { closeWallPanel, planEnds, roomSide } from './walls.js';
import { persist } from './history.js';
import { render } from './view.js';
import { showInSheet } from './layout.js';

// A room can be dragged, nudged and turned, or lined up with another room by
// a doorway measured in both. Rooms joined to it (by a shared wall, or walls
// touching) move with it as one group; Separate in the room card unjoins it.
export function canMove(room) {
  return room.walls.length > 0;
}

export function startMove() {
  const room = activeRoom();
  if (!canMove(room)) return;
  closeWallPanel();
  const geom = rm.roomGeometry(state.rooms);
  const group = rm.joinedRooms(levelRooms(), geom, room);
  const roots = rm.groupRoots(group);
  ui.moving = {
    roomId: room.id,
    groupIds: group.map((r) => r.id),
    rootIds: roots.map((r) => r.id),
    before: JSON.stringify(roots.map((r) => ({ id: r.id, anchor: r.anchor, first: r.walls[0] ? r.walls[0].angle : null }))),
  };
  // the rooms holding the group's position become free-standing at where they are
  roots.forEach((r) => {
    if (!r.anchor || r.anchor.type !== 'fixed') {
      const f = geom.get(r.id).frame;
      r.anchor = { type: 'fixed', x: f.x, y: f.y, heading: f.heading };
    }
  });
  const others = group.filter((r) => r !== room).map((r) => rm.roomLabel(r, roomIndex(r)));
  els.moveTitle.textContent = others.length
    ? `Moving ${activeLabel()} with ${others.join(', ')} (joined): drag, or nudge`
    : `Moving ${activeLabel()}: drag it on the plan, or nudge it`;
  els.moveBar.classList.remove('hidden');
  els.planWrap.classList.add('moving');
  render();
  showInSheet(els.moveBar);
}

export function endMove(keep) {
  const moving = ui.moving;
  if (!moving) return;
  if (!keep) {
    JSON.parse(moving.before).forEach((b) => {
      const r = state.rooms.find((x) => x.id === b.id);
      if (!r) return;
      r.anchor = b.anchor;
      if (r.walls[0] && b.first != null) r.walls[0].angle = b.first;
    });
  }
  ui.moving = null;
  els.moveBar.classList.add('hidden');
  els.planWrap.classList.remove('placing', 'moving');
  els.doorMatchPanel.classList.add('hidden');
  persist();
  render();
}

// The gap and along-the-wall offset to the nearest facing wall of another
// room, shown as editable figures while moving. Typing a figure moves the room
// to it. The offset runs from the top (or left) end of the other room's wall
// to the same end of this room's wall.
export function updateMoveDims() {
  const room = movingRoom();
  if (!room) return;
  const ref = rm.nearestFacingWall(levelRooms(), rm.roomGeometry(levelRooms()), ui.moving.groupIds);
  ui.moving.ref = null;
  if (ui.moving.dimsUnit !== state.unit) {
    buildLengthInput(els.moveGapInputs, state.unit, 'mvGap');
    buildLengthInput(els.moveAlongInputs, state.unit, 'mvAlong');
    ui.moving.dimsUnit = state.unit;
  }
  // the fields stay in place (greyed out) when there's no room nearby, so the
  // bar keeps its height and the plan doesn't jump while dragging
  [els.moveGapInputs, els.moveAlongInputs].forEach((box) => {
    box.querySelectorAll('input, button').forEach((c) => { c.disabled = !ref; });
  });
  if (!ref) {
    els.moveDimsRef.textContent = 'Bring it near another room to set an exact gap and offset';
    els.moveAlongEnd.disabled = true;
    setLength(state.unit, 'mvGap', null);
    setLength(state.unit, 'mvAlong', null);
    return;
  }
  // The offset runs between the same ends of the two walls: left or right
  // (top or bottom for upright walls), as picked in the dropdown, and is
  // positive towards the other end.
  const ends = planEnds(ref.otherIdx, ref.other); // first = the left/top end
  const firstName = ends[ends.first];
  const secondName = { left: 'right', top: 'bottom' }[firstName];
  const towards = { left: 'right', right: 'left', top: 'down', bottom: 'up' };
  const opts = els.moveAlongEnd.options;
  opts[0].textContent = `Offset from ${firstName} (+ ${towards[firstName]})`;
  opts[1].textContent = `Offset from ${secondName} (+ ${towards[secondName]})`;
  els.moveAlongEnd.disabled = false;
  const endName = els.moveAlongEnd.value === 'second' ? secondName : firstName;
  // measured from the host wall's start end, or back from its far end
  const fromWallStart = (els.moveAlongEnd.value === 'first') === (ends.first === 'start');
  ui.moving.ref = {
    n: ref.n,
    dir: fromWallStart ? ref.u : { x: -ref.u.x, y: -ref.u.y },
    gap: ref.gap,
    along: fromWallStart ? ref.lo : ref.len - ref.hi,
  };
  const otherName = rm.roomLabel(ref.other, roomIndex(ref.other));
  els.moveDimsRef.textContent =
    `To ${otherName}'s ${roomSide(ref.otherIdx, ref.other)} wall · offset between the ${endName} ends`;
  // don't overwrite a figure while it's being typed
  if (!els.moveGapInputs.contains(document.activeElement)) setLength(state.unit, 'mvGap', round3(ui.moving.ref.gap));
  if (!els.moveAlongInputs.contains(document.activeElement)) setLength(state.unit, 'mvAlong', round3(ui.moving.ref.along));
}

export function applyMoveDim(which) {
  const room = movingRoom();
  const ref = ui.moving && ui.moving.ref;
  if (!room || !ref) return;
  const opts = { allowZero: true, allowNegative: true };
  const value = readLength(state.unit, which === 'gap' ? 'mvGap' : 'mvAlong', opts);
  if (value == null) return;
  const [dir, now] = which === 'gap' ? [ref.n, ref.gap] : [ref.dir, ref.along];
  shiftGroup(dir.x * (value - now), dir.y * (value - now));
  render();
}

export function movingRoom() {
  return ui.moving && state.rooms.find((r) => r.id === ui.moving.roomId);
}

 // to the millimetre
export function shiftRoom(room, dx, dy) {
  room.anchor.x = round3(room.anchor.x + dx);
  room.anchor.y = round3(room.anchor.y + dy);
}

// The rooms that hold the moving group's position; the rest hang off them.
export function movingRoots() {
  if (!ui.moving) return [];
  return ui.moving.rootIds.map((id) => state.rooms.find((r) => r.id === id)).filter(Boolean);
}

export function movingGroup() {
  if (!ui.moving) return [];
  return ui.moving.groupIds.map((id) => state.rooms.find((r) => r.id === id)).filter(Boolean);
}

export function shiftGroup(dx, dy) {
  movingRoots().forEach((r) => shiftRoom(r, dx, dy));
}

// Turn the whole group by deg (clockwise on the plan) about the point c.
export function turnGroup(deg, c) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  movingRoots().forEach((r) => {
    const x = r.anchor.x - c.x;
    const y = r.anchor.y - c.y;
    r.anchor.x = round3(c.x + x * cos - y * sin);
    r.anchor.y = round3(c.y + x * sin + y * cos);
    turnRoom(r, deg);
  });
}

export function groupCentre() {
  const pts = movingGroup().flatMap((r) => geometryOf(r).points);
  return {
    x: pts.reduce((sum, p) => sum + p.x, 0) / (pts.length || 1),
    y: pts.reduce((sum, p) => sum + p.y, 0) / (pts.length || 1),
  };
}

// Turn a room by deg (clockwise on the plan) about its start point.
export function turnRoom(room, deg) {
  const norm = (a) => ((a % 360) + 360) % 360;
  if (room.anchor.heading != null || !room.walls[0]) room.anchor.heading = norm((room.anchor.heading || 0) + deg);
  else room.walls[0].angle = norm(room.walls[0].angle + deg);
}

// The rotate buttons turn the room about its middle so it stays in view.
export function rotateMoving(deg) {
  if (!movingRoom()) return;
  const before = groupCentre();
  turnGroup(deg, before);
  const after = groupCentre();
  shiftGroup(before.x - after.x, before.y - after.y);
  render();
}

// Doorways (doors and plain openings) on a room's walls.
export function doorwaysOf(room) {
  const tags = op.openingTags(allWalls());
  return room.walls.flatMap((wall, wallIdx) => (wall.openings || [])
    .filter((o) => o.type === 'door' || o.type === 'opening')
    .map((o) => ({ room, wall, wallIdx, opening: o, tag: tags[o.id] })));
}

export function doorwayLabel(d, withRoom) {
  const where = `${roomSide(d.wallIdx, d.room)} wall`;
  const room = withRoom ? `${rm.roomLabel(d.room, roomIndex(d.room))} · ` : '';
  return `${room}${d.tag} ${op.OPENING_TYPES[d.opening.type].label.toLowerCase()} ` +
    `${units.formatLength(d.opening.widthM, state.unit)}, ${where}`;
}

export function openDoorMatch() {
  const room = movingRoom();
  if (!room) return;
  const group = movingGroup();
  const here = group.flatMap(doorwaysOf);
  const there = levelRooms().filter((r) => !group.includes(r)).flatMap(doorwaysOf);
  const fill = (select, list, withRoom) => {
    select.innerHTML = '';
    list.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.opening.id;
      opt.textContent = doorwayLabel(d, withRoom);
      select.appendChild(opt);
    });
  };
  fill(els.doorHereSelect, here, group.length > 1);
  fill(els.doorThereSelect, there, true);
  buildLengthInput($('#doorThicknessInputs'), state.unit, 'doorThick');
  setLength(state.unit, 'doorThick', rm.DEFAULT_WALL_THICKNESS_M);
  const missing = !here.length
    ? `Add the doorway to ${activeLabel()} first (tap the wall it's in).`
    : !there.length ? 'Add the doorway to the other room first, as measured from that side.' : '';
  els.doorMatchError.textContent = missing;
  els.doorMatchError.classList.toggle('hidden', !missing);
  els.applyDoorMatchBtn.disabled = !!missing;
  els.doorMatchPanel.classList.remove('hidden');
}

export function findDoorway(openingId) {
  return state.rooms.flatMap(doorwaysOf).find((d) => d.opening.id === openingId) || null;
}

// Outward normal of a room's wall, and the middle of a doorway in it.
export function outwardNormal(room, wallIdx) {
  const pts = geometryOf(room).points;
  const dx = pts[wallIdx + 1].x - pts[wallIdx].x;
  const dy = pts[wallIdx + 1].y - pts[wallIdx].y;
  const len = Math.hypot(dx, dy) || 1;
  const out = -rm.insideSign(pts);
  return { x: (-dy / len) * out, y: (dx / len) * out };
}

export function doorwayCentre(d) {
  const pts = geometryOf(d.room).points;
  const a = pts[d.wallIdx];
  const b = pts[d.wallIdx + 1];
  const span = op.openingSpan(d.wall, d.opening);
  const t = (span.startM + span.endM) / 2 / (d.wall.lengthM || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function handleDoorMatch() {
  const room = movingRoom();
  const here = findDoorway(els.doorHereSelect.value);
  const there = findDoorway(els.doorThereSelect.value);
  const thick = readLength(state.unit, 'doorThick', { allowZero: true });
  if (!room || !here || !there) return;
  if (thick == null) {
    els.doorMatchError.textContent = 'Enter the wall thickness.';
    els.doorMatchError.classList.remove('hidden');
    return;
  }
  // 1. turn this room so its wall faces the other room's wall
  const headingOf = (v) => (Math.atan2(v.x, -v.y) * 180) / Math.PI;
  const nHere = outwardNormal(here.room, here.wallIdx);
  const nThere = outwardNormal(there.room, there.wallIdx);
  const turn = normalizeAngle180(headingOf({ x: -nThere.x, y: -nThere.y }) - headingOf(nHere));
  if (Math.abs(turn) > 0.01) turnGroup(Math.round(turn * 100) / 100, groupCentre());
  // 2. slide it so the doorways line up, the wall thickness apart
  const from = doorwayCentre(findDoorway(here.opening.id));
  const to = doorwayCentre(there);
  shiftGroup(to.x + nThere.x * thick - from.x, to.y + nThere.y * thick - from.y);
  els.doorMatchPanel.classList.add('hidden');
  render();
}
