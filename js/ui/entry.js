// The wall entry card: direction arrows, length, match chips and gap sizes, adding, editing and deleting walls, and the wall list.

import * as units from '../units.js';
import * as rm from '../rooms.js';
import { buildLengthInput, readLength, setLength } from '../length-input.js';
import * as geo from '../geometry.js';
import * as op from '../openings.js';
import { ARROWS, activeLabel, activeRoom, els, geometryOf, headingName, levelRooms, normalizeAngle180, roomIndex, state, ui, uid } from './core.js';
import { closeWallPanel, cornerLabels, roomSide, wallFitProblem } from './walls.js';
import { flashInvalid, showAlert, showConfirm } from './dialogs.js';
import { persist } from './history.js';
import { render } from './view.js';

// True when Wall 1's direction comes from how the room was placed rather than
// the arrows: rooms attached along a wall before tap-to-place existed, and
// rooms pinned in place after their host was deleted.
export function startHeadingFixed() {
  const anchor = activeRoom().anchor;
  if (!anchor) return false;
  if (anchor.type === 'wall') return !anchor.sides && !anchor.shared;
  return anchor.type === 'fixed' && anchor.heading != null;
}

export function anchorDescription(room) {
  const anchor = room.anchor;
  if (!anchor || anchor.type !== 'wall') return '';
  const host = state.rooms.find((r) => r.id === anchor.roomId);
  if (!host) return '';
  const wallIdx = host.walls.findIndex((w) => w.id === anchor.wallId);
  if (wallIdx < 0) return '';
  const wall = host.walls[wallIdx];
  const corners = cornerLabels(wallIdx, host);
  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  const fmt = (m) => units.formatLength(m, state.unit);
  const hostName = `${rm.roomLabel(host, roomIndex(host))} · Wall ${wallIdx + 1}`;
  if (anchor.shared) {
    return `Shares ${hostName} (${fmt(anchor.lengthM)}, ${fmt(anchor.thicknessM)} wall). ` +
      'Walk the other walls; Complete Perimeter closes onto the shared wall.';
  }
  if (!anchor.sides) {
    const corner = anchor.fromCorner === 'end' ? corners.end : corners.start;
    return `Wall 1 is the other side of ${hostName}, starting ${fmt(anchor.offsetM)} from ${lower(corner)}, ` +
      `${fmt(anchor.thicknessM)} wall.`;
  }
  const fromEnd = anchor.offsetM > wall.lengthM / 2;
  const dist = fromEnd ? wall.lengthM - anchor.offsetM : anchor.offsetM;
  const thick = Object.values(anchor.sides).some((v) => v) ? `, ${fmt(anchor.thicknessM)} wall` : '';
  return `Starts on ${hostName}, ${fmt(dist)} from ${lower(fromEnd ? corners.end : corners.start)}${thick}.`;
}

export function describeWall(wall, index) {
  if (index === 0 && startHeadingFixed()) {
    const anchor = activeRoom().anchor;
    if (anchor.type === 'wall') {
      const host = state.rooms.find((r) => r.id === anchor.roomId);
      const hostWall = host ? host.walls.findIndex((w) => w.id === anchor.wallId) + 1 : '?';
      return host ? `Shared with ${rm.roomLabel(host, roomIndex(host))} · Wall ${hostWall}` : 'Shared wall';
    }
    return 'Start position fixed';
  }
  const name = headingName(wallHeadings()[index]);
  if (ARROWS[name]) return `${ARROWS[name]} ${name}`;
  if (index === 0) return `${name} clockwise from up`;
  return `Turned ${wall.angle > 0 ? 'right' : 'left'} ${Math.abs(wall.angle).toFixed(0)}°`;
}

export function buildLengthInputs() {
  buildLengthInput(els.lengthInputs, state.unit, 'len');
}

export function readLengthMeters() {
  return readLength(state.unit, 'len');
}

export function buildCeilingInput() {
  buildLengthInput(els.ceilingInputs, state.unit, 'ceil', state.unit === 'mm' ? 'e.g. 2700' : undefined);
  setLength(state.unit, 'ceil', state.ceilingHeightM);
}

export function clearLengthInputs() {
  buildLengthInputs();
}

// Each wall is picked by its direction on the plan (the arrow pad) and stored
// as a turn from the previous wall; Wall 1 stores its direction outright.
export function wallHeadings() {
  const frame = rm.computeFrames(state.rooms).get(activeRoom().id);
  return geo.computeHeadings(state.walls, frame.heading);
}

// Index of the wall being entered: the one being edited, or the next new one.
export function entryIndex() {
  if (ui.editingId) return state.walls.findIndex((w) => w.id === ui.editingId);
  return ui.insertAt != null ? ui.insertAt : state.walls.length;
}

