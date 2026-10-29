import * as geo from './geometry.js';
import * as units from './units.js';
import * as store from './storage.js';
import { renderPlan } from './render.js';
import { buildLengthInput, readLength, setLength } from './length-input.js';
import * as op from './openings.js';
import * as rm from './rooms.js';

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
  selectedTurn: 0, // number in degrees, or 'custom'
  customSide: 'left',
  customDeg: null,
  startHeading: 0,
  editingId: null,
  panelWallId: null, // wall whose details panel is open
  editingOpeningId: null,
  openingType: 'door',
  openingCorner: 'start',
  openingHinge: 'left',
  openingSwing: 'in',
  roomPlace: 'attach',
  hostCorner: 'start',
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
  turnButtons: $('#turnButtons'),
  customAngleSection: $('#customAngleSection'),
  lrToggle: $('#lrToggle'),
  customAngleInput: $('#customAngleInput'),
  presetChips: $('#presetChips'),
  startDirectionSection: $('#startDirectionSection'),
  startButtons: $('#startButtons'),
  lengthInputs: $('#lengthInputs'),
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
  addRoomFromWallBtn: $('#addRoomFromWallBtn'),
  roomPanel: $('#roomPanel'),
  closeRoomPanelBtn: $('#closeRoomPanelBtn'),
  roomPlaceToggle: $('#roomPlaceToggle'),
  attachSection: $('#attachSection'),
  hostWallSelect: $('#hostWallSelect'),
  hostCornerToggle: $('#hostCornerToggle'),
  separateHint: $('#separateHint'),
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

// True when the active room's start direction comes from where it was placed
// (attached to another room's wall) rather than the Up/Down/Left/Right choice.
function startHeadingFixed() {
  const anchor = activeRoom().anchor;
  return !!anchor && (anchor.type === 'wall' || (anchor.type === 'fixed' && anchor.heading != null));
}

function anchorDescription(room) {
  const anchor = room.anchor;
  if (!anchor || anchor.type !== 'wall') return '';
  const host = state.rooms.find((r) => r.id === anchor.roomId);
  if (!host) return '';
  const wallIdx = host.walls.findIndex((w) => w.id === anchor.wallId);
  const corners = cornerLabels(wallIdx, host.walls);
  const corner = anchor.fromCorner === 'end' ? corners.end : corners.start;
  return `Next to ${rm.roomLabel(host, roomIndex(host))} · Wall ${wallIdx + 1}, ` +
    `starting ${units.formatLength(anchor.offsetM, state.unit)} from ${corner.charAt(0).toLowerCase() + corner.slice(1)}, ` +
    `${units.formatLength(anchor.thicknessM, state.unit)} wall.`;
}

function describeWall(wall, index) {
  if (index === 0 && startHeadingFixed()) {
    const anchor = activeRoom().anchor;
    if (anchor.type === 'wall') {
      const host = state.rooms.find((r) => r.id === anchor.roomId);
      const hostWall = host ? host.walls.findIndex((w) => w.id === anchor.wallId) + 1 : '?';
      return host ? `Along ${rm.roomLabel(host, roomIndex(host))} · Wall ${hostWall}` : 'Along shared wall';
    }
    return 'Start position fixed';
  }
  if (index === 0) return `Start facing ${headingName(wall.angle)}`;
  if (Math.abs(wall.angle) < 0.01) return 'Straight';
  const side = wall.angle > 0 ? 'Right' : 'Left';
  return `${side} ${Math.abs(wall.angle).toFixed(0)}°`;
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

function setSelectedTurn(turn) {
  ui.selectedTurn = turn;
  [...els.turnButtons.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.turn === String(turn));
  });
  els.customAngleSection.classList.toggle('hidden', turn !== 'custom');
}

function setStartHeading(h) {
  ui.startHeading = h;
  [...els.startButtons.children].forEach((btn) => {
    btn.classList.toggle('selected', Number(btn.dataset.start) === h);
  });
}

function setCustomSide(side) {
  ui.customSide = side;
  [...els.lrToggle.children].forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.side === side);
  });
}

