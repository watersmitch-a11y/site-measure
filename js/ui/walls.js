// The wall window: length (keeping the room closed), thickness, breaking a wall, openings, and services and fixtures.

import * as rm from '../rooms.js';
import * as units from '../units.js';
import { buildLengthInput, readLength, setLength } from '../length-input.js';
import * as op from '../openings.js';
import * as fx from '../fixtures.js';
import { $, MEASURED_TO_KEY, activeLabel, activeRoom, allWalls, els, escapeHtml, geometryOf, roomIndex, state, ui, uid } from './core.js';
import { canMove } from './move.js';
import { drawPlan, render } from './view.js';
import { persist } from './history.js';
import { renderPhotoStrip } from './photo-ui.js';
import { renderWallList, resetEntryForm, settleSharedStart, sideName } from './entry.js';
import { showConfirm } from './dialogs.js';

export function panelWall() {
  return state.walls.find((w) => w.id === ui.panelWallId) || null;
}

export function isShapeClosed(room = activeRoom()) {
  return rm.roomClosed(room, geometryOf(room));
}

// What each end of a wall meets, e.g. "Wall 4", for the measure-from toggles.
export function cornerLabels(idx, room = activeRoom()) {
  const walls = room.walls;
  const shared = !!(room.anchor && room.anchor.shared);
  const n = walls.length;
  const closed = isShapeClosed(room);
  // a shared-wall room starts and (once closed) ends against the shared wall
  let start = 'Start point';
  if (idx > 0) start = `Corner with Wall ${idx}`;
  else if (shared) start = 'Corner with shared wall';
  else if (closed) start = `Corner with Wall ${n}`;
  let end = 'Open end';
  if (idx < n - 1) end = `Corner with Wall ${idx + 2}`;
  else if (closed) end = shared ? 'Corner with shared wall' : 'Corner with Wall 1';
  return { start, end };
}

// The ends of a wall as they look on the plan: { start: 'left', end: 'right',
// first: 'start' }, where first is the left/top end. Angled walls go by the
// way they mostly run. Easier to match to the plan than "corner with Wall 3"
// when the panel covers it.
export const END_ARROWS = { left: '←', right: '→', top: '↑', bottom: '↓' };

export const OPPOSITE_END = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

export function planEnds(idx, room = activeRoom()) {
  const pts = geometryOf(room).points;
  const dx = pts[idx + 1].x - pts[idx].x;
  const dy = pts[idx + 1].y - pts[idx].y; // y runs down the plan
  const start = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom');
  return { start, end: OPPOSITE_END[start], first: start === 'left' || start === 'top' ? 'start' : 'end' };
}

// Which side of the room a wall is on as seen on the plan (top, left, …), so
// it can be told apart while the panel covers the plan.
export function roomSide(idx, room = activeRoom()) {
  const pts = geometryOf(room).points;
  const dx = pts[idx + 1].x - pts[idx].x;
  const dy = pts[idx + 1].y - pts[idx].y;
  const out = -rm.insideSign(pts); // outward normal is (-dy, dx) * out
  const ox = -dy * out;
  const oy = dx * out;
  return Math.abs(ox) >= Math.abs(oy) ? (ox > 0 ? 'right' : 'left') : (oy > 0 ? 'bottom' : 'top');
}

export function formatSize(widthM, heightM) {
  if (state.unit === 'mm') {
    return `${Math.round(units.metersToMm(widthM))} × ${Math.round(units.metersToMm(heightM))} mm`;
  }
  return `${units.formatLength(widthM, state.unit)} × ${units.formatLength(heightM, state.unit)}`;
}

