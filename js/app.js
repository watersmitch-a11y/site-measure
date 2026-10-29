import * as geo from './geometry.js';
import * as units from './units.js';
import * as store from './storage.js';
import { renderPlan } from './render.js';

const $ = (sel) => document.querySelector(sel);
const uid = () => `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const state = {
  jobId: null,
  jobName: 'Untitled Job',
  unit: 'mm',
  walls: [],
};

const ui = {
  selectedTurn: 0, // number in degrees, or 'custom'
  customSide: 'left',
  customDeg: null,
  startHeading: 0,
  editingId: null,
};

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

function describeWall(wall, index) {
  if (index === 0) return `Start facing ${headingName(wall.angle)}`;
  if (Math.abs(wall.angle) < 0.01) return 'Straight';
  const side = wall.angle > 0 ? 'Right' : 'Left';
  return `${side} ${Math.abs(wall.angle).toFixed(0)}°`;
}

// ---------- length input rendering ----------

function buildLengthInputs() {
  els.lengthInputs.innerHTML = '';
  if (state.unit === 'ft-in') {
    const feetInput = document.createElement('input');
    feetInput.type = 'number';
    feetInput.inputMode = 'decimal';
    feetInput.placeholder = 'Feet';
    feetInput.id = 'lenFeet';
    feetInput.min = '0';
    const inSuffix1 = document.createElement('span');
    inSuffix1.className = 'unit-suffix';
    inSuffix1.textContent = "ft";
    const inchesInput = document.createElement('input');
    inchesInput.type = 'number';
    inchesInput.inputMode = 'decimal';
    inchesInput.placeholder = 'Inches';
    inchesInput.id = 'lenInches';
    inchesInput.min = '0';
    inchesInput.max = '11.9';
    const inSuffix2 = document.createElement('span');
    inSuffix2.className = 'unit-suffix';
    inSuffix2.textContent = 'in';
    els.lengthInputs.append(feetInput, inSuffix1, inchesInput, inSuffix2);
  } else {
    const singleUnitConfig = {
      mm: { placeholder: 'Millimeters', suffix: 'mm', step: '1' },
      m: { placeholder: 'Meters', suffix: 'm', step: '0.01' },
      ft: { placeholder: 'Feet', suffix: 'ft', step: '0.01' },
    };
    const cfg = singleUnitConfig[state.unit];
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.placeholder = cfg.placeholder;
    input.id = 'lenSingle';
    input.min = '0';
    input.step = cfg.step;
    const suffix = document.createElement('span');
    suffix.className = 'unit-suffix';
    suffix.textContent = cfg.suffix;
    els.lengthInputs.append(input, suffix);
  }
}

function readLengthMeters() {
  if (state.unit === 'ft-in') {
    const feet = parseFloat($('#lenFeet').value) || 0;
    const inches = parseFloat($('#lenInches').value) || 0;
    if (feet <= 0 && inches <= 0) return null;
    return units.feetInchesToMeters(feet, inches);
  }
  const raw = $('#lenSingle').value;
  if (!raw) return null;
  if (state.unit === 'mm') return units.parseMm(raw);
  return state.unit === 'm' ? units.parseMeters(raw) : units.parseDecimalFeet(raw);
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

  els.startDirectionSection.classList.toggle('hidden', !(isFirstWall || editingFirst));
  els.directionSection.classList.toggle('hidden', isFirstWall || editingFirst);

  const nextIndex = ui.editingId
    ? state.walls.findIndex((w) => w.id === ui.editingId)
    : state.walls.length;
  els.entryTitle.textContent = ui.editingId
    ? `Editing Wall ${nextIndex + 1}`
    : `Wall ${nextIndex + 1}`;
  els.addWallBtn.textContent = ui.editingId ? 'Update Wall' : 'Add Wall';

  renderPlan(els.planSvg, state.walls, state.unit);
  renderStats();
  renderWallList();
  els.closePolygonBtn.classList.toggle('hidden', state.walls.length < 2);
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
    li.innerHTML = `
      <div class="wall-idx">${i + 1}</div>
      <div class="wall-info">
        <div class="wall-len">${units.formatLength(wall.lengthM, state.unit)}</div>
        <div class="wall-dir">${describeWall(wall, i)}</div>
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
    walls: state.walls,
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
  state.walls.pop();
  ui.editingId = null;
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
  if (state.unit === 'ft-in') {
    const { feet, inches } = units.metersToFeetInches(wall.lengthM);
    $('#lenFeet').value = feet;
    $('#lenInches').value = Math.round(inches * 8) / 8;
  } else if (state.unit === 'mm') {
    $('#lenSingle').value = Math.round(units.metersToMm(wall.lengthM));
  } else if (state.unit === 'm') {
    $('#lenSingle').value = wall.lengthM.toFixed(2);
  } else {
    $('#lenSingle').value = units.metersToFeet(wall.lengthM).toFixed(2);
  }
  render();
  els.entryTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleDeleteWall(id) {
  const idx = state.walls.findIndex((w) => w.id === id);
  if (idx < 0) return;
  const ok = await showConfirm(`Delete wall ${idx + 1}? Later walls will keep their relative turns.`);
  if (!ok) return;
  state.walls.splice(idx, 1);
  if (ui.editingId === id) resetEntryForm();
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
  if (state.walls.length > 0) {
    const ok = await showConfirm('Start a new job? Current job is already auto-saved.');
    if (!ok) return;
  }
  state.jobId = null;
  state.jobName = 'Untitled Job';
  state.walls = [];
  resetEntryForm();
  render();
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
  state.jobId = job.id;
  state.jobName = job.name;
  state.unit = job.unit || 'mm';
  state.walls = job.walls || [];
  resetEntryForm();
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

// ---------- event wiring ----------

els.jobName.addEventListener('change', () => {
  state.jobName = els.jobName.value || 'Untitled Job';
  persist();
});

els.unitSelect.addEventListener('change', () => {
  state.unit = els.unitSelect.value;
  buildLengthInputs();
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
  if (editBtn) handleEditWall(editBtn.dataset.id);
  if (delBtn) handleDeleteWall(delBtn.dataset.id);
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
      state.jobId = job.id;
      state.jobName = job.name;
      state.unit = job.unit || 'mm';
      state.walls = job.walls || [];
      buildLengthInputs();
    }
  }

  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();
