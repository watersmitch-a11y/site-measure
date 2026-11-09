// Photos of rooms and walls: taking, the thumbnail strips and the viewer.

import * as photos from '../photos.js';
import * as rm from '../rooms.js';
import { activeRoom, els, roomIndex, state, ui } from './core.js';
import { flushPending, history, persist, saveSoon } from './history.js';
import * as store from '../storage.js';
import { renderRoomCard } from './room-ui.js';
import { renderWallTabCounts, roomSide } from './walls.js';
import { showAlert, showConfirm } from './dialogs.js';

// Photos are taken (or picked) per room or per wall, shrunk, and kept in the
// photo store; the room lists them as { id, wallId, note, takenAt }.
export const photoUrls = new Map();

 // photo id -> object URL for its thumbnail
ui.photo = null;

 // { roomId, id } while the viewer is open
export async function photoUrl(id) {
  if (photoUrls.has(id)) return photoUrls.get(id);
  const blob = await photos.getPhoto(id).catch(() => null);
  const url = blob ? URL.createObjectURL(blob) : '';
  photoUrls.set(id, url);
  return url;
}

export function renderPhotoStrip(container, room, wallId) {
  if (wallId !== undefined) renderWallTabCounts();
  const list = (room.photos || []).filter((p) => (wallId === undefined ? true : p.wallId === wallId));
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<span class="photo-empty">None yet</span>';
    return;
  }
  list.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo-thumb';
    btn.dataset.id = p.id;
    btn.title = p.note || 'Photo';
    if (p.wallId && wallId === undefined) {
      const idx = room.walls.findIndex((w) => w.id === p.wallId);
      if (idx >= 0) btn.dataset.wall = roomSide(idx, room);
    }
    const img = document.createElement('img');
    img.alt = p.note || 'Site photo';
    photoUrl(p.id).then((url) => { img.src = url; });
    btn.appendChild(img);
    container.appendChild(btn);
  });
}

export async function addPhoto(file, wallId) {
  if (!file) return;
  const room = activeRoom();
  try {
    const blob = await photos.shrinkImage(file);
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await photos.putPhoto(id, blob);
    room.photos = [...(room.photos || []), { id, wallId: wallId || null, note: '', takenAt: new Date().toISOString() }];
    persist();
    renderRoomCard();
    if (wallId) renderPhotoStrip(els.wallPhotos, room, wallId);
    openPhoto(room.id, id); // straight to the note
  } catch (err) {
    await showAlert(`Couldn't add that photo: ${err.message}`);
  }
}

export async function openPhoto(roomId, id) {
  const room = state.rooms.find((r) => r.id === roomId);
  const p = room && (room.photos || []).find((x) => x.id === id);
  if (!p) return;
  ui.photo = { roomId, id };
  const idx = p.wallId ? room.walls.findIndex((w) => w.id === p.wallId) : -1;
  const where = idx >= 0 ? `${roomSide(idx, room)} wall` : 'room';
  els.photoViewerTitle.textContent = `${rm.roomLabel(room, roomIndex(room))} – ${where}`;
  els.photoNote.value = p.note || '';
  els.photoViewerImg.src = await photoUrl(id);
  els.photoViewer.classList.remove('hidden');
}

export function closePhoto() {
  const open = ui.photo;
  ui.photo = null;
  els.photoViewer.classList.add('hidden');
  if (!open) return;
  const room = state.rooms.find((r) => r.id === open.roomId);
  const p = room && (room.photos || []).find((x) => x.id === open.id);
  flushPending();
  if (p && p.note !== els.photoNote.value.trim()) {
    p.note = els.photoNote.value.trim();
    persist(`photo-note:${p.id}`);
  }
  renderRoomCard();
  if (ui.panelWallId) renderPhotoStrip(els.wallPhotos, activeRoom(), ui.panelWallId);
}

// Pictures no job uses any more (a deleted photo, or a deleted job's) are
// removed from the phone. Ones an undo step could still bring back are kept.
export async function cleanUpPhotos() {
  try {
    const keep = new Set();
    const note = (text) => (text.match(/"id":"(p_[^"]+)"/g) || []).forEach((m) => keep.add(m.slice(6, -1)));
    store.listJobs().forEach((j) => note(localStorage.getItem(`siteMeasure.job.${j.id}`) || ''));
    note(JSON.stringify(state.rooms));
    [...history.undo, ...history.redo, history.last].forEach((h) => h && note(h.key));
    const ids = await photos.listPhotoIds();
    await Promise.all(ids.filter((id) => !keep.has(id)).map((id) => photos.deletePhoto(id)));
    return ids.length - keep.size;
  } catch {
    return 0; // nothing lost by leaving them for next time
  }
}

// The note is saved as it's typed.
export function typePhotoNote() {
  const open = ui.photo;
  if (!open) return;
  const room = state.rooms.find((r) => r.id === open.roomId);
  const p = room && (room.photos || []).find((x) => x.id === open.id);
  const note = els.photoNote.value.trim();
  if (p) saveSoon(`photo-note:${p.id}`, () => { p.note = note; });
}

export async function deleteOpenPhoto() {
  const open = ui.photo;
  if (!open) return;
  const ok = await showConfirm('Delete this photo?');
  if (!ok) return;
  const room = state.rooms.find((r) => r.id === open.roomId);
  // the picture stays in the store so Undo can bring it back
  room.photos = (room.photos || []).filter((x) => x.id !== open.id);
  ui.photo = null;
  els.photoViewer.classList.add('hidden');
  persist();
  renderRoomCard();
  if (ui.panelWallId) renderPhotoStrip(els.wallPhotos, room, ui.panelWallId);
}