export function openWallPanel(id) {
  const idx = state.walls.findIndex((w) => w.id === id);
  if (idx < 0) return;
  const wall = state.walls[idx];
  els.panelMoveRoomBtn.textContent = `Move ${activeLabel()}`;
  els.panelMoveRoomBtn.classList.toggle('hidden', !canMove(activeRoom()));
  ui.panelWallId = id;
  const side = roomSide(idx);
  els.wallPanelTitle.textContent =
    `${side.charAt(0).toUpperCase()}${side.slice(1)} wall · ${units.formatLength(wall.lengthM, state.unit)}`;
  $('#wallPanelSub').textContent = activeLabel();
  buildLengthInput(els.panelLengthInputs, state.unit, 'panelLen');
  setLength(state.unit, 'panelLen', wall.lengthM);
  els.panelLengthError.classList.add('hidden');
  fillKeepClosed();
  renderPhotoStrip(els.wallPhotos, activeRoom(), id);
  hideFixtureForm();
  renderFixtureList();
  buildLengthInput(els.wallThickInputs, state.unit, 'wallThick');
  setLength(state.unit, 'wallThick', rm.wallThickness(wall));
  els.wallThickAll.checked = false;
  els.wallThickError.classList.add('hidden');
  buildLengthInput(els.breakAtInputs, state.unit, 'breakAt', 'Distance along the wall');
  els.breakError.classList.add('hidden');
  const breakEnds = planEnds(idx);
  els.breakEndSelect.options[0].textContent = `From the ${breakEnds[breakEnds.first]} end`;
  els.breakEndSelect.options[0].value = breakEnds.first;
  const secondEnd = breakEnds.first === 'start' ? 'end' : 'start';
  els.breakEndSelect.options[1].textContent = `From the ${breakEnds[secondEnd]} end`;
  els.breakEndSelect.options[1].value = secondEnd;
  buildLengthInput(els.wallCeilingInputs, state.unit, 'wallCeil', 'Same as room');
  setLength(state.unit, 'wallCeil', wall.ceilingHeightM || null);
  // left/top end on the left-hand button, so the toggle reads like the plan
  const ends = planEnds(idx);
  const order = ends.first === 'start' ? ['start', 'end'] : ['end', 'start'];
  [...els.cornerToggle.children].forEach((btn, i) => {
    const corner = order[i];
    btn.dataset.corner = corner;
    btn.textContent = `${END_ARROWS[ends[corner]]} From ${ends[corner]} end`;
  });
  hideOpeningForm();
  renderOpeningList();
  setWallTab(ui.wallTab || 'openings');
  els.wallPanel.classList.remove('hidden');
  render();
}

