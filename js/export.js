// Builds a printable plan and schedule for the whole job and opens the
// browser's print dialog, where it can be saved as a PDF.

import { renderPlan } from './render.js';
import * as units from './units.js';
import * as geo from './geometry.js';
import * as op from './openings.js';
import { computeFrames, roomLabel } from './rooms.js';

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

// cornerLabels(idx, walls) -> { start, end } as used in the app's panels
export function exportPlan(job, { cornerLabels }) {
  const { unit, rooms } = job;
  const fmt = (m) => units.formatLength(m, unit);
  const area = (m2) => units.formatArea(m2, unit);
  const frames = computeFrames(rooms);
  const tags = op.openingTags(rooms.flatMap((r) => r.walls));
  const measured = rooms.filter((r) => r.walls.length >= 3);
  const totalArea = measured.reduce((sum, r) => sum + geo.area(r.walls), 0);

  const roomSections = rooms.map((room, ri) => {
    if (room.walls.length === 0) return '';
    const headings = geo.computeHeadings(room.walls, frames.get(room.id).heading);
    const closed = room.walls.length >= 3 && geo.closingGap(room.walls) <= 0.05;
    const wallAreas = op.wallAreas(room.walls, room.ceilingHeightM);
    const summary = [
      room.walls.length >= 3 ? `Floor area ${area(geo.area(room.walls))}` : null,
      `Perimeter ${fmt(geo.perimeter(room.walls))}`,
      room.ceilingHeightM ? `Ceiling ${fmt(room.ceilingHeightM)}` : null,
      wallAreas.wallsCounted ? `Wall area net ${area(wallAreas.net)}` : null,
      closed ? null : 'Not closed',
    ].filter(Boolean).join(' · ');

    const wallRows = room.walls.map((w, i) => {
      const notes = [];
      if (w.ceilingHeightM) notes.push(`Ceiling ${fmt(w.ceilingHeightM)}`);
      if (w.sharedWith) {
        const host = rooms.find((r) => r.id === w.sharedWith.roomId);
        const hostWall = host ? host.walls.findIndex((x) => x.id === w.sharedWith.wallId) : -1;
        if (host && hostWall >= 0) notes.push(`Shared with ${roomLabel(host, rooms.indexOf(host))} wall ${hostWall + 1}`);
      }
      return `<tr><td>${i + 1}</td><td>${fmt(w.lengthM)}</td><td>${directionName(headings[i])}</td><td>${esc(notes.join(' · '))}</td></tr>`;
    }).join('');

    const openingRows = room.walls.flatMap((w, i) => (w.openings || []).map((o) => {
      const corners = cornerLabels(i, room.walls);
      const corner = o.fromCorner === 'end' ? corners.end : corners.start;
      const details = [];
      if (o.type === 'window' || o.sillM) details.push(`Sill ${fmt(o.sillM || 0)}`);
      if (o.type === 'door') details.push(`Hinge ${o.hinge === 'right' ? 'right' : 'left'}, opens ${o.swing === 'out' ? 'out' : 'in'}`);
      if (o.note) details.push(o.note);
      return `<tr><td>${tags[o.id]}</td><td>${op.OPENING_TYPES[o.type].label}</td>` +
        `<td>${fmt(o.widthM)} × ${fmt(o.heightM)}</td><td>Wall ${i + 1}, ${fmt(o.offsetM)} from ${esc(corner.toLowerCase())}</td>` +
        `<td>${op.MEASURED_TO[o.measuredTo] || ''}</td><td>${esc(details.join(' · '))}</td></tr>`;
    })).join('');

    return `<section>
      <h2>${esc(roomLabel(room, ri))}</h2>
      <p class="room-summary">${summary}</p>
      <h3>Walls</h3>
      <table><thead><tr><th>#</th><th>Length</th><th>Direction</th><th>Notes</th></tr></thead><tbody>${wallRows}</tbody></table>
      ${openingRows ? `<h3>Openings</h3>
      <table><thead><tr><th>Tag</th><th>Type</th><th>W × H</th><th>Position</th><th>Measured to</th><th>Details</th></tr></thead><tbody>${openingRows}</tbody></table>` : ''}
    </section>`;
  }).join('');

  const view = document.getElementById('printView');
  const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  view.innerHTML = `
    <h1>${esc(job.name)}</h1>
    <p class="print-meta">Site measure · ${date} · ${units.UNIT_LABELS[unit]}</p>
    <div class="print-plan"><svg viewBox="0 0 10 10" preserveAspectRatio="xMidYMid meet"></svg></div>
    ${measured.length > 1 ? `<p class="job-total">Total floor area ${area(totalArea)} (${measured.length} rooms)</p>` : ''}
    ${roomSections}`;
  renderPlan(view.querySelector('svg'), rooms, unit, { print: true });

  // the browser's own name for the PDF comes from the page title
  const title = document.title;
  document.title = `${job.name} – site measure`;
  window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
  window.print();
}
