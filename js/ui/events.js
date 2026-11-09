// Wiring the page up: every button, field, tap, drag and pinch handler.

import { readLength, setLength } from '../length-input.js';
import { exportPlan } from '../export.js';
import { exportDxf } from '../dxf.js';
import * as jobfile from '../jobfile.js';
import * as store from '../storage.js';
import * as fx from '../fixtures.js';
import * as rm from '../rooms.js';
import * as laser from '../laser.js';
import { $, activeRoom, allWalls, els, geometryOf, levelRooms, round3, state, ui } from './core.js';
import { ROOM_DETAIL_FIELDS, closeRoomPanel, fillSharedSpan, handleCreateRoom, handleDeleteRoom, handleDiagCheck, handleDiagFix, handlePlacementTap, handleSeparateRoom, handleSpreadGap, renderRoomTabs, saveRoomDetails, setActiveRoom, startPlacing, stopPlacing, svgPoint } from './room-ui.js';
import { typePhotoNote, addPhoto, closePhoto, deleteOpenPhoto, openPhoto, photoUrl } from './photo-ui.js';
import { applyMoveDim, endMove, handleDoorMatch, movingRoom, movingRoots, openDoorMatch, rotateMoving, shiftGroup, startMove, updateMoveDims } from './move.js';
import { buildCeilingInput, buildLengthInputs, handleAddWall, handleClosePolygon, handleDeleteWall, handleEditWall, handleUndo, renderEntryTitle, renderMatchChips, resetEntryForm, setCustomSide, setSelectedHeading } from './entry.js';
import { clampViewWidth, drawPlan, nearestHitLine, planFraction, render, renderStats, roomAtPoint, shownView, touchDist, touchMid, zoomAt, zoomFit } from './view.js';
import { typeDetails, closeDetails, closeExport, currentJob, exportFailed, handleDeleteJob, handleLoadJob, handleNewJob, openDetails, renderJobsPanel, setSiteMode } from './jobs.js';
import { closeWallPanel, fillKeepClosed, handleBreakWall, handleDeleteFixture, handleDeleteOpening, handleSaveFixture, handleSaveOpening, handleUpdateLength, handleWallThickness, hideFixtureForm, hideOpeningForm, openWallPanel, panelWall, planEnds, roomSide, setFixtureTypeFields, setOpeningCorner, setOpeningHinge, setOpeningSwing, setOpeningType, showFixtureForm, showOpeningForm } from './walls.js';
import { handleAddLevel, handleDeleteLevel, handleRenameLevel, switchLevel } from './levels.js';
import { handleLaserBtn } from './laser-ui.js';
import { flushPending, persist, redo, saveJob, saveSoon, undo } from './history.js';
import { showAlert, showConfirm } from './dialogs.js';

els.jobName.addEventListener('input', () => {
  const name = els.jobName.value.trim() || 'Untitled Job';
  saveSoon('job-name', () => { state.jobName = name; });
});
els.jobName.addEventListener('change', () => flushPending());

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

els.undoActionBtn.addEventListener('click', undo);
$('#addAnywayBtn').addEventListener('click', () => {
  ui.addAnyway = true;
  renderEntryTitle();
  $('#lenSingle, #lenFeet').focus();
});

els.redoActionBtn.addEventListener('click', redo);

els.closePolygonBtn.addEventListener('click', handleClosePolygon);

els.newJobBtn.addEventListener('click', handleNewJob);

els.exportBtn.addEventListener('click', () => {
  els.exportError.classList.add('hidden');
  els.exportPanel.classList.remove('hidden');
});

$('#closeExportBtn').addEventListener('click', closeExport);

els.exportPanel.addEventListener('click', (e) => { if (e.target === els.exportPanel) closeExport(); });

$('#exportPdfBtn').addEventListener('click', async () => {
  if (allWalls().length === 0) return exportFailed('Measure some walls first.');
  saveJob();
  closeExport();
  await exportPlan(currentJob(), { planEnds, wallName: roomSide, photoUrl });
});

$('#exportDxfBtn').addEventListener('click', async () => {
  if (allWalls().length === 0) return exportFailed('Measure some walls first.');
  saveJob();
  const blob = exportDxf(currentJob());
  const result = await jobfile.shareOrDownload(blob, `${(state.jobName || 'Site measure').replace(/[\\/:*?"<>|]+/g, '-')}.dxf`, state.jobName);
  if (result !== 'cancelled') closeExport();
});

