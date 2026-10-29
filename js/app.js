import * as geo from './geometry.js';
import * as units from './units.js';
import * as store from './storage.js';
import { renderPlan } from './render.js';
import { buildLengthInput, readLength, setLength } from './length-input.js';
import * as op from './openings.js';
import * as rm from './rooms.js';
import { exportPlan } from './export.js';

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
  if (anchor.type === 'wall') return !anchor.sides;
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
  const corners = cornerLabels(wallIdx, host.walls);
  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  const fmt = (m) => units.formatLength(m, state.unit);
  const hostName = `${rm.roomLabel(host, roomIndex(host))} · Wall ${wallIdx + 1}`;
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
    .forEach(({ w, i }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip match';
      btn.dataset.lengthM = w.lengthM;
      btn.textContent = `= Wall ${i + 1} · ${units.formatLength(w.lengthM, state.unit)}`;
      els.matchChips.appendChild(btn);
    });
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
  renderPlan(els.planSvg, state.rooms, state.unit, {
    activeRoomId: state.activeRoomId,
    selectedWallId: ui.panelWallId,
    previewLine: previewLine(),
  });
  renderStats();
  renderWallList();
  els.closePolygonBtn.classList.toggle('hidden', state.walls.length < 2);
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
  const perim = geo.perimeter(state.walls);
  addPill(`Perimeter: <strong>${units.formatLength(perim, state.unit)}</strong>`);

  if (state.walls.length >= 3) {
    const a = geo.area(state.walls);
    addPill(`Area: <strong>${units.formatArea(a, state.unit)}</strong>`);
  }

  if (state.walls.length >= 2) {
    const gap = geo.closingGap(state.walls);
    if (gap > 0.05) {
      addPill(`Gap to close: <strong>${units.formatLength(gap, state.unit)}</strong>`, true);
    } else {
      addPill(`Closed ✓`);
    }
  }

  const areas = op.wallAreas(state.walls, state.ceilingHeightM);
  if (areas.wallsCounted > 0) {
    const partial = areas.wallsCounted < state.walls.length ? ' (some walls)' : '';
    addPill(`Wall area net: <strong>${units.formatArea(areas.net, state.unit)}</strong>${partial}`);
  }

  const measuredRooms = state.rooms.filter((r) => r.walls.length >= 3);
  if (state.rooms.length > 1 && measuredRooms.length > 0) {
    const total = measuredRooms.reduce((sum, r) => sum + geo.area(r.walls), 0);
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

  resetEntryForm();
  persist();
  render();
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

function handleClosePolygon() {
  const closing = geo.closingWall(state.walls);
  if (!closing || closing.lengthM < 0.01) return;
  const headings = geo.computeHeadings(state.walls);
  const lastHeading = headings[headings.length - 1];
  const angle = normalizeAngle180(closing.heading - lastHeading);
  state.walls.push({ id: uid(), lengthM: closing.lengthM, angle });
  persist();
  render();
}

async function handleNewJob() {
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

function isShapeClosed(walls = state.walls) {
  return walls.length >= 3 && geo.closingGap(walls) <= 0.05;
}

// What each end of a wall meets, e.g. "Wall 4", for the measure-from toggles.
function cornerLabels(idx, walls = state.walls) {
  const n = walls.length;
  const closed = isShapeClosed(walls);
  const startWall = idx > 0 ? idx : closed ? n : null;
  const endWall = idx < n - 1 ? idx + 2 : closed ? 1 : null;
  return {
    start: startWall ? `Corner with Wall ${startWall}` : 'Start point',
    end: endWall ? `Corner with Wall ${endWall}` : 'Open end',
  };
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
  ui.panelWallId = id;
  const roomPrefix = state.rooms.length > 1 ? `${activeLabel()} – ` : '';
  els.wallPanelTitle.textContent = `${roomPrefix}Wall ${idx + 1} – ${units.formatLength(wall.lengthM, state.unit)}`;
  buildLengthInput(els.wallCeilingInputs, state.unit, 'wallCeil', 'Same as room');
  setLength(state.unit, 'wallCeil', wall.ceilingHeightM || null);
  const corners = cornerLabels(idx);
  els.cornerToggle.querySelector('[data-corner="start"]').textContent = corners.start;
  els.cornerToggle.querySelector('[data-corner="end"]').textContent = corners.end;
  hideOpeningForm();
  renderOpeningList();
  els.wallPanel.classList.remove('hidden');
  render();
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
  const corners = cornerLabels(state.walls.indexOf(wall));
  openings.forEach((o) => {
    const li = document.createElement('li');
    li.className = 'wall-row';
    const corner = o.fromCorner === 'end' ? corners.end : corners.start;
    const from = corner.charAt(0).toLowerCase() + corner.slice(1);
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
  setOpeningCorner(opening ? opening.fromCorner : 'start');
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
  const anchorText = anchorDescription(room);
  els.roomAnchorNote.textContent = anchorText;
  els.roomAnchorNote.classList.toggle('hidden', !anchorText);
}

function setActiveRoom(id) {
  if (!state.rooms.some((r) => r.id === id)) return;
  state.activeRoomId = id;
  closeWallPanel();
  resetEntryForm();
  buildCeilingInput();
  persist();
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
  const span = rm.sharedWallSpan(pts, host.room.walls, host.wallIdx, ui.placement.side, thick, isShapeClosed(host.room.walls));
  setLength(state.unit, 'anchorOff', Math.round(span.startM * 1000) / 1000);
  setLength(state.unit, 'sharedLen', Math.round(span.lengthM * 1000) / 1000);
}

function openPlacementSheet() {
  const host = placementHost();
  if (!host) return;
  const corners = cornerLabels(host.wallIdx, host.room.walls);
  const startCorner = corners.start.charAt(0).toLowerCase() + corners.start.slice(1);
  els.sharedStartLabel.textContent = `Shared part starts this far from ${startCorner}`;
  buildLengthInput($('#thicknessInputs'), state.unit, 'thick');
  setLength(state.unit, 'thick', rm.DEFAULT_WALL_THICKNESS_M);
  buildLengthInput($('#anchorOffsetInputs'), state.unit, 'anchorOff');
  buildLengthInput($('#sharedLengthInputs'), state.unit, 'sharedLen');
  ui.placementEdited = false;
  fillSharedSpan();
  els.placeSummary.textContent =
    `Wall 1 of the new room will be the other side of ${rm.roomLabel(host.room, roomIndex(host.room))} · ` +
    `Wall ${host.wallIdx + 1} (${units.formatLength(host.wall.lengthM, state.unit)}).`;
  els.roomError.classList.add('hidden');
  els.roomPanel.classList.remove('hidden');
  render();
}

// The new room's anchor and shared Wall 1 length as the sheet describes them.
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
      roomId: p.roomId,
      wallId: p.wallId,
      fromCorner: 'start',
      offsetM: offsetM ?? 0,
      thicknessM: thicknessM ?? rm.DEFAULT_WALL_THICKNESS_M,
      side: p.side,
    },
  };
}

// The shared wall the new room will get, drawn on the plan while placing.
function previewLine() {
  const draft = ui.placement && placementDraft();
  if (!draft || !draft.lengthM) return null;
  const frame = rm.computeFrames([...state.rooms, { id: '__preview', walls: [], anchor: draft.anchor }]).get('__preview');
  const rad = (frame.heading * Math.PI) / 180;
  return {
    x1: frame.x,
    y1: frame.y,
    x2: frame.x + draft.lengthM * Math.sin(rad),
    y2: frame.y - draft.lengthM * Math.cos(rad),
  };
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
  createRoom(draft.anchor, [{
    id: uid(),
    lengthM,
    angle: 0, // direction comes from the shared wall
    sharedWith: { roomId: host.room.id, wallId: host.wall.id },
  }]);
}

function createRoom(anchor, walls = []) {
  stopPlacing();
  const room = rm.newRoom(anchor);
  room.walls = walls;
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
});

els.lrToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (!btn) return;
  setCustomSide(btn.dataset.side);
  renderMatchChips();
});
els.customAngleInput.addEventListener('input', renderMatchChips);
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
  exportPlan({ name: state.jobName, unit: state.unit, rooms: state.rooms }, { cornerLabels });
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

els.planSvg.addEventListener('click', (e) => {
  if (ui.placingRoom) {
    handlePlacementTap(e);
    return;
  }
  const hit = nearestHitLine(e);
  if (!hit) return;
  if (hit.dataset.roomId !== state.activeRoomId) setActiveRoom(hit.dataset.roomId);
  openWallPanel(hit.dataset.wallId);
});

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
  renderPlan(els.planSvg, state.rooms, state.unit, {
    activeRoomId: state.activeRoomId,
    selectedWallId: ui.panelWallId,
  });
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

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();