// Direction of the wall before the one being entered, or null for Wall 1.
export function previousHeading() {
  const idx = entryIndex();
  return idx > 0 ? wallHeadings()[idx - 1] : null;
}

export function setSelectedHeading(h) {
  ui.selectedHeading = h;
  [...els.dirPad.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.heading === String(h));
  });
  els.customAngleSection.classList.toggle('hidden', h !== 'custom');
  renderMatchChips();
}

// Direction on the plan of the wall being entered, from the arrows or Angle.
export function selectedAbsoluteHeading() {
  const angle = currentWallAngle();
  if (angle == null) return null;
  const prev = previousHeading();
  return prev == null ? angle : prev + angle;
}

// Offer the length of walls running the opposite way (e.g. Wall 1 when
// entering Wall 3 of a rectangle), newest first, so only length and width
// need measuring.
export function renderMatchChips() {
  els.matchChips.innerHTML = '';
  const heading = selectedAbsoluteHeading();
  if (heading == null) return;
  const headings = wallHeadings();
  const current = entryIndex();
  state.walls
    .map((w, i) => ({ w, i }))
    .filter(({ i }) => i !== current && Math.abs(normalizeAngle180(headings[i] - heading - 180)) < 0.5)
    .slice(-2)
    .reverse()
    .forEach(({ w, i }) => addMatchChip(`Wall ${i + 1}`, w.lengthM));
  // the shared wall is the closing edge, running from the closing point back to the start
  const span = rm.sharedSpan(state.rooms, activeRoom());
  if (span) {
    const g = geometryOf(activeRoom());
    const edge = (Math.atan2(g.frame.x - g.target.x, -(g.frame.y - g.target.y)) * 180) / Math.PI;
    if (Math.abs(normalizeAngle180(edge - heading - 180)) < 0.5) addMatchChip('shared wall', span.lengthM);
  }
  // up to the next room's wall in this direction
  const [gap] = gapDims();
  if (gap) addMatchChip(`to ${gap.to}`, gap.distM);
  // gaps between neighbouring rooms running the same way
  const rad = (heading * Math.PI) / 180;
  roomGaps()
    .filter((rg) => {
      const len = Math.hypot(rg.x2 - rg.x1, rg.y2 - rg.y1) || 1;
      const along = Math.abs(((rg.x2 - rg.x1) * Math.sin(rad) - (rg.y2 - rg.y1) * Math.cos(rad)) / len);
      return along > 0.999 && !(gap && Math.abs(gap.distM - rg.distM) < 0.0005);
    })
    .slice(0, 2)
    .forEach((rg) => addMatchChip('gap', rg.distM));
}

// Clear gaps between the rooms around the corners this room is drawn from.
export function roomGaps() {
  const room = activeRoom();
  if (!room || ui.moving || ui.placingRoom || ui.placement) return [];
  const g = geometryOf(room);
  if (!ui.editingId && ui.insertAt == null && rm.roomClosed(room, g)) return [];
  const near = [g.points[0], g.points[entryIndex()], g.target].filter(Boolean); // start, open end, where it closes
  if (!near.length) return [];
  const runs = gapDims();
  return rm.roomGapsNear(levelRooms(), rm.roomGeometry(levelRooms()), room.id, near)
    .filter((rg) => !runs.some((r) => Math.abs(r.distM - rg.distM) < 0.0005)) // already shown
    .map((rg) => ({ ...rg, label: units.formatLength(rg.distM, state.unit) }));
}

// Clear runs from the corner the next wall starts at to the nearest other
// room's wall: the chosen direction only, or every square direction until
// one is chosen. Lets a room be drawn to fill a gap between rooms.
export function gapDims() {
  const room = activeRoom();
  if (!room || ui.moving || ui.placingRoom || ui.placement) return [];
  const g = geometryOf(room);
  if (!ui.editingId && ui.insertAt == null && rm.roomClosed(room, g)) return [];
  const from = g.points[entryIndex()];
  if (!from) return [];
  const chosen = selectedAbsoluteHeading();
  const prev = previousHeading();
  const headings = chosen != null
    ? [chosen]
    : [0, 90, 180, 270].filter((h) => prev == null || Math.abs(Math.abs(normalizeAngle180(h - prev)) - 180) > 0.01);
  const geom = rm.roomGeometry(levelRooms());
  return headings.map((h) => {
    const run = rm.clearRunTo(levelRooms(), geom, room.id, from, h);
    if (!run) return null;
    const other = state.rooms.find((r) => r.id === run.roomId);
    return {
      x1: from.x, y1: from.y, x2: run.x, y2: run.y,
      distM: run.distM,
      to: rm.roomLabel(other, roomIndex(other)),
      label: units.formatLength(run.distM, state.unit),
    };
  }).filter(Boolean);
}