// In a closed room a longer or shorter wall leaves a gap the same size, along
// that wall's line. A wall running the opposite way can grow by the same
// amount (or one running the same way can shrink) to close it again.
export function closingPartners(room, idx) {
  if (!isShapeClosed(room)) return [];
  const headings = rm.roomGeometry(state.rooms).get(room.id);
  const pts = headings.points;
  const dirOf = (j) => {
    const dx = pts[j + 1].x - pts[j].x;
    const dy = pts[j + 1].y - pts[j].y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  const u = dirOf(idx);
  return room.walls
    .map((w, j) => ({ j, w, d: dirOf(j).x * u.x + dirOf(j).y * u.y }))
    .filter(({ j, d }) => j !== idx && Math.abs(Math.abs(d) - 1) < 0.001)
    .map(({ j, w, d }) => ({ j, w, sign: d < 0 ? 1 : -1 })) // opposite way grows, same way shrinks
    .sort((p, q) => (p.sign - q.sign) || (q.w.lengthM - p.w.lengthM)); // opposite, longest first
}

export function fillKeepClosed() {
  const room = activeRoom();
  const idx = state.walls.findIndex((w) => w.id === ui.panelWallId);
  const wall = state.walls[idx];
  const partners = closingPartners(room, idx);
  els.keepClosedRow.classList.toggle('hidden', !partners.length);
  if (!partners.length) return;
  const newLen = readLength(state.unit, 'panelLen');
  const delta = newLen == null ? 0 : newLen - wall.lengthM;
  els.keepClosedSelect.innerHTML = '';
  partners.forEach(({ j, w, sign }) => {
    const opt = document.createElement('option');
    opt.value = w.id;
    const after = w.lengthM + sign * delta;
    const change = Math.abs(delta) > 0.0005 ? ` → ${units.formatLength(after, state.unit)}` : '';
    const sideName = roomSide(j, room);
    opt.textContent = `${sideName.charAt(0).toUpperCase()}${sideName.slice(1)} wall (Wall ${j + 1}): ` +
      `${units.formatLength(w.lengthM, state.unit)}${change}`;
    els.keepClosedSelect.appendChild(opt);
  });
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Nothing (leave a gap)';
  els.keepClosedSelect.appendChild(none);
  // the opposite wall unless a choice was picked for this wall
  const picked = ui.keepClosedPick;
  if (picked && picked.wallId === ui.panelWallId && [...els.keepClosedSelect.options].some((o) => o.value === picked.value)) {
    els.keepClosedSelect.value = picked.value;
  } else {
    els.keepClosedSelect.selectedIndex = 0;
  }
}

// Why a wall can't take a new length: a door, window or fixture on it would
// run past its end. null if it's fine.
export function wallFitProblem(wall, lengthM) {
  const trial = { ...wall, lengthM };
  const opTags = op.openingTags(allWalls());
  const badOpening = (wall.openings || []).find((o) => op.fitsOnWall(wall, o) && !op.fitsOnWall(trial, o));
  if (badOpening) return `${opTags[badOpening.id]} would run past the end of the wall at that length; move or resize it first.`;
  const fxTags = fx.fixtureTags(allWalls());
  const badFixture = (wall.fixtures || []).find((f) => fx.fixtureFits(wall, f) && !fx.fixtureFits(trial, f));
  if (badFixture) return `${fxTags[badFixture.id]} would be past the end of the wall at that length; move it first.`;
  return null;
}

export function handleUpdateLength() {
  const room = activeRoom();
  const idx = state.walls.findIndex((w) => w.id === ui.panelWallId);
  if (idx < 0) return;
  const wall = state.walls[idx];
  const showError = (msg) => {
    els.panelLengthError.textContent = msg;
    els.panelLengthError.classList.remove('hidden');
  };
  const newLen = readLength(state.unit, 'panelLen');
  if (newLen == null) return showError('Enter the wall length.');
  const delta = newLen - wall.lengthM;
  const partner = els.keepClosedRow.classList.contains('hidden')
    ? null
    : closingPartners(room, idx).find((p) => p.w.id === els.keepClosedSelect.value);
  if (partner && partner.w.lengthM + partner.sign * delta < 0.01) {
    return showError(`That would make the ${roomSide(partner.j, room)} wall too short; pick another wall to change.`);
  }
  const problem = wallFitProblem(wall, newLen) ||
    (partner && wallFitProblem(partner.w, partner.w.lengthM + partner.sign * delta));
  if (problem) return showError(problem);
  wall.lengthM = newLen;
  if (partner) partner.w.lengthM += partner.sign * delta;
  settleSharedStart(room);
  rm.settleSharedClose(state.rooms, room);
  persist();
  openWallPanel(wall.id); // refresh the title, figures and choices
}

export function closeWallPanel() {
  ui.panelWallId = null;
  hideOpeningForm();
  els.wallPanel.classList.add('hidden');
}

export function renderOpeningList() {
  renderWallTabCounts();
  const wall = panelWall();
  els.openingList.innerHTML = '';
  if (!wall) return;
  const openings = wall.openings || [];
  if (openings.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = 'No openings on this wall.';
    els.openingList.appendChild(li);
    return;
  }
  const tags = op.openingTags(allWalls());
  const ends = planEnds(state.walls.indexOf(wall));
  openings.forEach((o) => {
    const li = document.createElement('li');
    li.className = 'wall-row';
    const from = `${ends[o.fromCorner === 'end' ? 'end' : 'start']} end`;
    const sill = o.type === 'window' || o.sillM ? ` · sill ${units.formatLength(o.sillM || 0, state.unit)}` : '';
    const door = o.type === 'door'
      ? ` · hinge ${o.hinge === 'right' ? 'right' : 'left'}, opens ${o.swing === 'out' ? 'out' : 'in'}`
      : '';
    const warn = op.fitsOnWall(wall, o) ? '' : ' <span class="warn-text">⚠ runs past end of wall</span>';
    li.innerHTML = `
      <div class="wall-idx">${tags[o.id]}</div>
      <div class="wall-info">
        <div class="wall-len">${op.OPENING_TYPES[o.type].label} ${formatSize(o.widthM, o.heightM)}</div>
        <div class="wall-dir">${units.formatLength(o.offsetM, state.unit)} from ${from}${sill}${door}</div>
        <div class="wall-dir">${op.MEASURED_TO[o.measuredTo]}${o.note ? ' · ' + escapeHtml(o.note) : ''}${warn}</div>
      </div>
      <button class="edit-btn" data-op-id="${o.id}" title="Edit">&#9998;</button>
      <button class="delete-btn" data-op-id="${o.id}" title="Delete">&#128465;</button>
    `;
    els.openingList.appendChild(li);
  });
}

export function setOpeningType(type) {
  ui.openingType = type;
  [...els.openingTypeButtons.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.type === type);
  });
  els.sillSection.classList.toggle('hidden', !(type === 'window' || type === 'other'));
  els.doorSection.classList.toggle('hidden', type !== 'door');
}