$('#exportJobBtn').addEventListener('click', async () => {
  saveJob();
  try {
    const blob = await jobfile.jobFileBlob(currentJob());
    const result = await jobfile.shareOrDownload(blob, jobfile.jobFileName(currentJob()), state.jobName);
    if (result !== 'cancelled') closeExport();
  } catch (err) {
    exportFailed(`Couldn't save the job file: ${err.message}`);
  }
});

$('#importJobBtn').addEventListener('click', () => els.importJobInput.click());

els.importJobInput.addEventListener('change', async () => {
  const file = els.importJobInput.files[0];
  els.importJobInput.value = '';
  if (!file) return;
  let job;
  try {
    job = await jobfile.readJobFile(file);
  } catch (err) {
    await showAlert(err.message);
    return;
  }
  if (job.id && store.loadJob(job.id)) {
    const replace = await showConfirm(`"${job.name}" is already on this phone. Replace it with the file's copy? ` +
      '(Cancel keeps both, opening the file as a copy.)');
    if (!replace) {
      job.id = store.newJobId();
      job.name = `${job.name} (copy)`;
    }
  }
  if (!job.id) job.id = store.newJobId();
  store.saveJob(job);
  handleLoadJob(job.id);
});

els.wallList.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.edit-btn');
  const delBtn = e.target.closest('.delete-btn');
  const info = e.target.closest('.wall-info');
  const locate = e.target.closest('[data-locate]');
  if (locate) {
    // light the wall up on the plan for a moment
    ui.locateWallId = locate.dataset.locate;
    drawPlan();
    els.planWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    clearTimeout(ui.locateTimer);
    ui.locateTimer = setTimeout(() => { ui.locateWallId = null; drawPlan(); }, 2500);
    return;
  }
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

els.ceilingInputs.addEventListener('change', () => persist());

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
    starts: movingRoots().map((root) => ({ root, x: root.anchor.x, y: root.anchor.y })),
  };
  els.planSvg.setPointerCapture(e.pointerId);
});

export let dragFrame = null;

