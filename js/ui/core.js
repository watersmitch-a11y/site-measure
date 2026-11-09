// Shared state: the job, UI state, page elements and small helpers.

import * as rm from '../rooms.js';

// Shown at the foot of the page; keep in step with CACHE_NAME in service-worker.js.
export const APP_VERSION = 38;

export const $ = (sel) => document.querySelector(sel);

export const uid = () => `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const state = {
  jobId: null,
  jobName: 'Untitled Job',
  unit: 'mm',
  rooms: [rm.newRoom()],
  activeRoomId: null,
  details: {}, // { address, client, measuredBy }
  levels: ['Ground floor'], // floors of the building, in order
  level: 'Ground floor', // the floor on screen
};

state.rooms[0].number = 1;

state.activeRoomId = state.rooms[0].id;

// The wall-entry, openings and ceiling code all work on the active room;
// these aliases keep that code reading as state.walls / state.ceilingHeightM.
export function activeRoom() {
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

export function allWalls() {
  return state.rooms.flatMap((r) => r.walls);
}

export function roomIndex(room) {
  return state.rooms.indexOf(room);
}

// Each room is on a level (floor); the plan, room tabs, snapping, joins and
// gap sizes only ever deal with the rooms on the level on screen.
export function levelOf(room) {
  return room.level && state.levels.includes(room.level) ? room.level : state.levels[0];
}

export function levelRooms(level = state.level) {
  return state.rooms.filter((r) => levelOf(r) === level);
}

export function geometryOf(room) {
  return rm.roomGeometry(state.rooms).get(room.id);
}

export function activeLabel() {
  return rm.roomLabel(activeRoom(), roomIndex(activeRoom()));
}

export const ui = {
  selectedHeading: null, // direction on the plan in degrees (0 up, 90 right…), or 'custom'
  insertAt: null, // inserting walls before this wall index (after breaking a wall)
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

export const MEASURED_TO_KEY = 'siteMeasure.lastMeasuredTo';

export const els = {
  jobName: $('#jobName'),
  unitSelect: $('#unitSelect'),
  jobsBtn: $('#jobsBtn'),
  newJobBtn: $('#newJobBtn'),
  saveState: $('#saveState'),
  detailsPanel: $('#detailsPanel'),
  spreadGapBtn: $('#spreadGapBtn'),
  squareCheck: $('#squareCheck'),
  diagFrom: $('#diagFrom'),
  diagTo: $('#diagTo'),
  diagResult: $('#diagResult'),
  diagFixBtn: $('#diagFixBtn'),
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
  closedNote: $('#closedNote'),
  undoActionBtn: $('#undoActionBtn'),
  redoActionBtn: $('#redoActionBtn'),
  exportPanel: $('#exportPanel'),
  exportError: $('#exportError'),
  importJobInput: $('#importJobInput'),
  roomPhotos: $('#roomPhotos'),
  wallPhotos: $('#wallPhotos'),
  photoViewer: $('#photoViewer'),
  photoViewerTitle: $('#photoViewerTitle'),
  photoViewerImg: $('#photoViewerImg'),
  photoNote: $('#photoNote'),
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
  separateRoomBtn: $('#separateRoomBtn'),
  breakEndSelect: $('#breakEndSelect'),
  wallThickInputs: $('#wallThickInputs'),
  wallThickAll: $('#wallThickAll'),
  wallThickError: $('#wallThickError'),
  breakAtInputs: $('#breakAtInputs'),
  breakError: $('#breakError'),
  breakWallBtn: $('#breakWallBtn'),
  finishInsertBtn: $('#finishInsertBtn'),
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

export function normalizeAngle180(a) {
  let x = a % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

export function headingName(angle) {
  const a = ((angle % 360) + 360) % 360;
  if (Math.abs(a - 0) < 0.01) return 'Up';
  if (Math.abs(a - 90) < 0.01) return 'Right';
  if (Math.abs(a - 180) < 0.01) return 'Down';
  if (Math.abs(a - 270) < 0.01) return 'Left';
  return `${a.toFixed(0)}°`;
}

export const ARROWS = { Up: '↑', Right: '→', Down: '↓', Left: '←' };

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

export const round3 = (v) => Math.round(v * 1000) / 1000;
