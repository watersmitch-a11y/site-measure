// Builds a printable plan and schedule for the whole job and opens the
// browser's print dialog, where it can be saved as a PDF.

import { renderPlan } from './render.js';
import * as units from './units.js';
import * as geo from './geometry.js';
import * as op from './openings.js';
import * as rm from './rooms.js';

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function directionName(heading) {
  const a = ((heading % 360) + 360) % 360;
  const names = { 0: '↑ Up', 90: '→ Right', 180: '↓ Down', 270: '← Left' };
  const square = [0, 90, 180, 270, 360].find((h) => Math.abs(h - a) < 0.01);
  return square !== undefined ? names[square % 360] : `${a.toFixed(0)}° from up`;
}

function titleBlock(details = {}) {
  const rows = [['Site address', details.address], ['Client', details.client], ['Measured by', details.measuredBy]]
    .filter(([, v]) => v);
  if (!rows.length) return '';
  return `<table class="title-block"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}

// planEnds(idx, room) -> { start: 'left', end: 'right' } as used in the app's panels
// wallName(idx, room) -> 'top' etc.; photoUrl(id) -> Promise of an image URL
export async function exportPlan(job, { planEnds, wallName = (i) => `wall ${i + 1}`, photoUrl = null }) {
  const { unit, rooms } = job;
  const fmt = (m) => units.formatLength(m, unit);
  const area = (m2) => units.formatArea(m2, unit);
  const geom = rm.roomGeometry(rooms);
  const merges = rm.wallMerges(rooms, geom);
  const tagOwner = new Map(rooms.flatMap((r) => r.walls.flatMap((w) => (w.openings || []).map((o) => [o.id, r]))));
  const tags = op.openingTags(rooms.flatMap((r) => r.walls));
  const measured = rooms.filter((r) => rm.roomArea(r, geom.get(r.id)) != null);
  const totalArea = measured.reduce((sum, r) => sum + rm.roomArea(r, geom.get(r.id)), 0);

  const roomSections = rooms.map((room, ri) => {
    if (room.walls.length === 0) return '';
    const g = geom.get(room.id);
    const headings = geo.computeHeadings(room.walls, g.frame.heading);
    const floor = rm.roomArea(room, g);
    const wallAreas = op.wallAreas(room.walls, room.ceilingHeightM);
    const sharedArea = rm.sharedWallArea(rooms, room, room.ceilingHeightM);
    const span = rm.sharedSpan(rooms, room);
    const summary = [
      floor != null ? `Floor area ${area(floor)}` : null,
      `Perimeter ${fmt(rm.roomPerimeter(rooms, room))}`,
      room.ceilingHeightM ? `Ceiling ${fmt(room.ceilingHeightM)}` : null,
      wallAreas.wallsCounted || sharedArea ? `Wall area net ${area(wallAreas.net + sharedArea)}` : null,
      rm.roomClosed(room, g) ? null : 'Not closed',
      room.diagonal ? `Diagonal measured ${fmt(room.diagonal.lengthM)} (plan ${fmt(rm.cornerDistance(rooms, room, room.diagonal.a, room.diagonal.b))})` : null,
    ].filter(Boolean).join(' · ');
    const sharedNote = span
      ? `<p class="room-summary">Shares ${esc(rm.roomLabel(span.host, span.hostIndex))} wall ${span.wallIdx + 1}: ` +
        `${fmt(span.lengthM)} of it, ${fmt(room.anchor.thicknessM)} wall.</p>`
      : '';

    const wallRows = room.walls.map((w, i) => {
      const notes = [];
      if (w.ceilingHeightM) notes.push(`Ceiling ${fmt(w.ceilingHeightM)}`);
      if (w.thicknessM) notes.push(`${fmt(w.thicknessM)} wall`);
      return `<tr><td>${i + 1}</td><td>${fmt(w.lengthM)}</td><td>${directionName(headings[i])}</td><td>${esc(notes.join(' · '))}</td></tr>`;
    }).join('');

    const openingRows = room.walls.flatMap((w, i) => (w.openings || []).map((o) => {
      const ends = planEnds(i, room);
      const from = `${ends[o.fromCorner === 'end' ? 'end' : 'start']} end`;
      const details = [];
      if (o.type === 'window' || o.sillM) details.push(`Sill ${fmt(o.sillM || 0)}`);
      if (o.type === 'door') details.push(`Hinge ${o.hinge === 'right' ? 'right' : 'left'}, opens ${o.swing === 'out' ? 'out' : 'in'}`);
      const same = merges.sameAs.get(o.id);
      if (same) {
        const owner = tagOwner.get(same.openingId);
        details.push(`Same doorway as ${rm.roomLabel(owner, rooms.indexOf(owner))} ${tags[same.openingId]}`);
      }
      if (o.note) details.push(o.note);
      return `<tr><td>${tags[o.id]}</td><td>${op.OPENING_TYPES[o.type].label}</td>` +
        `<td>${fmt(o.widthM)} × ${fmt(o.heightM)}</td><td>Wall ${i + 1}, ${fmt(o.offsetM)} from ${from}</td>` +
        `<td>${op.MEASURED_TO[o.measuredTo] || ''}</td><td>${esc(details.join(' · '))}</td></tr>`;
    })).join('');

    const photoFigures = (room.photos || []).map((p) => {
      const idx = p.wallId ? room.walls.findIndex((w) => w.id === p.wallId) : -1;
      const where = idx >= 0 ? `${wallName(idx, room)} wall` : 'Room';
      const caption = [where.charAt(0).toUpperCase() + where.slice(1), p.note].filter(Boolean).join(' – ');
      return `<figure><img data-photo="${esc(p.id)}" alt="" /><figcaption>${esc(caption)}</figcaption></figure>`;
    }).join('');

    return `<section>
      <h2>${esc(rm.roomLabel(room, ri))}</h2>
      <p class="room-summary">${summary}</p>
      ${sharedNote}
      <h3>Walls</h3>
      <table><thead><tr><th>#</th><th>Length</th><th>Direction</th><th>Notes</th></tr></thead><tbody>${wallRows}</tbody></table>
      ${openingRows ? `<h3>Openings</h3>
      <table><thead><tr><th>Tag</th><th>Type</th><th>W × H</th><th>Position</th><th>Measured to</th><th>Details</th></tr></thead><tbody>${openingRows}</tbody></table>` : ''}
      ${photoFigures ? `<h3>Photos</h3><div class="print-photos">${photoFigures}</div>` : ''}
    </section>`;
  }).join('');

  const view = document.getElementById('printView');
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  view.innerHTML = `
    <h1>${esc(job.name)}</h1>
    <p class="print-meta">Site measure · ${date} · ${units.UNIT_LABELS[unit]}</p>
    ${titleBlock(job.details)}
    <div class="print-plan"><svg viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet"></svg></div>
    ${measured.length > 1 ? `<p class="job-total">Total floor area ${area(totalArea)} (${measured.length} rooms)</p>` : ''}
    ${roomSections}`;
  renderPlan(view.querySelector('svg'), rooms, unit, { print: true });

  // photos have to be loaded before the print screen takes its copy
  const imgs = [...view.querySelectorAll('img[data-photo]')];
  await Promise.all(imgs.map(async (img) => {
    const url = photoUrl ? await photoUrl(img.dataset.photo) : '';
    if (!url) { img.closest('figure').remove(); return; }
    img.src = url;
    await img.decode().catch(() => {});
  }));

  // the browser's own name for the PDF comes from the page title
  const title = document.title;
  document.title = `${job.name} – site measure`;
  window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
  window.print();
}
