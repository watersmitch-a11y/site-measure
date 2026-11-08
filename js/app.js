import * as geo from './geometry.js';
import * as units from './units.js';
import * as store from './storage.js';
import { renderPlan, fitViewBox } from './render.js';
import { buildLengthInput, readLength, setLength } from './length-input.js';
import * as op from './openings.js';
import * as rm from './rooms.js';
import { exportPlan } from './export.js';

// Shown at the foot of the page; keep in step with CACHE_NAME in service-worker.js.
const APP_VERSION = 28;

const $ = (sel) => document.querySelector(sel);
const uid = () => `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const state = {
  jobId: null,
  jobName: 'Untitled Job',
  unit: 'mm',
  rooms: [rm.newRoom()],
  activeRoomId: null,
};
state.activeRoomId = state.rooms[0].id;

// The wall-entry, openings and ceiling code all work on the active room;
// these aliases keep that code reading as state.walls / state.ceilingHeightM.
function activeRoom() {
  return state.rooms.find((r) => r.id === state.activeRoomId) || state.rooms[0];
}
Object.defineProperties(state, {
  walls: {
    get: () => activeRoom().walls,
    set: (v) => { activeRoom().walls = v; },
  },
  ceilingHeightM: {
    get: () => activeRoom().ceilingHeightM,
    set: (v) => { activeRoom().ceilingHeightM = v; },
  },
});

function allWalls() {
  return state.rooms.flatMap((r) => r.walls);
}

function roomIndex(room) {
  return state.rooms.indexOf(room);
}

function geometryOf(room) {
  return rm.roomGeometry(state.rooms).get(room.id);
}

function activeLabel() {
  return rm.roomLabel(activeRoom(), roomIndex(activeRoom()));
}

const ui = {
  selectedHeading: null, // direction on the plan in degrees (0 up, 90 right…), or 'custom'
  customSide: 'left',
  editingId: null,
  panelWallId: null, // wall whose details panel is open
  editingOpeningId: null,
  openingType: 'door',
  openingCorner: 'start',
  openingHinge: 'left',
  openingSwing: 'in',
  placingRoom: false, // waiting for a tap on the plan to start a new room
  placement: null, // the shared wall tapped, while the new-room sheet is open
  placementEdited: false, // start/length typed over, so thickness changes leave them
  moving: null, // { roomId, before, drag, viewBox } while a room is being moved
  view: null, // zoomed-in view { x, y, w } (a square, in plan metres); null = whole plan
  pinch: null, // two-finger zoom in progress
  pan: null, // one-finger pan of a zoomed plan in progress
  suppressClick: false, // a pinch or pan just ended, so the tap that follows isn't a wall tap
};

const MEASURED_TO_KEY = 'siteMeasure.lastMeasuredTo';

const els = {
  jobName: $('#jobName'),
  unitSelect: $('#unitSelect'),
  jobsBtn: $('#jobsBtn'),
  newJobBtn: $('#newJobBtn'),
  saveJobBtn: $('#saveJobBtn'),
  planSvg: $('#planSvg'),
  statsBar: $('#statsBar'),
  entryTitle: $('#entryTitle'),
  directionSection: $('#directionSection'),
  dirPad: $('#dirPad'),
  directionLabel: $('#directionLabel'),
  customAngleLabel: $('#customAngleLabel'),
  customAngleSection: $('#customAngleSection'),
  lrToggle: $('#lrToggle'),
  customAngleInput: $('#customAngleInput'),
  presetChips: $('#presetChips'),
  lengthInputs: $('#lengthInputs'),
  matchChips: $('#matchChips'),
  wallForm: $('#wallForm'),
  addWallBtn: $('#addWallBtn'),
  wallList: $('#wallList'),
  undoBtn: $('#undoBtn'),
  closePolygonBtn: $('#closePolygonBtn'),
  jobsPanel: $('#jobsPanel'),
  jobsList: $('#jobsList'),
  closeJobsBtn: $('#closeJobsBtn'),
  ceilingInputs: $('#ceilingInputs'),
  wallPanel: $('#wallPanel'),
  wallPanelTitle: $('#wallPanelTitle'),
  closeWallPanelBtn: $('#closeWallPanelBtn'),
  wallCeilingInputs: $('#wallCeilingInputs'),
  openingList: $('#openingList'),
  addOpeningBtn: $('#addOpeningBtn'),
  openingForm: $('#openingForm'),
  openingFormTitle: $('#openingFormTitle'),
  openingTypeButtons: $('#openingTypeButtons'),
  measuredToSelect: $('#measuredToSelect'),
  cornerToggle: $('#cornerToggle'),
  sillSection: $('#sillSection'),
  doorSection: $('#doorSection'),
  hingeToggle: $('#hingeToggle'),
  swingToggle: $('#swingToggle'),
  openingNote: $('#openingNote'),
  openingError: $('#openingError'),
  cancelOpeningBtn: $('#cancelOpeningBtn'),
  roomTabs: $('#roomTabs'),
  roomName: $('#roomName'),
  deleteRoomBtn: $('#deleteRoomBtn'),
  roomAnchorNote: $('#roomAnchorNote'),
  anchorFormNote: $('#anchorFormNote'),
  roomPanel: $('#roomPanel'),
  closeRoomPanelBtn: $('#closeRoomPanelBtn'),
  sharedStartLabel: $('#sharedStartLabel'),
  exportBtn: $('#exportBtn'),
  appVersion: $('#appVersion'),
  zoomInBtn: $('#zoomInBtn'),
  zoomOutBtn: $('#zoomOutBtn'),
  zoomFitBtn: $('#zoomFitBtn'),
  moveRoomBtn: $('#moveRoomBtn'),
  panelMoveRoomBtn: $('#panelMoveRoomBtn'),
  panelLengthInputs: $('#panelLengthInputs'),
  keepClosedRow: $('#keepClosedRow'),
  keepClosedSelect: $('#keepClosedSelect'),
  panelLengthError: $('#panelLengthError'),
  updateLengthBtn: $('#updateLengthBtn'),
  moveBar: $('#moveBar'),
  moveTitle: $('#moveTitle'),
  moveDimsRef: $('#moveDimsRef'),
  moveAlongEnd: $('#moveAlongEnd'),
  moveGapInputs: $('#moveGapInputs'),
  moveAlongInputs: $('#moveAlongInputs'),
  nudgePad: $('#nudgePad'),
  nudgeStep: $('#nudgeStep'),
  rotateLeftBtn: $('#rotateLeftBtn'),
  rotateRightBtn: $('#rotateRightBtn'),
  matchDoorBtn: $('#matchDoorBtn'),
  cancelMoveBtn: $('#cancelMoveBtn'),
  doneMoveBtn: $('#doneMoveBtn'),
  doorMatchPanel: $('#doorMatchPanel'),
  closeDoorMatchBtn: $('#closeDoorMatchBtn'),
  doorHereSelect: $('#doorHereSelect'),
  doorThereSelect: $('#doorThereSelect'),
  doorMatchError: $('#doorMatchError'),
  cancelDoorMatchBtn: $('#cancelDoorMatchBtn'),
  applyDoorMatchBtn: $('#applyDoorMatchBtn'),
  placeBanner: $('#placeBanner'),
  cancelPlaceBtn: $('#cancelPlaceBtn'),
  placeSummary: $('#placeSummary'),
  planWrap: $('.plan-wrap'),
  roomError: $('#roomError'),
  cancelRoomBtn: $('#cancelRoomBtn'),
  createRoomBtn: $('#createRoomBtn'),
};

function normalizeAngle180(a) {
  let x = a % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

function headingName(angle) {
  const a = ((angle % 360) + 360) % 360;
  if (Math.abs(a - 0) < 0.01) return 'Up';
  if (Math.abs(a - 90) < 0.01) return 'Right';
  if (Math.abs(a - 180) < 0.01) return 'Down';
  if (Math.abs(a - 270) < 0.01) return 'Left';
  return `${a.toFixed(0)}°`;
}

// True when Wall 1's direction comes from how the room was placed rather than
// the arrows: rooms attached along a wall before tap-to-place existed, and
// rooms pinned in place after their host was deleted.
function startHeadingFixed() {
  const anchor = activeRoom().anchor;
  if (!anchor) return false;
  if (anchor.type === 'wall') return !anchor.sides && !anchor.shared;
  return anchor.type === 'fixed' && anchor.heading != null;
}

function anchorDescription(room) {
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

const ARROWS = { Up: '↑', Right: '→', Down: '↓', Left: '←' };

function describeWall(wall, index) {
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

// ---------- length input rendering ----------

function buildLengthInputs() {
  buildLengthInput(els.lengthInputs, state.unit, 'len');
}

function readLengthMeters() {
  return readLength(state.unit, 'len');
}

function buildCeilingInput() {
  buildLengthInput(els.ceilingInputs, state.unit, 'ceil', state.unit === 'mm' ? 'e.g. 2700' : undefined);
  setLength(state.unit, 'ceil', state.ceilingHeightM);
}

function clearLengthInputs() {
  buildLengthInputs();
}

// ---------- direction UI ----------
// Each wall is picked by its direction on the plan (the arrow pad) and stored
// as a turn from the previous wall; Wall 1 stores its direction outright.

function wallHeadings() {
  const frame = rm.computeFrames(state.rooms).get(activeRoom().id);
  return geo.computeHeadings(state.walls, frame.heading);
}

// Index of the wall being entered: the one being edited, or the next new one.
function entryIndex() {
  return ui.editingId ? state.walls.findIndex((w) => w.id === ui.editingId) : state.walls.length;
}

// Direction of the wall before the one being entered, or null for Wall 1.
function previousHeading() {
  const idx = entryIndex();
  return idx > 0 ? wallHeadings()[idx - 1] : null;
}

function setSelectedHeading(h) {
  ui.selectedHeading = h;
  [...els.dirPad.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.heading === String(h));
  });
  els.customAngleSection.classList.toggle('hidden', h !== 'custom');
  renderMatchChips();
}

// Direction on the plan of the wall being entered, from the arrows or Angle.
function selectedAbsoluteHeading() {
  const angle = currentWallAngle();
  if (angle == null) return null;
  const prev = previousHeading();
  return prev == null ? angle : prev + angle;
}

// Offer the length of walls running the opposite way (e.g. Wall 1 when
// entering Wall 3 of a rectangle), newest first, so only length and width
// need measuring.
function renderMatchChips() {
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
}

// Clear runs from the corner the next wall starts at to the nearest other
// room's wall: the chosen direction only, or every square direction until
// one is chosen. Lets a room be drawn to fill a gap between rooms.
function gapDims() {
  const room = activeRoom();
  if (!room || ui.moving || ui.placingRoom || ui.placement) return [];
  const g = geometryOf(room);
  if (!ui.editingId && rm.roomClosed(room, g)) return [];
  const from = g.points[entryIndex()];
  if (!from) return [];
  const chosen = selectedAbsoluteHeading();
  const prev = previousHeading();
  const headings = chosen != null
    ? [chosen]
    : [0, 90, 180, 270].filter((h) => prev == null || Math.abs(Math.abs(normalizeAngle180(h - prev)) - 180) > 0.01);
  const geom = rm.roomGeometry(state.rooms);
  return headings.map((h) => {
    const run = rm.clearRunTo(state.rooms, geom, room.id, from, h);
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

function addMatchChip(label, lengthM) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip match';
  btn.dataset.lengthM = lengthM;
  btn.textContent = `= ${label} · ${units.formatLength(lengthM, state.unit)}`;
  els.matchChips.appendChild(btn);
}

// Grey out the arrow that would double straight back along the previous wall.
function updateDirPad() {
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

function setCustomSide(side) {
  ui.customSide = side;
  [...els.lrToggle.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.side === side);
  });
}

// The angle to store for the wall being entered, or null if no valid direction.
function currentWallAngle() {
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

// ---------- rendering ----------

function render() {
  els.jobName.value = state.jobName;
  els.unitSelect.value = state.unit;

  const idx = entryIndex();
  const firstWallEntry = idx === 0;
  els.directionSection.classList.toggle('hidden', firstWallEntry && startHeadingFixed());
  els.directionLabel.textContent = `Direction of Wall ${idx + 1} on the plan`;
  updateDirPad();
  renderMatchChips();
  const anchorText = anchorDescription(activeRoom());
  els.anchorFormNote.textContent = anchorText;
  els.anchorFormNote.classList.toggle('hidden', !(firstWallEntry && anchorText));

  renderEntryTitle();
  els.addWallBtn.textContent = ui.editingId ? 'Update Wall' : 'Add Wall';

  renderRoomTabs();
  renderRoomCard();
  drawPlan();
  updateMoveDims();
  renderStats();
  renderWallList();
  els.closePolygonBtn.classList.toggle('hidden', state.walls.length < rm.minWallsToClose(activeRoom()));
}

// ---------- plan view and zoom ----------

function drawPlan() {
  let viewBox = ui.moving && ui.moving.viewBox;
  if (!viewBox && ui.view) viewBox = { x: ui.view.x, y: ui.view.y, width: ui.view.w, height: ui.view.w };
  renderPlan(els.planSvg, state.rooms, state.unit, {
    activeRoomId: state.activeRoomId,
    selectedWallId: ui.panelWallId,
    previewLine: previewLine(),
    gapDims: gapDims(),
    viewBox,
  });
  els.planWrap.classList.toggle('zoomed', !!ui.view);
  els.zoomFitBtn.classList.toggle('hidden', !ui.view);
}

// The square of the plan currently on screen (the plan box is square, and the
// whole-plan view is centred in it), so a screen fraction maps straight to it.
function shownView() {
  if (ui.view) return { ...ui.view };
  const fit = fitViewBox(state.rooms);
  const w = Math.max(fit.width, fit.height);
  return { x: fit.x - (w - fit.width) / 2, y: fit.y - (w - fit.height) / 2, w };
}

function clampViewWidth(w) {
  const fit = fitViewBox(state.rooms);
  return Math.min(Math.max(w, 0.5), Math.max(fit.width, fit.height) * 1.5);
}

// Zoom by `factor` keeping the plan point at screen fraction (fx, fy) still.
function zoomAt(fx, fy, factor) {
  const v = shownView();
  const px = v.x + fx * v.w;
  const py = v.y + fy * v.w;
  const w = clampViewWidth(v.w / factor);
  ui.view = { x: px - fx * w, y: py - fy * w, w };
  drawPlan();
}

function zoomFit() {
  ui.view = null;
  drawPlan();
}

function planFraction(clientX, clientY) {
  const r = els.planSvg.getBoundingClientRect();
  return { fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, r };
}

function renderEntryTitle() {
  const nextIndex = ui.editingId
    ? state.walls.findIndex((w) => w.id === ui.editingId)
    : state.walls.length;
  const roomPrefix = state.rooms.length > 1 ? `${activeLabel()} – ` : '';
  els.entryTitle.textContent = ui.editingId
    ? `${roomPrefix}Editing Wall ${nextIndex + 1}`
    : `${roomPrefix}Wall ${nextIndex + 1}`;
}

function renderStats() {
  els.statsBar.innerHTML = '';
  const room = activeRoom();
  const g = geometryOf(room);
  const perim = rm.roomPerimeter(state.rooms, room);
  addPill(`Perimeter: <strong>${units.formatLength(perim, state.unit)}</strong>`);

  const a = rm.roomArea(room, g);
  if (a != null) addPill(`Area: <strong>${units.formatArea(a, state.unit)}</strong>`);

  if (state.walls.length >= rm.minWallsToClose(room)) {
    const gap = rm.closingGap(room, g);
    if (gap > 0.05) {
      addPill(`Gap to close: <strong>${units.formatLength(gap, state.unit)}</strong>`, true);
    } else {
      addPill(`Closed ✓`);
    }
  }

  const areas = op.wallAreas(state.walls, state.ceilingHeightM);
  const sharedArea = rm.sharedWallArea(state.rooms, room, state.ceilingHeightM);
  if (areas.wallsCounted > 0 || sharedArea > 0) {
    const partial = areas.wallsCounted < state.walls.length ? ' (some walls)' : '';
    addPill(`Wall area net: <strong>${units.formatArea(areas.net + sharedArea, state.unit)}</strong>${partial}`);
  }

  const geom = rm.roomGeometry(state.rooms);
  const measuredRooms = state.rooms.filter((r) => rm.roomArea(r, geom.get(r.id)) != null);
  if (state.rooms.length > 1 && measuredRooms.length > 0) {
    const total = measuredRooms.reduce((sum, r) => sum + rm.roomArea(r, geom.get(r.id)), 0);
    addPill(`Job total: <strong>${units.formatArea(total, state.unit)}</strong> (${measuredRooms.length} rooms)`);
  }
}

function addPill(html, warn = false) {
  const pill = document.createElement('div');
  pill.className = 'stat-pill' + (warn ? ' warn' : '');
  pill.innerHTML = html;
  els.statsBar.appendChild(pill);
}

function renderWallList() {
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
    if (wall.ceilingHeightM) extras.push(`ceiling ${units.formatLength(wall.ceilingHeightM, state.unit)}`);
    const warn = openings.some((o) => !op.fitsOnWall(wall, o)) ? ' <span class="warn-text">⚠ check openings</span>' : '';
    li.innerHTML = `
      <div class="wall-idx">${i + 1}</div>
      <div class="wall-info" data-id="${wall.id}">
        <div class="wall-len">${units.formatLength(wall.lengthM, state.unit)}</div>
        <div class="wall-dir">${extras.join(' · ')}${warn}</div>
        <div class="wall-hint">${openings.length ? 'Tap to edit openings' : 'Tap to add openings'} ›</div>
      </div>
      <button class="edit-btn" data-id="${wall.id}" title="Edit">&#9998;</button>
      <button class="delete-btn" data-id="${wall.id}" title="Delete">&#128465;</button>
    `;
    els.wallList.appendChild(li);
  });
}

// ---------- actions ----------

function resetEntryForm() {
  ui.editingId = null;
  setSelectedHeading(null);
  setCustomSide('left');
  els.customAngleInput.value = '';
  [...els.presetChips.children].forEach((c) => c.classList.remove('selected'));
  clearLengthInputs();
}

function persist() {
  if (!state.jobId) state.jobId = store.newJobId();
  store.saveJob({
    id: state.jobId,
    name: state.jobName,
    unit: state.unit,
    rooms: state.rooms,
    activeRoomId: state.activeRoomId,
  });
}

function handleAddWall() {
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
    // keep the walls after this one pointing the same way on the plan
    const before = wallHeadings();
    state.walls[editIdx] = { ...state.walls[editIdx], lengthM, angle };
    const next = state.walls[editIdx + 1];
    if (next) {
      const delta = wallHeadings()[editIdx] - before[editIdx];
      next.angle = normalizeAngle180(next.angle - delta);
    }
  } else {
    state.walls.push({ id: uid(), lengthM, angle });
  }

  settleSharedStart(activeRoom());
  resetEntryForm();
  persist();
  render();
}

// A shared-wall room can be walked from either end of the shared wall. Once
// the walls show which way it goes, start it from whichever end its walls
// lead back towards (so Complete Perimeter closes along the shared wall
// rather than across the room).
function settleSharedStart(room) {
  const anchor = room.anchor;
  if (!anchor || !anchor.shared || room.walls.length < 2) return;
  const gapNow = rm.closingGap(room, geometryOf(room));
  if (gapNow <= 0.05) return;
  anchor.reversed = !anchor.reversed;
  const gapFlipped = rm.closingGap(room, geometryOf(room));
  if (gapFlipped >= gapNow - 0.01) anchor.reversed = !anchor.reversed;
}

function flashInvalid() {
  els.addWallBtn.classList.add('invalid-shake');
  setTimeout(() => els.addWallBtn.classList.remove('invalid-shake'), 300);
}

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'jobs-panel confirm-overlay';
    overlay.innerHTML = `
      <div class="jobs-panel-inner confirm-inner">
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button type="button" class="secondary-btn confirm-cancel">Cancel</button>
          <button type="button" class="primary-btn confirm-ok">Confirm</button>
        </div>
      </div>`;
    overlay.querySelector('.confirm-message').textContent = message;
    document.body.appendChild(overlay);
    const finish = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => finish(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}

function handleUndo() {
  if (state.walls.length === 0) return;
  const lastId = state.walls[state.walls.length - 1].id;
  rm.pinAttachedRooms(state.rooms, (a) => a.wallId === lastId || !!(a.sides && lastId in a.sides));
  const removed = state.walls.pop();
  ui.editingId = null;
  if (ui.panelWallId === removed.id) closeWallPanel();
  persist();
  render();
}

function handleEditWall(id) {
  const idx = state.walls.findIndex((w) => w.id === id);
  if (idx < 0) return;
  const wall = state.walls[idx];
  ui.editingId = id;
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

async function handleDeleteWall(id) {
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
function handleClosePolygon() {
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

async function handleNewJob() {
  if (ui.moving) endMove(true);
  ui.view = null;
  if (allWalls().length > 0) {
    const ok = await showConfirm('Start a new job? Current job is already auto-saved.');
    if (!ok) return;
  }
  state.jobId = null;
  state.jobName = 'Untitled Job';
  state.rooms = [rm.newRoom()];
  state.activeRoomId = state.rooms[0].id;
  closeWallPanel();
  resetEntryForm();
  buildCeilingInput();
  render();
}

// Loads a saved job into state. Jobs saved before rooms existed had a single
// wall list on the job itself; they become a one-room job.
function applyJob(job) {
  state.jobId = job.id;
  state.jobName = job.name;
  state.unit = job.unit || 'mm';
  if (Array.isArray(job.rooms) && job.rooms.length > 0) {
    state.rooms = job.rooms;
  } else {
    const room = rm.newRoom();
    room.ceilingHeightM = job.ceilingHeightM || null;
    room.walls = job.walls || [];
    state.rooms = [room];
  }
  rm.migrateSharedWallRooms(state.rooms);
  state.activeRoomId = state.rooms.some((r) => r.id === job.activeRoomId)
    ? job.activeRoomId
    : state.rooms[0].id;
}

function handleSaveJob() {
  persist();
  els.saveJobBtn.textContent = 'Saved!';
  setTimeout(() => (els.saveJobBtn.textContent = 'Save'), 1000);
  renderJobsPanel();
}

function handleLoadJob(id) {
  if (ui.moving) endMove(true);
  ui.view = null;
  const job = store.loadJob(id);
  if (!job) return;
  applyJob(job);
  closeWallPanel();
  resetEntryForm();
  buildCeilingInput();
  render();
  els.jobsPanel.classList.add('hidden');
}

async function handleDeleteJob(id) {
  const ok = await showConfirm('Delete this saved job? This cannot be undone.');
  if (!ok) return;
  store.deleteJob(id);
  if (state.jobId === id) await handleNewJob();
  renderJobsPanel();
}

function renderJobsPanel() {
  const jobs = store.listJobs().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  els.jobsList.innerHTML = '';
  if (jobs.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-note';
    li.textContent = 'No saved jobs yet.';
    els.jobsList.appendChild(li);
    return;
  }
  jobs.forEach((job) => {
    const li = document.createElement('li');
    li.className = 'job-row-item';
    const date = new Date(job.updatedAt);
    li.innerHTML = `
      <div class="job-item-info">
        <div class="job-item-name">${escapeHtml(job.name)}</div>
        <div class="job-item-date">${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <button class="load-btn" data-id="${job.id}" title="Load">&#128194;</button>
      <button class="delete-btn" data-id="${job.id}" title="Delete">&#128465;</button>
    `;
    els.jobsList.appendChild(li);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- wall details panel (ceiling override + openings) ----------

function panelWall() {
  return state.walls.find((w) => w.id === ui.panelWallId) || null;
}

function isShapeClosed(room = activeRoom()) {
  return rm.roomClosed(room, geometryOf(room));
}

// What each end of a wall meets, e.g. "Wall 4", for the measure-from toggles.
function cornerLabels(idx, room = activeRoom()) {
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
const END_ARROWS = { left: '←', right: '→', top: '↑', bottom: '↓' };
const OPPOSITE_END = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

function planEnds(idx, room = activeRoom()) {
  const pts = geometryOf(room).points;
  const dx = pts[idx + 1].x - pts[idx].x;
  const dy = pts[idx + 1].y - pts[idx].y; // y runs down the plan
  const start = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom');
  return { start, end: OPPOSITE_END[start], first: start === 'left' || start === 'top' ? 'start' : 'end' };
}

// Which side of the room a wall is on as seen on the plan (top, left, …), so
// it can be told apart while the panel covers the plan.
function roomSide(idx, room = activeRoom()) {
  const pts = geometryOf(room).points;
  const dx = pts[idx + 1].x - pts[idx].x;
  const dy = pts[idx + 1].y - pts[idx].y;
  const out = -rm.insideSign(pts); // outward normal is (-dy, dx) * out
  const ox = -dy * out;
  const oy = dx * out;
  return Math.abs(ox) >= Math.abs(oy) ? (ox > 0 ? 'right' : 'left') : (oy > 0 ? 'bottom' : 'top');
}

function formatSize(widthM, heightM) {
  if (state.unit === 'mm') {
    return `${Math.round(units.metersToMm(widthM))} × ${Math.round(units.metersToMm(heightM))} mm`;
  }
  return `${units.formatLength(widthM, state.unit)} × ${units.formatLength(heightM, state.unit)}`;
}

function openWallPanel(id) {
  const idx = state.walls.findIndex((w) => w.id === id);
  if (idx < 0) return;
  const wall = state.walls[idx];
  els.panelMoveRoomBtn.textContent = `Move ${activeLabel()}`;
  els.panelMoveRoomBtn.classList.toggle('hidden', !canMove(activeRoom()));
  ui.panelWallId = id;
  const roomPrefix = state.rooms.length > 1 ? `${activeLabel()} – ` : '';
  const side = roomSide(idx);
  els.wallPanelTitle.textContent =
    `${roomPrefix}${side.charAt(0).toUpperCase()}${side.slice(1)} wall – ${units.formatLength(wall.lengthM, state.unit)}`;
  buildLengthInput(els.panelLengthInputs, state.unit, 'panelLen');
  setLength(state.unit, 'panelLen', wall.lengthM);
  els.panelLengthError.classList.add('hidden');
  fillKeepClosed();
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
  els.wallPanel.classList.remove('hidden');
  render();
}

// ---------- changing a finished wall's length ----------
// In a closed room a longer or shorter wall leaves a gap the same size, along
// that wall's line. A wall running the opposite way can grow by the same
// amount (or one running the same way can shrink) to close it again.

function closingPartners(room, idx) {
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

function fillKeepClosed() {
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

function handleUpdateLength() {
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
  wall.lengthM = newLen;
  if (partner) partner.w.lengthM += partner.sign * delta;
  settleSharedStart(room);
  persist();
  openWallPanel(wall.id); // refresh the title, figures and choices
}

function closeWallPanel() {
  ui.panelWallId = null;
  hideOpeningForm();
  els.wallPanel.classList.add('hidden');
}

function renderOpeningList() {
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

function setOpeningType(type) {
  ui.openingType = type;
  [...els.openingTypeButtons.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.type === type);
  });
  els.sillSection.classList.toggle('hidden', !(type === 'window' || type === 'other'));
  els.doorSection.classList.toggle('hidden', type !== 'door');
}

function setToggle(container, attr, value) {
  [...container.children].forEach((btn) => btn.classList.toggle('selected', btn.dataset[attr] === value));
}

function setOpeningHinge(hinge) {
  ui.openingHinge = hinge;
  setToggle(els.hingeToggle, 'hinge', hinge);
}

function setOpeningSwing(swing) {
  ui.openingSwing = swing;
  setToggle(els.swingToggle, 'swing', swing);
}

function setOpeningCorner(corner) {
  ui.openingCorner = corner;
  [...els.cornerToggle.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.corner === corner);
  });
}

function showOpeningForm(opening) {
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

function hideOpeningForm() {
  ui.editingOpeningId = null;
  els.openingForm.classList.add('hidden');
  els.addOpeningBtn.classList.remove('hidden');
}

function showOpeningError(message) {
  els.openingError.textContent = message;
  els.openingError.classList.remove('hidden');
}

function handleSaveOpening() {
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

async function handleDeleteOpening(id) {
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

// ---------- rooms ----------

function renderRoomTabs() {
  els.roomTabs.innerHTML = '';
  state.rooms.forEach((room, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'room-tab' + (room.id === state.activeRoomId ? ' selected' : '');
    btn.dataset.roomId = room.id;
    btn.textContent = rm.roomLabel(room, i);
    els.roomTabs.appendChild(btn);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'room-tab add';
  add.dataset.addRoom = '1';
  add.textContent = '+ Room';
  els.roomTabs.appendChild(add);
}

function renderRoomCard() {
  const room = activeRoom();
  if (document.activeElement !== els.roomName) els.roomName.value = room.name || '';
  els.roomName.placeholder = `Room ${roomIndex(room) + 1}`;
  els.deleteRoomBtn.classList.toggle('hidden', state.rooms.length < 2);
  els.moveRoomBtn.classList.toggle('hidden', !canMove(room) || !!ui.moving);
  const anchorText = anchorDescription(room);
  els.roomAnchorNote.textContent = anchorText;
  els.roomAnchorNote.classList.toggle('hidden', !anchorText);
}

function setActiveRoom(id) {
  if (!state.rooms.some((r) => r.id === id)) return;
  if (ui.moving) endMove(true);
  state.activeRoomId = id;
  closeWallPanel();
  resetEntryForm();
  buildCeilingInput();
  persist();
  render();
}

// ---------- moving a room ----------
// Rooms that aren't attached to another room's wall can be dragged, nudged
// and turned, or lined up with another room by a doorway measured in both.

function canMove(room) {
  return room.walls.length > 0 && (!room.anchor || room.anchor.type === 'fixed');
}

function startMove() {
  const room = activeRoom();
  if (!canMove(room)) return;
  closeWallPanel();
  ui.moving = { roomId: room.id, before: JSON.stringify({ anchor: room.anchor, first: room.walls[0].angle }) };
  if (!room.anchor) room.anchor = { type: 'fixed', x: 0, y: 0, heading: null };
  els.moveTitle.textContent = `Moving ${activeLabel()}: drag it on the plan, or nudge it`;
  els.moveBar.classList.remove('hidden');
  els.planWrap.classList.add('moving');
  render();
  els.moveBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function endMove(keep) {
  const moving = ui.moving;
  if (!moving) return;
  const room = state.rooms.find((r) => r.id === moving.roomId);
  if (room && !keep) {
    const before = JSON.parse(moving.before);
    room.anchor = before.anchor;
    if (room.walls[0]) room.walls[0].angle = before.first;
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
function updateMoveDims() {
  const room = movingRoom();
  if (!room) return;
  const ref = rm.nearestFacingWall(state.rooms, rm.roomGeometry(state.rooms), room.id);
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

function applyMoveDim(which) {
  const room = movingRoom();
  const ref = ui.moving && ui.moving.ref;
  if (!room || !ref) return;
  const opts = { allowZero: true, allowNegative: true };
  const value = readLength(state.unit, which === 'gap' ? 'mvGap' : 'mvAlong', opts);
  if (value == null) return;
  const [dir, now] = which === 'gap' ? [ref.n, ref.gap] : [ref.dir, ref.along];
  shiftRoom(room, dir.x * (value - now), dir.y * (value - now));
  render();
}

function movingRoom() {
  return ui.moving && state.rooms.find((r) => r.id === ui.moving.roomId);
}

const round3 = (v) => Math.round(v * 1000) / 1000; // to the millimetre

function shiftRoom(room, dx, dy) {
  room.anchor.x = round3(room.anchor.x + dx);
  room.anchor.y = round3(room.anchor.y + dy);
}

// Turn a room by deg (clockwise on the plan) about its start point.
function turnRoom(room, deg) {
  const norm = (a) => ((a % 360) + 360) % 360;
  if (room.anchor.heading != null) room.anchor.heading = norm(room.anchor.heading + deg);
  else room.walls[0].angle = norm(room.walls[0].angle + deg);
}

function roomCentre(room) {
  const pts = geometryOf(room).points;
  return {
    x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
    y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
  };
}

// The rotate buttons turn the room about its middle so it stays in view.
function rotateMoving(deg) {
  const room = movingRoom();
  if (!room) return;
  const before = roomCentre(room);
  turnRoom(room, deg);
  const after = roomCentre(room);
  shiftRoom(room, before.x - after.x, before.y - after.y);
  render();
}

// Doorways (doors and plain openings) on a room's walls.
function doorwaysOf(room) {
  const tags = op.openingTags(allWalls());
  return room.walls.flatMap((wall, wallIdx) => (wall.openings || [])
    .filter((o) => o.type === 'door' || o.type === 'opening')
    .map((o) => ({ room, wall, wallIdx, opening: o, tag: tags[o.id] })));
}

function doorwayLabel(d, withRoom) {
  const where = `${roomSide(d.wallIdx, d.room)} wall`;
  const room = withRoom ? `${rm.roomLabel(d.room, roomIndex(d.room))} · ` : '';
  return `${room}${d.tag} ${op.OPENING_TYPES[d.opening.type].label.toLowerCase()} ` +
    `${units.formatLength(d.opening.widthM, state.unit)}, ${where}`;
}

function openDoorMatch() {
  const room = movingRoom();
  if (!room) return;
  const here = doorwaysOf(room);
  const there = state.rooms.filter((r) => r !== room).flatMap(doorwaysOf);
  const fill = (select, list, withRoom) => {
    select.innerHTML = '';
    list.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.opening.id;
      opt.textContent = doorwayLabel(d, withRoom);
      select.appendChild(opt);
    });
  };
  fill(els.doorHereSelect, here, false);
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

function findDoorway(openingId) {
  return state.rooms.flatMap(doorwaysOf).find((d) => d.opening.id === openingId) || null;
}

// Outward normal of a room's wall, and the middle of a doorway in it.
function outwardNormal(room, wallIdx) {
  const pts = geometryOf(room).points;
  const dx = pts[wallIdx + 1].x - pts[wallIdx].x;
  const dy = pts[wallIdx + 1].y - pts[wallIdx].y;
  const len = Math.hypot(dx, dy) || 1;
  const out = -rm.insideSign(pts);
  return { x: (-dy / len) * out, y: (dx / len) * out };
}

function doorwayCentre(d) {
  const pts = geometryOf(d.room).points;
  const a = pts[d.wallIdx];
  const b = pts[d.wallIdx + 1];
  const span = op.openingSpan(d.wall, d.opening);
  const t = (span.startM + span.endM) / 2 / (d.wall.lengthM || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function handleDoorMatch() {
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
  if (Math.abs(turn) > 0.01) turnRoom(room, Math.round(turn * 100) / 100);
  // 2. slide it so the doorways line up, the wall thickness apart
  const from = doorwayCentre(findDoorway(here.opening.id));
  const to = doorwayCentre(there);
  shiftRoom(room, to.x + nThere.x * thick - from.x, to.y + nThere.y * thick - from.y);
  els.doorMatchPanel.classList.add('hidden');
  render();
}

// ---------- placing a new room by tapping the plan ----------

function startPlacing() {
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
  els.placeBanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stopPlacing() {
  ui.placingRoom = false;
  ui.placement = null;
  els.placeBanner.classList.add('hidden');
  els.planWrap.classList.remove('placing');
  els.roomPanel.classList.add('hidden');
}

function svgPoint(e) {
  const ctm = els.planSvg.getScreenCTM();
  return ctm ? new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse()) : null;
}

// A tap on the plan while adding a room: the nearest wall within reach is the
// shared wall, and the side of it tapped is where the new room goes. Open
// space starts a separate room there.
function placementFromTap(pt) {
  const pointsById = rm.computeRoomPoints(state.rooms);
  const vb = els.planSvg.viewBox.baseVal;
  const reach = Math.max(vb.width, vb.height) * 0.045; // a label's height, as in render.js
  let best = null;
  state.rooms.forEach((room) => {
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

function handlePlacementTap(e) {
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

function placementHost() {
  const p = ui.placement;
  const room = p && state.rooms.find((r) => r.id === p.roomId);
  const wallIdx = room ? room.walls.findIndex((w) => w.id === p.wallId) : -1;
  return wallIdx >= 0 ? { room, wallIdx, wall: room.walls[wallIdx] } : null;
}

// Fill the start and length fields with the shared part of the wall for the
// thickness entered (see rm.sharedWallSpan).
function fillSharedSpan() {
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

function openPlacementSheet() {
  const host = placementHost();
  if (!host) return;
  const ends = planEnds(host.wallIdx, host.room);
  els.sharedStartLabel.textContent = `${END_ARROWS[ends.start]} Shared part starts this far from the ${ends.start} end`;
  buildLengthInput($('#thicknessInputs'), state.unit, 'thick');
  setLength(state.unit, 'thick', rm.DEFAULT_WALL_THICKNESS_M);
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
function placementDraft() {
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
function previewLine() {
  const draft = ui.placement && placementDraft();
  if (!draft || !draft.lengthM) return null;
  const g = rm.roomGeometry([...state.rooms, { id: '__preview', walls: [], anchor: draft.anchor }]).get('__preview');
  return { x1: g.frame.x, y1: g.frame.y, x2: g.target.x, y2: g.target.y };
}

function closeRoomPanel() {
  els.roomPanel.classList.add('hidden');
  ui.placement = null;
  render();
}

function showRoomError(message) {
  els.roomError.textContent = message;
  els.roomError.classList.remove('hidden');
}

function handleCreateRoom() {
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

function createRoom(anchor, walls = []) {
  stopPlacing();
  const room = rm.newRoom(anchor);
  room.walls = walls;
  // ceiling heights rarely change through a job: start from the last one set
  const lastCeiling = [...state.rooms].reverse().find((r) => r.ceilingHeightM);
  room.ceilingHeightM = lastCeiling ? lastCeiling.ceilingHeightM : null;
  state.rooms.push(room);
  setActiveRoom(room.id);
  els.entryTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleDeleteRoom() {
  if (state.rooms.length < 2) return;
  const room = activeRoom();
  const ok = await showConfirm(`Delete ${activeLabel()} and all its walls and openings? This cannot be undone.`);
  if (!ok) return;
  rm.pinAttachedRooms(state.rooms, (a) => a.roomId === room.id);
  state.rooms = state.rooms.filter((r) => r.id !== room.id);
  setActiveRoom(state.rooms[0].id);
}

// ---------- event wiring ----------

els.jobName.addEventListener('change', () => {
  state.jobName = els.jobName.value || 'Untitled Job';
  persist();
});

els.unitSelect.addEventListener('change', () => {
  state.unit = els.unitSelect.value;
  buildLengthInputs();
  buildCeilingInput();
  if (ui.panelWallId) openWallPanel(ui.panelWallId);
  persist();
  render();
});

els.dirPad.addEventListener('click', (e) => {
  const btn = e.target.closest('.pad-btn');
  if (!btn || btn.disabled) return;
  setSelectedHeading(btn.dataset.heading === 'custom' ? 'custom' : Number(btn.dataset.heading));
  drawPlan(); // the gap dimension follows the chosen direction
});

els.lrToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (!btn) return;
  setCustomSide(btn.dataset.side);
  renderMatchChips();
  drawPlan();
});
els.customAngleInput.addEventListener('input', () => { renderMatchChips(); drawPlan(); });
els.matchChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip.match');
  if (!btn) return;
  setLength(state.unit, 'len', Number(btn.dataset.lengthM));
  [...els.matchChips.children].forEach((c) => c.classList.toggle('selected', c === btn));
});

els.presetChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  els.customAngleInput.value = btn.dataset.deg;
  [...els.presetChips.children].forEach((c) => c.classList.toggle('selected', c === btn));
  renderMatchChips();
});

els.wallForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleAddWall();
});
els.undoBtn.addEventListener('click', handleUndo);
els.closePolygonBtn.addEventListener('click', handleClosePolygon);
els.newJobBtn.addEventListener('click', handleNewJob);
els.saveJobBtn.addEventListener('click', handleSaveJob);
els.exportBtn.addEventListener('click', () => {
  if (allWalls().length === 0) return;
  persist();
  exportPlan({ name: state.jobName, unit: state.unit, rooms: state.rooms }, { planEnds });
});

els.wallList.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.edit-btn');
  const delBtn = e.target.closest('.delete-btn');
  const info = e.target.closest('.wall-info');
  if (editBtn) handleEditWall(editBtn.dataset.id);
  else if (delBtn) handleDeleteWall(delBtn.dataset.id);
  else if (info) openWallPanel(info.dataset.id);
});

els.jobsBtn.addEventListener('click', () => {
  renderJobsPanel();
  els.jobsPanel.classList.remove('hidden');
});
els.closeJobsBtn.addEventListener('click', () => els.jobsPanel.classList.add('hidden'));
els.jobsPanel.addEventListener('click', (e) => {
  if (e.target === els.jobsPanel) els.jobsPanel.classList.add('hidden');
  const loadBtn = e.target.closest('.load-btn');
  const delBtn = e.target.closest('.delete-btn');
  if (loadBtn) handleLoadJob(loadBtn.dataset.id);
  if (delBtn) handleDeleteJob(delBtn.dataset.id);
});

els.ceilingInputs.addEventListener('input', () => {
  state.ceilingHeightM = readLength(state.unit, 'ceil');
  renderStats();
});
els.ceilingInputs.addEventListener('change', persist);

// Shared walls of adjoining rooms sit a wall-thickness apart and their tap
// areas overlap, so pick the wall line nearest the tap, not the topmost one.
function nearestHitLine(e) {
  const ctm = els.planSvg.getScreenCTM();
  if (!ctm) return null;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  let best = null;
  let bestDist = Infinity;
  els.planSvg.querySelectorAll('.plan-hit').forEach((line) => {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => Number(line.getAttribute(a)));
    const lenSq = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((pt.x - x1) * (x2 - x1) + (pt.y - y1) * (y2 - y1)) / lenSq));
    const d = Math.hypot(pt.x - (x1 + t * (x2 - x1)), pt.y - (y1 + t * (y2 - y1)));
    if (d < bestDist && d <= Number(line.getAttribute('stroke-width')) / 2) {
      best = line;
      bestDist = d;
    }
  });
  return best;
}

// Two fingers pinch-zoom the plan; once zoomed in, one finger pans it (unless
// a room is being moved, when one finger drags the room). Not zoomed, one
// finger scrolls the page as usual.
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const touchMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

els.planSvg.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const view = shownView();
    const mid = touchMid(e.touches);
    const { fx, fy } = planFraction(mid.x, mid.y);
    ui.pinch = { dist: touchDist(e.touches), view, point: { x: view.x + fx * view.w, y: view.y + fy * view.w } };
    ui.pan = null;
    // a pinch while moving a room zooms instead: drop the drag and the view
    // it was holding still
    if (ui.moving) {
      ui.moving.drag = null;
      ui.moving.viewBox = null;
    }
  } else if (e.touches.length === 1 && ui.view && !ui.moving) {
    const t = e.touches[0];
    ui.pan = { x: t.clientX, y: t.clientY, view: { ...ui.view }, moved: false };
  }
}, { passive: false });

els.planSvg.addEventListener('touchmove', (e) => {
  if (ui.pinch && e.touches.length === 2) {
    e.preventDefault();
    const w = clampViewWidth(ui.pinch.view.w * (ui.pinch.dist / Math.max(touchDist(e.touches), 1)));
    const mid = touchMid(e.touches);
    const { fx, fy } = planFraction(mid.x, mid.y);
    ui.view = { x: ui.pinch.point.x - fx * w, y: ui.pinch.point.y - fy * w, w };
    drawPlan();
  } else if (ui.pan && e.touches.length === 1) {
    e.preventDefault();
    const t = e.touches[0];
    const { r } = planFraction(t.clientX, t.clientY);
    const perPx = ui.pan.view.w / r.width;
    ui.view = {
      x: ui.pan.view.x - (t.clientX - ui.pan.x) * perPx,
      y: ui.pan.view.y - (t.clientY - ui.pan.y) * perPx,
      w: ui.pan.view.w,
    };
    if (Math.hypot(t.clientX - ui.pan.x, t.clientY - ui.pan.y) > 8) ui.pan.moved = true;
    drawPlan();
  }
}, { passive: false });

els.planSvg.addEventListener('touchend', (e) => {
  if (ui.pinch && e.touches.length < 2) {
    ui.pinch = null;
    ui.suppressClick = true;
    if (ui.moving) ui.moving.viewBox = null;
  }
  if (ui.pan && e.touches.length === 0) {
    if (ui.pan.moved) ui.suppressClick = true;
    ui.pan = null;
  }
  // a click only follows straight away; don't let a stale flag eat a later tap
  setTimeout(() => { ui.suppressClick = false; }, 400);
});

// mouse wheel / trackpad zoom on a computer
els.planSvg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { fx, fy } = planFraction(e.clientX, e.clientY);
  zoomAt(fx, fy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

els.zoomInBtn.addEventListener('click', () => zoomAt(0.5, 0.5, 1.5));
els.zoomOutBtn.addEventListener('click', () => zoomAt(0.5, 0.5, 1 / 1.5));
els.zoomFitBtn.addEventListener('click', zoomFit);

// dragging a room while it's being moved; the view is held still meanwhile
// The room follows the finger's movement since it went down, scaled from
// screen pixels to plan metres once at the start, so nothing that shifts the
// page during the drag can make the room jump.
els.planSvg.addEventListener('pointerdown', (e) => {
  const room = movingRoom();
  if (!room || !e.isPrimary || ui.pinch) return; // only the first finger drags
  const vb = els.planSvg.viewBox.baseVal;
  const r = els.planSvg.getBoundingClientRect();
  ui.moving.viewBox = { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  ui.moving.drag = {
    clientX: e.clientX,
    clientY: e.clientY,
    metresPerPx: Math.max(vb.width / r.width, vb.height / r.height), // the view is fitted ('meet')
    x: room.anchor.x,
    y: room.anchor.y,
  };
  els.planSvg.setPointerCapture(e.pointerId);
});
let dragFrame = null;
els.planSvg.addEventListener('pointermove', (e) => {
  if (ui.pinch) return;
  const room = movingRoom();
  const drag = ui.moving && ui.moving.drag;
  if (!room || !drag) return;
  room.anchor.x = round3(drag.x + (e.clientX - drag.clientX) * drag.metresPerPx);
  room.anchor.y = round3(drag.y + (e.clientY - drag.clientY) * drag.metresPerPx);
  // redraw at most once per screen refresh
  if (dragFrame === null) {
    dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      render();
    });
  }
});
// Dropping a dragged room with a wall close to another room's wall snaps it
// to exactly a wall thickness apart, so the shared wall and doors merge.
const endDrag = () => {
  if (!ui.moving || !ui.moving.drag) return;
  ui.moving.drag = null;
  ui.moving.viewBox = null;
  const room = movingRoom();
  const snap = room && rm.snapOffset(state.rooms, rm.roomGeometry(state.rooms), room.id, rm.DEFAULT_WALL_THICKNESS_M);
  if (snap) shiftRoom(room, snap.dx, snap.dy);
  render();
};
els.planSvg.addEventListener('pointerup', endDrag);
els.planSvg.addEventListener('pointercancel', endDrag);

els.planSvg.addEventListener('click', (e) => {
  if (ui.suppressClick) {
    ui.suppressClick = false;
    return;
  }
  if (ui.moving) return;
  if (ui.placingRoom) {
    handlePlacementTap(e);
    return;
  }
  const hit = nearestHitLine(e);
  if (!hit) {
    // a tap inside a room, away from its walls, switches to that room
    const pt = svgPoint(e);
    const room = pt && roomAtPoint(pt);
    if (room && room.id !== state.activeRoomId) setActiveRoom(room.id);
    return;
  }
  if (hit.dataset.roomId !== state.activeRoomId) setActiveRoom(hit.dataset.roomId);
  openWallPanel(hit.dataset.wallId);
});

// The room whose floor contains a plan point (the smallest, if rooms overlap).
function roomAtPoint(pt) {
  const geom = rm.roomGeometry(state.rooms);
  let best = null;
  state.rooms.forEach((room) => {
    const pts = geom.get(room.id).points;
    if (pts.length < 3) return;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    const area = rm.polygonArea(pts);
    if (inside && (!best || area < best.area)) best = { room, area };
  });
  return best && best.room;
}

els.closeWallPanelBtn.addEventListener('click', () => {
  closeWallPanel();
  render();
});
els.wallPanel.addEventListener('click', (e) => {
  if (e.target === els.wallPanel) {
    closeWallPanel();
    render();
  }
});

els.wallCeilingInputs.addEventListener('input', () => {
  const wall = panelWall();
  if (!wall) return;
  const h = readLength(state.unit, 'wallCeil');
  if (h) wall.ceilingHeightM = h;
  else delete wall.ceilingHeightM;
  renderStats();
});
els.wallCeilingInputs.addEventListener('change', () => {
  persist();
  render();
});

els.addOpeningBtn.addEventListener('click', () => showOpeningForm(null));
els.panelLengthInputs.addEventListener('input', fillKeepClosed);
els.keepClosedSelect.addEventListener('change', () => {
  ui.keepClosedPick = { wallId: ui.panelWallId, value: els.keepClosedSelect.value };
});
els.updateLengthBtn.addEventListener('click', handleUpdateLength);
els.cancelOpeningBtn.addEventListener('click', hideOpeningForm);
els.openingTypeButtons.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-btn');
  if (btn) setOpeningType(btn.dataset.type);
});
els.cornerToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (btn) setOpeningCorner(btn.dataset.corner);
});
els.hingeToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (btn) setOpeningHinge(btn.dataset.hinge);
});
els.swingToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (btn) setOpeningSwing(btn.dataset.swing);
});
els.openingForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleSaveOpening();
});
els.openingList.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.edit-btn');
  const delBtn = e.target.closest('.delete-btn');
  const wall = panelWall();
  if (!wall) return;
  if (editBtn) showOpeningForm(wall.openings.find((o) => o.id === editBtn.dataset.opId));
  if (delBtn) handleDeleteOpening(delBtn.dataset.opId);
});

els.roomTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.room-tab');
  if (!btn) return;
  if (btn.dataset.addRoom) startPlacing();
  else setActiveRoom(btn.dataset.roomId);
});
// Only light updates here: re-rendering the wall list while the name box
// loses focus would swallow a tap on a wall row.
els.roomName.addEventListener('input', () => {
  activeRoom().name = els.roomName.value.trim();
  renderRoomTabs();
  renderEntryTitle();
  drawPlan();
});
els.roomName.addEventListener('change', persist);
els.deleteRoomBtn.addEventListener('click', handleDeleteRoom);
els.cancelPlaceBtn.addEventListener('click', () => {
  stopPlacing();
  render();
});
els.closeRoomPanelBtn.addEventListener('click', closeRoomPanel);
els.cancelRoomBtn.addEventListener('click', closeRoomPanel);
els.roomPanel.addEventListener('click', (e) => {
  if (e.target === els.roomPanel) closeRoomPanel();
});
// thickness changes re-work the shared part until it's been edited by hand
$('#thicknessInputs').addEventListener('input', () => {
  if (!ui.placementEdited) fillSharedSpan();
  render();
});
['#anchorOffsetInputs', '#sharedLengthInputs'].forEach((sel) => {
  $(sel).addEventListener('input', () => {
    ui.placementEdited = true;
    render();
  });
});
els.createRoomBtn.addEventListener('click', handleCreateRoom);

els.moveRoomBtn.addEventListener('click', startMove);
els.panelMoveRoomBtn.addEventListener('click', startMove); // startMove closes the wall panel
els.doneMoveBtn.addEventListener('click', () => endMove(true));
els.cancelMoveBtn.addEventListener('click', () => endMove(false));
els.rotateLeftBtn.addEventListener('click', () => rotateMoving(-90));
els.rotateRightBtn.addEventListener('click', () => rotateMoving(90));
els.nudgePad.addEventListener('click', (e) => {
  const btn = e.target.closest('button.pad-btn');
  const room = movingRoom();
  if (!btn || !room) return;
  const step = Number(els.nudgeStep.value);
  shiftRoom(room, Number(btn.dataset.dx) * step, Number(btn.dataset.dy) * step);
  render();
});
els.matchDoorBtn.addEventListener('click', openDoorMatch);
els.moveGapInputs.addEventListener('change', () => applyMoveDim('gap'));
els.moveAlongInputs.addEventListener('change', () => applyMoveDim('along'));
els.moveAlongEnd.addEventListener('change', updateMoveDims);
els.applyDoorMatchBtn.addEventListener('click', handleDoorMatch);
els.closeDoorMatchBtn.addEventListener('click', () => els.doorMatchPanel.classList.add('hidden'));
els.cancelDoorMatchBtn.addEventListener('click', () => els.doorMatchPanel.classList.add('hidden'));
els.doorMatchPanel.addEventListener('click', (e) => {
  if (e.target === els.doorMatchPanel) els.doorMatchPanel.classList.add('hidden');
});

// ---------- init ----------

function init() {
  buildLengthInputs();
  setSelectedHeading(null);
  setCustomSide('left');

  const jobs = store.listJobs();
  if (jobs.length > 0) {
    const mostRecent = [...jobs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    const job = store.loadJob(mostRecent.id);
    if (job) {
      applyJob(job);
      buildLengthInputs();
    }
  }

  buildCeilingInput();
  render();

  els.appVersion.textContent = `Site Measure v${APP_VERSION}`;
  registerServiceWorker();
}

// Keep an installed copy up to date: look for a new version on start and
// whenever the app comes back to the front, and reload once when one takes
// over, so changes show without closing the app by hand.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing old to replace
    reloading = true;
    persist();
    location.reload();
  });
  navigator.serviceWorker.register('service-worker.js').then((reg) => {
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

init();