function currentTurnAngle() {
  if (ui.selectedTurn === 'custom') {
    const deg = parseFloat(els.customAngleInput.value);
    if (!Number.isFinite(deg) || deg <= 0) return null;
    return ui.customSide === 'left' ? -deg : deg;
  }
  return Number(ui.selectedTurn);
}

// ---------- rendering ----------

function render() {
  els.jobName.value = state.jobName;
  els.unitSelect.value = state.unit;

  const isFirstWall = state.walls.length === 0 && ui.editingId === null;
  const editingFirst = ui.editingId !== null && state.walls.findIndex((w) => w.id === ui.editingId) === 0;

  const firstWallEntry = isFirstWall || editingFirst;
  els.startDirectionSection.classList.toggle('hidden', !firstWallEntry || startHeadingFixed());
  els.directionSection.classList.toggle('hidden', firstWallEntry);
  const anchorText = anchorDescription(activeRoom());
  els.anchorFormNote.textContent = anchorText
    ? `Wall 1 runs along the shared wall. ${anchorText}`
    : '';
  els.anchorFormNote.classList.toggle('hidden', !(firstWallEntry && anchorText));

  renderEntryTitle();
  els.addWallBtn.textContent = ui.editingId ? 'Update Wall' : 'Add Wall';

  renderRoomTabs();
  renderRoomCard();
  renderPlan(els.planSvg, state.rooms, state.unit, {
    activeRoomId: state.activeRoomId,
    selectedWallId: ui.panelWallId,
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
  ui.selectedTurn = 0;
  ui.customSide = 'left';
  ui.editingId = null;
  setSelectedTurn(0);
  setStartHeading(0);
  setCustomSide('left');
  els.customAngleInput.value = '';
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
  const isFirst = editIdx === 0 || (editIdx === -1 && state.walls.length === 0);

  let angle;
  if (isFirst) {
    angle = ui.startHeading;
  } else {
    angle = currentTurnAngle();
    if (angle == null) {
      flashInvalid();
      return;
    }
  }

  if (editIdx >= 0) {
    state.walls[editIdx] = { ...state.walls[editIdx], lengthM, angle };
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
  rm.pinAttachedRooms(state.rooms, (a) => a.wallId === lastId);
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
  if (idx === 0) {
    setStartHeading(wall.angle);
  } else if ([-90, 0, 90].includes(wall.angle)) {
    setSelectedTurn(wall.angle);
  } else {
    setSelectedTurn('custom');
    setCustomSide(wall.angle < 0 ? 'left' : 'right');
    els.customAngleInput.value = Math.abs(wall.angle);
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
  rm.pinAttachedRooms(state.rooms, (a) => a.wallId === id);
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

function setRoomPlace(place) {
  ui.roomPlace = place;
  setToggle(els.roomPlaceToggle, 'place', place);
  els.attachSection.classList.toggle('hidden', place !== 'attach');
  els.separateHint.classList.toggle('hidden', place !== 'separate');
}

function setHostCorner(corner) {
  ui.hostCorner = corner;
  setToggle(els.hostCornerToggle, 'corner', corner);
}

function selectedHost() {
  const [roomId, wallId] = (els.hostWallSelect.value || '|').split('|');
  const room = state.rooms.find((r) => r.id === roomId);
  const wallIdx = room ? room.walls.findIndex((w) => w.id === wallId) : -1;
  return room && wallIdx >= 0 ? { room, wallIdx, wall: room.walls[wallIdx] } : null;
}

function updateHostCornerLabels() {
  const host = selectedHost();
  if (!host) return;
  const corners = cornerLabels(host.wallIdx, host.room.walls);
  els.hostCornerToggle.querySelector('[data-corner="start"]').textContent = corners.start;
  els.hostCornerToggle.querySelector('[data-corner="end"]').textContent = corners.end;
}

// prefill: { roomId, wallId } to start from a particular wall
function openRoomPanel(prefill = null) {
  els.hostWallSelect.innerHTML = '';
  state.rooms.forEach((room, ri) => {
    room.walls.forEach((wall, wi) => {
      const opt = document.createElement('option');
      opt.value = `${room.id}|${wall.id}`;
      opt.textContent = `${rm.roomLabel(room, ri)} · Wall ${wi + 1} – ${units.formatLength(wall.lengthM, state.unit)}`;
      els.hostWallSelect.appendChild(opt);
    });
  });
  const hasWalls = els.hostWallSelect.options.length > 0;
  els.roomPlaceToggle.querySelector('[data-place="attach"]').disabled = !hasWalls;
  if (prefill) els.hostWallSelect.value = `${prefill.roomId}|${prefill.wallId}`;
  setRoomPlace(hasWalls ? 'attach' : 'separate');
  setHostCorner('start');
  updateHostCornerLabels();
  buildLengthInput($('#anchorOffsetInputs'), state.unit, 'anchorOff');
  setLength(state.unit, 'anchorOff', 0);
  buildLengthInput($('#thicknessInputs'), state.unit, 'thick');
  setLength(state.unit, 'thick', rm.DEFAULT_WALL_THICKNESS_M);
  els.roomError.classList.add('hidden');
  els.roomPanel.classList.remove('hidden');
}

function closeRoomPanel() {
  els.roomPanel.classList.add('hidden');
}

function showRoomError(message) {
  els.roomError.textContent = message;
  els.roomError.classList.remove('hidden');
}

function handleCreateRoom() {
  let anchor;
  if (ui.roomPlace === 'attach') {
    const host = selectedHost();
    if (!host) return showRoomError('Pick the shared wall.');
    const offsetM = readLength(state.unit, 'anchorOff', { allowZero: true });
    const thicknessM = readLength(state.unit, 'thick', { allowZero: true });
    if (offsetM == null) return showRoomError('Enter the distance from the corner (0 if the rooms line up).');
    if (thicknessM == null) return showRoomError('Enter the wall thickness.');
    if (offsetM > host.wall.lengthM) {
      return showRoomError(`That's past the end of the wall (${units.formatLength(host.wall.lengthM, state.unit)}).`);
    }
    anchor = { type: 'wall', roomId: host.room.id, wallId: host.wall.id, fromCorner: ui.hostCorner, offsetM, thicknessM };
  } else {
    anchor = rm.separateRoomAnchor(state.rooms);
  }
  const room = rm.newRoom(anchor);
  state.rooms.push(room);
  closeRoomPanel();
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

els.turnButtons.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-btn');
  if (!btn) return;
  const val = btn.dataset.turn === 'custom' ? 'custom' : Number(btn.dataset.turn);
  setSelectedTurn(val);
});

els.startButtons.addEventListener('click', (e) => {
  const btn = e.target.closest('.dir-btn');
  if (!btn) return;
  setStartHeading(Number(btn.dataset.start));
});

els.lrToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (!btn) return;
  setCustomSide(btn.dataset.side);
});

els.presetChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  els.customAngleInput.value = btn.dataset.deg;
  [...els.presetChips.children].forEach((c) => c.classList.toggle('selected', c === btn));
});