export function addMatchChip(label, lengthM) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip match';
  btn.dataset.lengthM = lengthM;
  btn.textContent = `= ${label} · ${units.formatLength(lengthM, state.unit)}`;
  els.matchChips.appendChild(btn);
}

// Grey out the arrow that would double straight back along the previous wall.
export function updateDirPad() {
  const prev = previousHeading();
  [...els.dirPad.children].forEach((btn) => {
    const h = btn.dataset.heading;
    btn.disabled = h !== 'custom' && prev != null &&
      Math.abs(Math.abs(normalizeAngle180(Number(h) - prev)) - 180) < 0.01;
  });
  const chosen = els.dirPad.querySelector('.pad-btn.selected');
  if (chosen && chosen.disabled) setSelectedHeading(null);
  els.customAngleLabel.textContent = prev == null ? 'Turn from straight up the plan' : 'Turn from the previous wall';
}

export function setCustomSide(side) {
  ui.customSide = side;
  [...els.lrToggle.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.side === side);
  });
}

// The angle to store for the wall being entered, or null if no valid direction.
export function currentWallAngle() {
  const prev = previousHeading();
  if (ui.selectedHeading === 'custom') {
    const deg = parseFloat(els.customAngleInput.value);
    if (!Number.isFinite(deg) || deg <= 0) return null;
    const turn = ui.customSide === 'left' ? -deg : deg;
    return prev == null ? ((turn % 360) + 360) % 360 : turn;
  }
  if (ui.selectedHeading == null) return null;
  const heading = Number(ui.selectedHeading);
  if (prev == null) return heading;
  const turn = normalizeAngle180(heading - prev);
  return Math.abs(Math.abs(turn) - 180) < 0.01 ? null : turn;
}

export function renderEntryTitle() {
  const nextIndex = entryIndex();
  const roomPrefix = state.rooms.length > 1 ? `${activeLabel()} – ` : '';
  if (ui.editingId) els.entryTitle.textContent = `${roomPrefix}Editing Wall ${nextIndex + 1}`;
  else if (ui.insertAt != null) els.entryTitle.textContent = `${roomPrefix}Inserting a wall after Wall ${nextIndex}`;
  else els.entryTitle.textContent = `${roomPrefix}Wall ${nextIndex + 1}`;
  els.finishInsertBtn.classList.toggle('hidden', ui.insertAt == null || !!ui.editingId);
}

export function sideName(i) {
  const side = roomSide(i);
  return `${side.charAt(0).toUpperCase()}${side.slice(1)} wall`;
}

export function renderWallList() {
  els.wallList.innerHTML = '';
  if (state.walls.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = 'No walls measured yet.';
    els.wallList.appendChild(li);
    return;
  }
  state.walls.forEach((wall, i) => {
    const li = document.createElement('li');
    li.className = 'wall-row';
    const extras = [describeWall(wall, i)];
    const openings = wall.openings || [];
    if (openings.length) {
      const counts = {};
      openings.forEach((o) => {
        const label = op.OPENING_TYPES[o.type].label.toLowerCase();
        counts[label] = (counts[label] || 0) + 1;
      });
      extras.push(Object.entries(counts).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', '));
    }
    const nFix = (wall.fixtures || []).reduce((sum, f) => sum + (f.qty || 1), 0);
    if (nFix) extras.push(`${nFix} fixture${nFix > 1 ? 's' : ''}`);
    if (wall.ceilingHeightM) extras.push(`ceiling ${units.formatLength(wall.ceilingHeightM, state.unit)}`);
    const warn = openings.some((o) => !op.fitsOnWall(wall, o)) ? ' <span class="warn-text">⚠ check openings</span>' : '';
    li.innerHTML = `
      <button type="button" class="wall-idx" data-locate="${wall.id}" title="Show on the plan">${i + 1}</button>
      <div class="wall-info" data-id="${wall.id}">
        <div class="wall-len">${sideName(i)} · ${units.formatLength(wall.lengthM, state.unit)}</div>
        <div class="wall-dir">${extras.join(' · ')}${warn}</div>
        <div class="wall-hint">${openings.length ? 'Tap to edit openings' : 'Tap to add openings'} ›</div>
      </div>
      <button class="edit-btn" data-id="${wall.id}" title="Edit">&#9998;</button>
      <button class="delete-btn" data-id="${wall.id}" title="Delete">&#128465;</button>
    `;
    els.wallList.appendChild(li);
  });
}

export function resetEntryForm() {
  ui.editingId = null;
  setSelectedHeading(null);
  setCustomSide('left');
  els.customAngleInput.value = '';
  [...els.presetChips.children].forEach((c) => c.classList.remove('selected'));
  clearLengthInputs();
}