els.planSvg.addEventListener('pointermove', (e) => {
  if (ui.pinch) return;
  const room = movingRoom();
  const drag = ui.moving && ui.moving.drag;
  if (!room || !drag) return;
  drag.starts.forEach(({ root, x, y }) => {
    root.anchor.x = round3(x + (e.clientX - drag.clientX) * drag.metresPerPx);
    root.anchor.y = round3(y + (e.clientY - drag.clientY) * drag.metresPerPx);
  });
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
export const endDrag = () => {
  if (!ui.moving || !ui.moving.drag) return;
  ui.moving.drag = null;
  ui.moving.viewBox = null;
  const room = movingRoom();
  const snap = room && rm.snapOffset(levelRooms(), rm.roomGeometry(levelRooms()), ui.moving.groupIds, rm.DEFAULT_WALL_THICKNESS_M);
  if (snap) shiftGroup(snap.dx, snap.dy);
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

els.roomTabs.addEventListener('change', (e) => {
  if (e.target.matches('.room-select')) setActiveRoom(e.target.value);
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
  const room = activeRoom();
  room.name = els.roomName.value.trim();
  renderRoomTabs();
  renderEntryTitle();
  drawPlan();
  saveSoon(`room-name:${room.id}`, () => {});
});

els.roomName.addEventListener('change', () => { flushPending(); persist(`room-name:${state.activeRoomId}`); });

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

els.separateRoomBtn.addEventListener('click', handleSeparateRoom);

els.breakWallBtn.addEventListener('click', handleBreakWall);

$('#laserBtn').addEventListener('click', handleLaserBtn);

$('#laserBtn').classList.toggle('hidden', !laser.laserSupported());

$('#levelSelect').addEventListener('change', (e) => switchLevel(e.target.value));

$('#addLevelBtn').addEventListener('click', handleAddLevel);

$('#renameLevelBtn').addEventListener('click', handleRenameLevel);
$('#deleteLevelBtn').addEventListener('click', handleDeleteLevel);

$('#addFixtureBtn').addEventListener('click', () => showFixtureForm(null));

$('#cancelFixtureBtn').addEventListener('click', hideFixtureForm);

$('#saveFixtureBtn').addEventListener('click', handleSaveFixture);

$('#fixtureType').addEventListener('change', setFixtureTypeFields);

$('#fixtureList').addEventListener('click', (e) => {
  const edit = e.target.closest('.edit-btn');
  const del = e.target.closest('.delete-btn');
  const wall = panelWall();
  if (edit && wall) showFixtureForm((wall.fixtures || []).find((f) => f.id === edit.dataset.fxId));
  else if (del) handleDeleteFixture(del.dataset.fxId);
});

Object.keys(ROOM_DETAIL_FIELDS).forEach((id) => {
  $(`#${id}`).addEventListener('input', saveRoomDetails);
  $(`#${id}`).addEventListener('change', flushPending); // leaving the box saves at once
});
['#detailJobName', '#detailAddress', '#detailClient', '#detailMeasuredBy'].forEach((sel) => $(sel).addEventListener('input', typeDetails));
els.photoNote.addEventListener('input', typePhotoNote);

els.spreadGapBtn.addEventListener('click', handleSpreadGap);

$('#diagCheckBtn').addEventListener('click', handleDiagCheck);

els.diagFixBtn.addEventListener('click', handleDiagFix);

$('#detailsBtn').addEventListener('click', openDetails);

$('#doneDetailsBtn').addEventListener('click', closeDetails);

$('#closeDetailsBtn').addEventListener('click', closeDetails);

els.detailsPanel.addEventListener('click', (e) => { if (e.target === els.detailsPanel) closeDetails(); });

$('#siteModeBtn').addEventListener('click', () => setSiteMode(!document.body.classList.contains('site-mode')));

$('#roomPhotoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  addPhoto(file, null);
});

$('#wallPhotoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  addPhoto(file, ui.panelWallId);
});

[els.roomPhotos, els.wallPhotos].forEach((strip) => strip.addEventListener('click', (e) => {
  const thumb = e.target.closest('.photo-thumb');
  if (thumb) openPhoto(state.activeRoomId, thumb.dataset.id);
}));

$('#closePhotoBtn').addEventListener('click', closePhoto);

$('#donePhotoBtn').addEventListener('click', closePhoto);

$('#deletePhotoBtn').addEventListener('click', deleteOpenPhoto);

els.photoViewer.addEventListener('click', (e) => { if (e.target === els.photoViewer) closePhoto(); });

$('#wallThickBtn').addEventListener('click', () => handleWallThickness());

$('#wallThickChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) handleWallThickness(Number(chip.dataset.mm) / 1000);
});

els.finishInsertBtn.addEventListener('click', () => {
  // The wall was measured end to end, so a step along it comes off the rest
  // of the wall: shorten (or lengthen) that piece to close the room again.
  const room = activeRoom();
  const rest = ui.insertRest && state.walls.find((w) => w.id === ui.insertRest);
  if (rest) {
    const g = geometryOf(room);
    const last = g.points[g.points.length - 1];
    const gx = g.target.x - last.x;
    const gy = g.target.y - last.y;
    const i = state.walls.indexOf(rest);
    const a = g.points[i];
    const b = g.points[i + 1];
    const ux = (b.x - a.x) / (rest.lengthM || 1);
    const uy = (b.y - a.y) / (rest.lengthM || 1);
    const along = gx * ux + gy * uy;
    const across = Math.abs(gx * uy - gy * ux);
    if (Math.hypot(gx, gy) > 0.005 && across < 0.005 && rest.lengthM + along > 0.01) {
      rest.lengthM = Math.round((rest.lengthM + along) * 1000) / 1000;
      persist();
    }
  }
  ui.insertRest = null;
  ui.insertAt = null;
  resetEntryForm();
  render();
});

els.panelMoveRoomBtn.addEventListener('click', startMove);

 // startMove closes the wall panel
els.doneMoveBtn.addEventListener('click', () => endMove(true));

els.cancelMoveBtn.addEventListener('click', () => endMove(false));

els.rotateLeftBtn.addEventListener('click', () => rotateMoving(-90));

els.rotateRightBtn.addEventListener('click', () => rotateMoving(90));

els.nudgePad.addEventListener('click', (e) => {
  const btn = e.target.closest('button.pad-btn');
  const room = movingRoom();
  if (!btn || !room) return;
  const step = Number(els.nudgeStep.value);
  shiftGroup(Number(btn.dataset.dx) * step, Number(btn.dataset.dy) * step);
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