els.wallForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleAddWall();
});
els.undoBtn.addEventListener('click', handleUndo);
els.closePolygonBtn.addEventListener('click', handleClosePolygon);
els.newJobBtn.addEventListener('click', handleNewJob);
els.saveJobBtn.addEventListener('click', handleSaveJob);

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
  if (btn.dataset.addRoom) openRoomPanel();
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
els.addRoomFromWallBtn.addEventListener('click', () => {
  const wallId = ui.panelWallId;
  const roomId = state.activeRoomId;
  closeWallPanel();
  render();
  openRoomPanel({ roomId, wallId });
});
els.closeRoomPanelBtn.addEventListener('click', closeRoomPanel);
els.cancelRoomBtn.addEventListener('click', closeRoomPanel);
els.roomPanel.addEventListener('click', (e) => {
  if (e.target === els.roomPanel) closeRoomPanel();
});
els.roomPlaceToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (btn && !btn.disabled) setRoomPlace(btn.dataset.place);
});
els.hostWallSelect.addEventListener('change', updateHostCornerLabels);
els.hostCornerToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.lr-btn');
  if (btn) setHostCorner(btn.dataset.corner);
});
els.createRoomBtn.addEventListener('click', handleCreateRoom);

// ---------- init ----------

function init() {
  buildLengthInputs();
  setSelectedTurn(0);
  setStartHeading(0);
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
