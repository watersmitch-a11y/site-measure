// Drawing the screen: render(), the plan with zoom, the stats bar, and finding what was tapped on the plan.

import * as rm from '../rooms.js';
import { fitViewBox, renderPlan } from '../render.js';
import * as fx from '../fixtures.js';
import * as units from '../units.js';
import * as op from '../openings.js';
import { activeRoom, els, geometryOf, levelRooms, state, ui } from './core.js';
import { anchorDescription, entryIndex, gapDims, renderEntryTitle, renderMatchChips, renderWallList, roomGaps, startHeadingFixed, updateDirPad } from './entry.js';
import { previewLine, renderRoomCard, renderRoomTabs, renderSquareCheck } from './room-ui.js';
import { renderLevelBar } from './levels.js';
import { updateMoveDims } from './move.js';

export function render() {
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

  renderLevelBar();
  renderRoomTabs();
  renderRoomCard();
  drawPlan();
  updateMoveDims();
  renderStats();
  renderWallList();
  const roomNow = activeRoom();
  const closable = ui.insertAt == null && state.walls.length >= rm.minWallsToClose(roomNow) &&
    !rm.roomClosed(roomNow, geometryOf(roomNow));
  els.closePolygonBtn.classList.toggle('hidden', !closable);
  // a small gap is usually measuring error: offer to share it out instead
  // (even inside the 50 mm a room counts as closed by, so the plan meets up)
  const gapNow = ui.insertAt == null ? rm.closingGap(roomNow, geometryOf(roomNow)) : null;
  els.spreadGapBtn.classList.toggle('hidden', !(gapNow > 0.002 && state.walls.length >= rm.minWallsToClose(roomNow) + 1 &&
    gapNow <= 0.05 * state.walls.reduce((sum, w) => sum + w.lengthM, 0)));
  renderSquareCheck();
}

export function drawPlan() {
  let viewBox = ui.moving && ui.moving.viewBox;
  if (!viewBox && ui.view) viewBox = { x: ui.view.x, y: ui.view.y, width: ui.view.w, height: ui.view.w };
  renderPlan(els.planSvg, levelRooms(), state.unit, {
    activeRoomId: state.activeRoomId,
    selectedWallId: ui.panelWallId || ui.locateWallId || ui.editingId,
    movingIds: ui.moving ? ui.moving.groupIds : null,
    previewLine: previewLine(),
    gapDims: [...gapDims(), ...roomGaps()],
    viewBox,
  });
  els.planWrap.classList.toggle('zoomed', !!ui.view);
  els.zoomFitBtn.classList.toggle('hidden', !ui.view);
}

// The square of the plan currently on screen (the plan box is square, and the
// whole-plan view is centred in it), so a screen fraction maps straight to it.
export function shownView() {
  if (ui.view) return { ...ui.view };
  const fit = fitViewBox(levelRooms());
  const w = Math.max(fit.width, fit.height);
  return { x: fit.x - (w - fit.width) / 2, y: fit.y - (w - fit.height) / 2, w };
}

export function clampViewWidth(w) {
  const fit = fitViewBox(levelRooms());
  return Math.min(Math.max(w, 0.5), Math.max(fit.width, fit.height) * 1.5);
}

// Zoom by `factor` keeping the plan point at screen fraction (fx, fy) still.
export function zoomAt(fx, fy, factor) {
  const v = shownView();
  const px = v.x + fx * v.w;
  const py = v.y + fy * v.w;
  const w = clampViewWidth(v.w / factor);
  ui.view = { x: px - fx * w, y: py - fy * w, w };
  drawPlan();
}

export function zoomFit() {
  ui.view = null;
  drawPlan();
}

export function planFraction(clientX, clientY) {
  const r = els.planSvg.getBoundingClientRect();
  return { fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, r };
}

export function renderStats() {
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

export function addPill(html, warn = false) {
  const pill = document.createElement('div');
  pill.className = 'stat-pill' + (warn ? ' warn' : '');
  pill.innerHTML = html;
  els.statsBar.appendChild(pill);
}

// Shared walls of adjoining rooms sit a wall-thickness apart and their tap
// areas overlap, so pick the wall line nearest the tap, not the topmost one.
export function nearestHitLine(e) {
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
export const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

export const touchMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

// The room whose floor contains a plan point (the smallest, if rooms overlap).
export function roomAtPoint(pt) {
  const geom = rm.roomGeometry(state.rooms);
  let best = null;
  levelRooms().forEach((room) => {
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