export function setToggle(container, attr, value) {
  [...container.children].forEach((btn) => btn.classList.toggle('selected', btn.dataset[attr] === value));
}

export function setOpeningHinge(hinge) {
  ui.openingHinge = hinge;
  setToggle(els.hingeToggle, 'hinge', hinge);
}

export function setOpeningSwing(swing) {
  ui.openingSwing = swing;
  setToggle(els.swingToggle, 'swing', swing);
}

export function setOpeningCorner(corner) {
  ui.openingCorner = corner;
  [...els.cornerToggle.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.corner === corner);
  });
}

export function showOpeningForm(opening) {
  ui.editingOpeningId = opening ? opening.id : null;
  els.openingFormTitle.textContent = opening ? 'Edit opening' : 'New opening';
  buildLengthInput($('#offsetInputs'), state.unit, 'opOff', state.unit === 'mm' ? 'e.g. 0' : undefined);
  buildLengthInput($('#widthInputs'), state.unit, 'opW');
  buildLengthInput($('#heightInputs'), state.unit, 'opH');
  buildLengthInput($('#sillInputs'), state.unit, 'opSill');
  setOpeningType(opening ? opening.type : 'door');
  setOpeningCorner(opening ? opening.fromCorner : planEnds(state.walls.indexOf(panelWall())).first);
  setOpeningHinge(opening && opening.hinge ? opening.hinge : 'left');
  setOpeningSwing(opening && opening.swing ? opening.swing : 'in');
  let lastMeasuredTo = 'plaster';
  try {
    lastMeasuredTo = localStorage.getItem(MEASURED_TO_KEY) || 'plaster';
  } catch {}
  els.measuredToSelect.value = opening ? opening.measuredTo : lastMeasuredTo;
  if (opening) {
    setLength(state.unit, 'opOff', opening.offsetM);
    setLength(state.unit, 'opW', opening.widthM);
    setLength(state.unit, 'opH', opening.heightM);
    setLength(state.unit, 'opSill', opening.sillM || null);
  }
  els.openingNote.value = opening ? opening.note || '' : '';
  els.openingError.classList.add('hidden');
  els.openingForm.classList.remove('hidden');
  els.addOpeningBtn.classList.add('hidden');
  els.openingForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function hideOpeningForm() {
  ui.editingOpeningId = null;
  els.openingForm.classList.add('hidden');
  els.addOpeningBtn.classList.remove('hidden');
}

export function showOpeningError(message) {
  els.openingError.textContent = message;
  els.openingError.classList.remove('hidden');
}

export function handleSaveOpening() {
  const wall = panelWall();
  if (!wall) return;
  const offsetM = readLength(state.unit, 'opOff', { allowZero: true });
  const widthM = readLength(state.unit, 'opW');
  const heightM = readLength(state.unit, 'opH');
  const hasSill = ui.openingType === 'window' || ui.openingType === 'other';
  const sillM = hasSill ? readLength(state.unit, 'opSill', { allowZero: true }) || 0 : 0;
  if (offsetM == null) return showOpeningError('Enter the distance from the corner (0 if it starts at the corner).');
  if (widthM == null) return showOpeningError('Enter the opening width.');
  if (heightM == null) return showOpeningError('Enter the opening height.');

  const opening = {
    id: ui.editingOpeningId || uid().replace(/^w_/, 'o_'),
    type: ui.openingType,
    measuredTo: els.measuredToSelect.value,
    fromCorner: ui.openingCorner,
    offsetM,
    widthM,
    heightM,
    sillM,
    note: els.openingNote.value.trim(),
  };
  if (opening.type === 'door') {
    opening.hinge = ui.openingHinge;
    opening.swing = ui.openingSwing;
  }

  if (!op.fitsOnWall(wall, opening)) {
    const available = Math.max(wall.lengthM - offsetM, 0);
    return showOpeningError(
      `Doesn't fit: the wall is ${units.formatLength(wall.lengthM, state.unit)}, so only ` +
      `${units.formatLength(available, state.unit)} is left past that distance.`
    );
  }
  const clash = op.overlappingOpening(wall, opening);
  if (clash) {
    return showOpeningError(`Overlaps ${op.openingTags(allWalls())[clash.id]} on this wall.`);
  }

  wall.openings = wall.openings || [];
  const existing = wall.openings.findIndex((o) => o.id === opening.id);
  if (existing >= 0) wall.openings[existing] = opening;
  else wall.openings.push(opening);
  try {
    localStorage.setItem(MEASURED_TO_KEY, opening.measuredTo);
  } catch {}

  hideOpeningForm();
  persist();
  renderOpeningList();
  render();
}

export async function handleDeleteOpening(id) {
  const wall = panelWall();
  if (!wall) return;
  const tag = op.openingTags(allWalls())[id];
  const ok = await showConfirm(`Delete opening ${tag}?`);
  if (!ok) return;
  wall.openings = (wall.openings || []).filter((o) => o.id !== id);
  if (ui.editingOpeningId === id) hideOpeningForm();
  persist();
  renderOpeningList();
  render();
}

// A wall's thickness (or every wall of the room's): drawn outside the
// measured line, so rooms either side line up with the right gap. Rooms
// sharing the wall keep the same gap.
export function handleWallThickness(valueM) {
  const room = activeRoom();
  const wall = panelWall();
  if (!wall) return;
  const t = valueM ?? readLength(state.unit, 'wallThick');
  if (t == null || t < 0.02 || t > 1) {
    els.wallThickError.textContent = 'Enter a wall thickness between 20 mm and 1000 mm.';
    els.wallThickError.classList.remove('hidden');
    return;
  }
  els.wallThickError.classList.add('hidden');
  const targets = els.wallThickAll.checked ? room.walls : [wall];
  targets.forEach((w) => {
    if (Math.abs(t - rm.DEFAULT_WALL_THICKNESS_M) < 0.0005) delete w.thicknessM;
    else w.thicknessM = Math.round(t * 1000) / 1000;
    state.rooms.forEach((r) => {
      if (r.anchor && r.anchor.shared && r.anchor.wallId === w.id) r.anchor.thicknessM = rm.wallThickness(w);
    });
  });
  setLength(state.unit, 'wallThick', t);
  persist();
  render();
}

// Split a wall in two on the same line, then insert walls at the split (a
// step or nib); the walls after keep their directions on the plan.
export function handleBreakWall() {
  const idx = state.walls.findIndex((w) => w.id === ui.panelWallId);
  if (idx < 0) return;
  const wall = state.walls[idx];
  const showError = (msg) => {
    els.breakError.textContent = msg;
    els.breakError.classList.remove('hidden');
  };
  const d = readLength(state.unit, 'breakAt');
  if (d == null) return showError('Enter how far along the wall the break is.');
  const at = els.breakEndSelect.value === 'end' ? wall.lengthM - d : d; // from the wall's start
  if (at < 0.01 || at > wall.lengthM - 0.01) return showError('The break has to be part way along the wall.');
  const tags = op.openingTags(allWalls());
  const cut = (wall.openings || []).find((o) => {
    const sp = op.openingSpan(wall, o);
    return sp.startM < at - 0.001 && sp.endM > at + 0.001;
  });
  if (cut) return showError(`The break falls in ${tags[cut.id]}; break the wall clear of it.`);
  const children = state.rooms.filter((r) => r.anchor && r.anchor.type === 'wall' && r.anchor.wallId === wall.id);
  const across = children.find((r) => r.anchor.shared &&
    r.anchor.offsetM < at - 0.001 && r.anchor.offsetM + r.anchor.lengthM > at + 0.001);
  if (across) return showError(`${rm.roomLabel(across, roomIndex(across))} shares this wall across the break; separate it first.`);

  const rest = { id: uid(), lengthM: wall.lengthM - at, angle: 0, openings: [] };
  if (wall.thicknessM) rest.thicknessM = wall.thicknessM;
  if (wall.ceilingHeightM) rest.ceilingHeightM = wall.ceilingHeightM;
  const keep = [];
  (wall.openings || []).forEach((o) => {
    const sp = op.openingSpan(wall, o);
    if (sp.endM <= at + 0.001) {
      keep.push(o.fromCorner === 'end' ? { ...o, offsetM: at - sp.endM } : o);
    } else {
      rest.openings.push(o.fromCorner === 'end' ? o : { ...o, offsetM: sp.startM - at });
    }
  });
  wall.openings = keep;
  wall.lengthM = at;
  state.walls.splice(idx + 1, 0, rest);
  // rooms sharing the far piece now hang off it
  children.forEach((r) => {
    if (r.anchor.offsetM >= at - 0.001) {
      r.anchor.wallId = rest.id;
      r.anchor.offsetM -= at;
    }
  });
  const wasClosed = rm.roomClosed(activeRoom(), geometryOf(activeRoom()));
  closeWallPanel();
  resetEntryForm();
  ui.insertAt = idx + 1;
  ui.insertRest = wasClosed ? rest.id : null; // shortened on Finish to keep the room closed
  persist();
  render();
  $('#entryCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function renderFixtureList() {
  renderWallTabCounts();
  const wall = panelWall();
  const list = $('#fixtureList');
  list.innerHTML = '';
  if (!wall) return;
  const items = wall.fixtures || [];
  if (!items.length) {
    list.innerHTML = '<li class="empty-note">No services or fixtures on this wall.</li>';
    return;
  }
  const tags = fx.fixtureTags(allWalls());
  const ends = planEnds(state.walls.indexOf(wall));
  items.forEach((f) => {
    const li = document.createElement('li');
    li.className = 'wall-row';
    const t = fx.fixtureType(f);
    const fmt = (m) => units.formatLength(m, state.unit);
    const bits = [`${fmt(f.offsetM)} from ${ends[f.fromCorner === 'end' ? 'end' : 'start']} end`];
    if (f.widthM) bits.push(`${fmt(f.widthM)} long`);
    if (f.heightM) bits.push(`${fmt(f.heightM)} AFL`);
    const warn = fx.fixtureFits(wall, f) ? '' : ' <span class="warn-text">⚠ past end of wall</span>';
    li.innerHTML = `
      <div class="wall-idx">${tags[f.id]}</div>
      <div class="wall-info">
        <div class="wall-len">${f.qty > 1 ? `${f.qty} × ` : ''}${t.label}</div>
        <div class="wall-dir">${bits.join(' · ')}${f.note ? ` · ${escapeHtml(f.note)}` : ''}${warn}</div>
      </div>
      <button class="edit-btn" data-fx-id="${f.id}" title="Edit">&#9998;</button>
      <button class="delete-btn" data-fx-id="${f.id}" title="Delete">&#128465;</button>`;
    list.appendChild(li);
  });
}

export function setFixtureTypeFields() {
  const t = fx.FIXTURE_TYPES[$('#fixtureType').value] || fx.FIXTURE_TYPES.other;
  $('#fixtureWidthRow').classList.toggle('hidden', !t.width);
  $('#fixtureOffsetLabel').textContent = t.width ? 'Distance to its near end' : 'Distance to its centre';
}

export function showFixtureForm(f) {
  const wall = panelWall();
  if (!wall) return;
  ui.editingFixtureId = f ? f.id : null;
  const typeSel = $('#fixtureType');
  if (!typeSel.options.length) {
    Object.entries(fx.FIXTURE_TYPES).forEach(([k, t]) => typeSel.add(new Option(t.label, k)));
  }
  const ends = planEnds(state.walls.indexOf(wall));
  const endSel = $('#fixtureEnd');
  const second = ends.first === 'start' ? 'end' : 'start';
  endSel.options[0].value = ends.first;
  endSel.options[0].textContent = `From the ${ends[ends.first]} end`;
  endSel.options[1].value = second;
  endSel.options[1].textContent = `From the ${ends[second]} end`;
  buildLengthInput($('#fixtureOffsetInputs'), state.unit, 'fxOff');
  buildLengthInput($('#fixtureWidthInputs'), state.unit, 'fxW');
  buildLengthInput($('#fixtureHeightInputs'), state.unit, 'fxH', 'e.g. 300');
  typeSel.value = f ? f.type : ui.lastFixtureType || 'gpo2';
  endSel.value = f ? f.fromCorner : ends.first;
  setLength(state.unit, 'fxOff', f ? f.offsetM : null);
  setLength(state.unit, 'fxW', f && f.widthM ? f.widthM : null);
  setLength(state.unit, 'fxH', f && f.heightM ? f.heightM : null);
  $('#fixtureQty').value = f ? f.qty || 1 : 1;
  $('#fixtureNote').value = f ? f.note || '' : '';
  $('#fixtureError').classList.add('hidden');
  setFixtureTypeFields();
  $('#fixtureForm').classList.remove('hidden');
  $('#addFixtureBtn').classList.add('hidden');
  $('#fixtureForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function hideFixtureForm() {
  ui.editingFixtureId = null;
  $('#fixtureForm').classList.add('hidden');
  $('#addFixtureBtn').classList.remove('hidden');
}

export function handleSaveFixture() {
  const wall = panelWall();
  if (!wall) return;
  const err = (msg) => {
    $('#fixtureError').textContent = msg;
    $('#fixtureError').classList.remove('hidden');
  };
  const type = $('#fixtureType').value;
  const t = fx.FIXTURE_TYPES[type];
  const offsetM = readLength(state.unit, 'fxOff', { allowZero: true });
  if (offsetM == null) return err('Enter how far along the wall it is.');
  const widthM = t.width ? readLength(state.unit, 'fxW') : null;
  const heightM = readLength(state.unit, 'fxH', { allowZero: true });
  const f = {
    id: ui.editingFixtureId || uid().replace(/^w_/, 'f_'),
    type,
    fromCorner: $('#fixtureEnd').value,
    offsetM,
    qty: Math.max(1, Math.round(Number($('#fixtureQty').value) || 1)),
    note: $('#fixtureNote').value.trim(),
  };
  if (widthM) f.widthM = widthM;
  if (heightM != null) f.heightM = heightM;
  if (!fx.fixtureFits(wall, f)) return err(`That's past the end of the wall (${units.formatLength(wall.lengthM, state.unit)}).`);
  const list = wall.fixtures || [];
  const at = list.findIndex((x) => x.id === f.id);
  wall.fixtures = at >= 0 ? list.map((x) => (x.id === f.id ? f : x)) : [...list, f];
  ui.lastFixtureType = type;
  hideFixtureForm();
  persist();
  renderFixtureList();
  drawPlan();
  renderWallList();
}

export async function handleDeleteFixture(id) {
  const wall = panelWall();
  if (!wall) return;
  const tag = fx.fixtureTags(allWalls())[id];
  if (!(await showConfirm(`Delete ${tag}?`))) return;
  wall.fixtures = (wall.fixtures || []).filter((f) => f.id !== id);
  persist();
  renderFixtureList();
  drawPlan();
  renderWallList();
}

// ---------- the wall window's tabs ----------
// Size (length, thickness, breaking, ceiling) · Openings · Fixtures · Photos.
// The last tab used is remembered while the app's open.

export function setWallTab(name) {
  ui.wallTab = name;
  document.querySelectorAll('#wallTabs .wall-tab').forEach((t) => {
    t.classList.toggle('selected', t.dataset.tab === name);
    t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  });
  document.querySelectorAll('#wallPanel .wall-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
  renderWallTabCounts();
}

export function renderWallTabCounts() {
  const wall = panelWall();
  if (!wall) return;
  const room = activeRoom();
  const counts = {
    openings: (wall.openings || []).length,
    fixtures: (wall.fixtures || []).reduce((sum, f) => sum + (f.qty || 1), 0),
    photos: (room.photos || []).filter((p) => p.wallId === wall.id).length,
  };
  document.querySelectorAll('#wallTabs .wall-tab').forEach((t) => {
    const n = counts[t.dataset.tab];
    const base = { size: 'Size', openings: 'Openings', fixtures: 'Fixtures', photos: 'Photos' }[t.dataset.tab];
    t.textContent = n ? `${base} ${n}` : base;
  });
}