export function handleAddWall() {
  const lengthM = readLengthMeters();
  if (lengthM == null || lengthM <= 0) {
    flashInvalid();
    return;
  }

  const editIdx = ui.editingId ? state.walls.findIndex((w) => w.id === ui.editingId) : -1;
  const isFirst = entryIndex() === 0;

  let angle;
  if (isFirst && startHeadingFixed()) {
    angle = 0; // direction comes from where the room was placed
  } else {
    angle = currentWallAngle();
    if (angle == null) {
      flashInvalid();
      return;
    }
  }

  if (editIdx >= 0) {
    const problem = wallFitProblem(state.walls[editIdx], lengthM);
    if (problem) {
      flashInvalid();
      showAlert(problem);
      return;
    }
    // keep the walls after this one pointing the same way on the plan
    const before = wallHeadings();
    state.walls[editIdx] = { ...state.walls[editIdx], lengthM, angle };
    const next = state.walls[editIdx + 1];
    if (next) {
      const delta = wallHeadings()[editIdx] - before[editIdx];
      next.angle = normalizeAngle180(next.angle - delta);
    }
  } else if (ui.insertAt != null) {
    // a step or nib at a break: the walls after it keep their directions
    const at = ui.insertAt;
    const before = wallHeadings();
    state.walls.splice(at, 0, { id: uid(), lengthM, angle, openings: [] });
    const next = state.walls[at + 1];
    if (next) next.angle = normalizeAngle180(next.angle - (wallHeadings()[at + 1] - before[at]));
    ui.insertAt = at + 1;
  } else {
    state.walls.push({ id: uid(), lengthM, angle });
  }

  if (ui.insertAt == null) {
    settleSharedStart(activeRoom());
    rm.settleSharedClose(state.rooms, activeRoom());
  }
  resetEntryForm();
  persist();
  render();
}

// A shared-wall room can be walked from either end of the shared wall. Once
// the walls show which way it goes, start it from whichever end its walls
// lead back towards (so Complete Perimeter closes along the shared wall
// rather than across the room).
export function settleSharedStart(room) {
  const anchor = room.anchor;
  if (!anchor || !anchor.shared || room.walls.length < 2) return;
  const gapNow = rm.closingGap(room, geometryOf(room));
  if (gapNow <= 0.05) return;
  anchor.reversed = !anchor.reversed;
  const gapFlipped = rm.closingGap(room, geometryOf(room));
  if (gapFlipped >= gapNow - 0.01) anchor.reversed = !anchor.reversed;
}

export function handleUndo() {
  if (state.walls.length === 0) return;
  const lastId = state.walls[state.walls.length - 1].id;
  rm.pinAttachedRooms(state.rooms, (a) => a.wallId === lastId || !!(a.sides && lastId in a.sides));
  const removed = state.walls.pop();
  ui.editingId = null;
  if (ui.panelWallId === removed.id) closeWallPanel();
  persist();
  render();
}

export function handleEditWall(id) {
  const idx = state.walls.findIndex((w) => w.id === id);
  if (idx < 0) return;
  const wall = state.walls[idx];
  ui.editingId = id;
  ui.insertAt = null;
  const heading = ((wallHeadings()[idx] % 360) + 360) % 360;
  const square = [0, 90, 180, 270, 360].find((h) => Math.abs(h - heading) < 0.01);
  if (square !== undefined) {
    setSelectedHeading(square % 360);
  } else {
    setSelectedHeading('custom');
    const turn = idx === 0 ? normalizeAngle180(wall.angle) : wall.angle;
    setCustomSide(turn < 0 ? 'left' : 'right');
    els.customAngleInput.value = Math.abs(turn);
  }
  buildLengthInputs();
  setLength(state.unit, 'len', wall.lengthM);
  render();
  els.entryTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function handleDeleteWall(id) {
  const idx = state.walls.findIndex((w) => w.id === id);
  if (idx < 0) return;
  const ok = await showConfirm(`Delete wall ${idx + 1}? Later walls will keep their relative turns.`);
  if (!ok) return;
  rm.pinAttachedRooms(state.rooms, (a) => a.wallId === id || !!(a.sides && id in a.sides));
  state.walls.splice(idx, 1);
  if (ui.editingId === id) resetEntryForm();
  if (ui.panelWallId === id) closeWallPanel();
  persist();
  render();
}

// Adds the wall from the open end back to where the room closes: its start,
// or the near end of a shared wall.
export function handleClosePolygon() {
  const g = geometryOf(activeRoom());
  const last = g.points[g.points.length - 1];
  const dx = g.target.x - last.x;
  const dy = g.target.y - last.y;
  const lengthM = Math.hypot(dx, dy);
  if (state.walls.length === 0 || lengthM < 0.01) return;
  const heading = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const angle = normalizeAngle180(heading - wallHeadings()[state.walls.length - 1]);
  state.walls.push({ id: uid(), lengthM, angle });
  persist();
  render();
}
