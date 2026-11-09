// Jobs: new, load, delete, the saved-jobs list, job details, site mode and the export menu.

import * as rm from '../rooms.js';
import * as store from '../storage.js';
import { $, activeRoom, allWalls, els, escapeHtml, levelOf, state, ui } from './core.js';
import { buildCeilingInput, resetEntryForm } from './entry.js';
import { closeWallPanel } from './walls.js';
import { endMove } from './move.js';
import { flushPending, persist, resetHistory, saveSoon } from './history.js';
import { render } from './view.js';
import { showConfirm } from './dialogs.js';
import { cleanUpPhotos } from './photo-ui.js';

export async function handleNewJob() {
  if (ui.moving) endMove(true);
  ui.view = null;
  if (allWalls().length > 0) {
    const ok = await showConfirm('Start a new job? Current job is already auto-saved.');
    if (!ok) return;
  }
  state.jobId = null;
  state.jobName = 'Untitled Job';
  state.rooms = [rm.newRoom()];
  state.rooms[0].number = 1;
  state.activeRoomId = state.rooms[0].id;
  closeWallPanel();
  resetEntryForm();
  buildCeilingInput();
  state.details = { measuredBy: lastMeasuredBy() };
  state.levels = ['Ground floor'];
  state.level = 'Ground floor';
  resetHistory();
  render();
  openDetails(); // a new job starts with its name and address
}

// Loads a saved job into state. Jobs saved before rooms existed had a single
// wall list on the job itself; they become a one-room job.
export function applyJob(job) {
  state.jobId = job.id;
  state.jobName = job.name;
  state.unit = job.unit || 'mm';
  state.details = job.details || {};
  state.levels = Array.isArray(job.levels) && job.levels.length ? [...job.levels] : ['Ground floor'];
  if (Array.isArray(job.rooms) && job.rooms.length > 0) {
    state.rooms = job.rooms;
  } else {
    const room = rm.newRoom();
    room.ceilingHeightM = job.ceilingHeightM || null;
    room.walls = job.walls || [];
    state.rooms = [room];
  }
  rm.migrateSharedWallRooms(state.rooms);
  rm.numberRooms(state.rooms);
  state.rooms.forEach((r) => { if (r.level && !state.levels.includes(r.level)) state.levels.push(r.level); });
  resetHistory();
  state.activeRoomId = state.rooms.some((r) => r.id === job.activeRoomId)
    ? job.activeRoomId
    : state.rooms[0].id;
  state.level = levelOf(activeRoom());
}

export function handleLoadJob(id) {
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

export async function handleDeleteJob(id) {
  const ok = await showConfirm('Delete this saved job? This cannot be undone.');
  if (!ok) return;
  store.deleteJob(id);
  if (state.jobId === id) await handleNewJob();
  renderJobsPanel();
  cleanUpPhotos();
}

export function renderJobsPanel() {
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

export const MEASURED_BY_KEY = 'siteMeasure.measuredBy';

export function lastMeasuredBy() {
  try { return localStorage.getItem(MEASURED_BY_KEY) || ''; } catch { return ''; }
}

export function openDetails() {
  $('#detailJobName').value = state.jobName === 'Untitled Job' ? '' : state.jobName;
  $('#detailAddress').value = state.details.address || '';
  $('#detailClient').value = state.details.client || '';
  $('#detailMeasuredBy').value = state.details.measuredBy || '';
  els.detailsPanel.classList.remove('hidden');
}

function readDetails() {
  const name = $('#detailJobName').value.trim();
  const address = $('#detailAddress').value.trim();
  return {
    jobName: name || address || 'Untitled Job',
    details: { address, client: $('#detailClient').value.trim(), measuredBy: $('#detailMeasuredBy').value.trim() },
  };
}

// Saved as you type, so nothing's lost if the phone locks mid-entry.
export function typeDetails() {
  const { jobName, details } = readDetails();
  saveSoon('job-details', () => {
    state.jobName = jobName;
    state.details = details;
  });
}

export function closeDetails() {
  const { jobName, details } = readDetails();
  state.jobName = jobName;
  state.details = details;
  try { localStorage.setItem(MEASURED_BY_KEY, details.measuredBy); } catch { /* not kept */ }
  els.detailsPanel.classList.add('hidden');
  flushPending();
  persist('job-details');
  render();
}

export const SITE_MODE_KEY = 'siteMeasure.siteMode';

export function setSiteMode(on) {
  document.body.classList.toggle('site-mode', on);
  document.documentElement.classList.toggle('site-mode', on); // rem sizes scale up too
  $('#siteModeBtn').classList.toggle('selected', on);
  try { localStorage.setItem(SITE_MODE_KEY, on ? '1' : ''); } catch { /* not kept */ }
}

export const closeExport = () => els.exportPanel.classList.add('hidden');

export const currentJob = () => ({
  id: state.jobId, name: state.jobName, unit: state.unit, rooms: state.rooms, activeRoomId: state.activeRoomId, details: state.details,
  levels: state.levels,
});

export function exportFailed(message) {
  els.exportError.textContent = message;
  els.exportError.classList.remove('hidden');
}
