import { computePoints, boundingBox, closingGap } from './geometry.js';
import { formatLength } from './units.js';
import { openingSpan, openingTags } from './openings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Keeps text upright: an angle along the wall, flipped by 180° if needed.
function readableAngle(angle) {
  let a = angle;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

// Renders the wall chain into the given SVG container element.
export function renderPlan(svg, walls, unit, { selectedWallId = null } = {}) {
  svg.innerHTML = '';

  if (walls.length === 0) {
    svg.setAttribute('viewBox', '0 0 10 10');
    const w = el('text', {
      x: 5,
      y: 5,
      'text-anchor': 'middle',
      'font-size': 0.6,
      class: 'plan-empty-text',
    });
    w.textContent = 'Measure your first wall to start';
    svg.appendChild(w);
    return;
  }

  const points = computePoints(walls);
  const box = boundingBox(points);
  const padding = 1.2; // meters of padding around the drawing
  const width = Math.max(box.maxX - box.minX, 0.5) + padding * 2;
  const height = Math.max(box.maxY - box.minY, 0.5) + padding * 2;
  const viewMinX = box.minX - padding;
  const viewMinY = box.minY - padding;

  svg.setAttribute('viewBox', `${viewMinX} ${viewMinY} ${width} ${height}`);

  const strokeWidth = Math.max(width, height) * 0.012;
  const fontSize = Math.max(width, height) * 0.045;
  const tags = openingTags(walls);

  const group = el('g');
  svg.appendChild(group);
  const hitGroup = el('g');

  // wall segments
  walls.forEach((w, i) => {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const along = (m) => ({ x: a.x + ux * m, y: a.y + uy * m });

    const line = el('line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      class: 'plan-wall' + (w.id === selectedWallId ? ' selected' : ''),
      'stroke-width': strokeWidth,
    });
    group.appendChild(line);

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const textAngle = readableAngle(angle);

    // openings: cut a gap in the wall, then draw the symbol and tag
    (w.openings || []).forEach((o) => {
      const span = openingSpan(w, o);
      const s = along(Math.max(span.startM, 0));
      const e = along(Math.min(span.endM, w.lengthM));
      group.appendChild(el('line', {
        x1: s.x, y1: s.y, x2: e.x, y2: e.y,
        class: 'plan-cut',
        'stroke-width': strokeWidth * 1.6,
      }));
      const jamb = strokeWidth * 1.8;
      [s, e].forEach((p) => {
        group.appendChild(el('line', {
          x1: p.x - nx * jamb, y1: p.y - ny * jamb,
          x2: p.x + nx * jamb, y2: p.y + ny * jamb,
          class: 'plan-opening',
          'stroke-width': strokeWidth * 0.5,
        }));
      });
      if (o.type === 'window') {
        const off = strokeWidth * 0.45;
        [-off, off].forEach((d) => {
          group.appendChild(el('line', {
            x1: s.x + nx * d, y1: s.y + ny * d, x2: e.x + nx * d, y2: e.y + ny * d,
            class: 'plan-opening',
            'stroke-width': strokeWidth * 0.3,
          }));
        });
      } else if (o.type === 'door' || o.type === 'other') {
        group.appendChild(el('line', {
          x1: s.x, y1: s.y, x2: e.x, y2: e.y,
          class: 'plan-opening' + (o.type === 'other' ? ' dotted' : ' dashed'),
          'stroke-width': strokeWidth * 0.3,
        }));
      }
      // tag on the opposite side of the wall to the length label
      const mid = along((Math.max(span.startM, 0) + Math.min(span.endM, w.lengthM)) / 2);
      const tx = mid.x - nx * fontSize * 0.8;
      const ty = mid.y - ny * fontSize * 0.8;
      const tag = el('text', {
        x: tx,
        y: ty,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': fontSize * 0.75,
        transform: `rotate(${textAngle}, ${tx}, ${ty})`,
        class: 'plan-opening-label',
      });
      tag.textContent = `${tags[o.id]} ${formatLength(o.widthM, unit)}`;
      group.appendChild(tag);
    });

    // direction arrowhead at midpoint
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const arrow = el('path', {
      d: `M ${-fontSize * 0.35} ${-fontSize * 0.35} L ${fontSize * 0.35} 0 L ${-fontSize * 0.35} ${fontSize * 0.35} Z`,
      transform: `translate(${mx}, ${my}) rotate(${angle})`,
      class: 'plan-arrow',
    });
    group.appendChild(arrow);

    // length label, offset perpendicular to the wall and rotated to run along it
    const offset = fontSize * 0.9;
    const lx = mx + nx * offset;
    const ly = my + ny * offset;
    const label = el('text', {
      x: lx,
      y: ly,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': fontSize,
      transform: `rotate(${textAngle}, ${lx}, ${ly})`,
      class: 'plan-label' + (w.id === selectedWallId ? ' selected' : ''),
    });
    label.textContent = `${i + 1}. ${formatLength(w.lengthM, unit)}`;
    group.appendChild(label);

    // wide invisible line on top so walls are easy to tap
    hitGroup.appendChild(el('line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      class: 'plan-hit',
      'stroke-width': Math.max(fontSize * 1.6, strokeWidth * 6),
      'data-wall-id': w.id,
    }));
  });

  // closing gap indicator (dashed) if shape isn't closed and has 3+ walls
  const gap = closingGap(walls);
  if (walls.length >= 2 && gap != null && gap > 0.05) {
    const first = points[0];
    const last = points[points.length - 1];
    const dashed = el('line', {
      x1: last.x,
      y1: last.y,
      x2: first.x,
      y2: first.y,
      class: 'plan-gap',
      'stroke-width': strokeWidth * 0.6,
    });
    group.appendChild(dashed);
  }

  // start marker
  const start = points[0];
  group.appendChild(
    el('circle', {
      cx: start.x,
      cy: start.y,
      r: fontSize * 0.35,
      class: 'plan-start',
    })
  );
  const startLabel = el('text', {
    x: start.x,
    y: start.y - fontSize * 0.7,
    'text-anchor': 'middle',
    'font-size': fontSize * 0.85,
    class: 'plan-label plan-start-label',
  });
  startLabel.textContent = 'Start';
  group.appendChild(startLabel);

  // current open end marker
  const end = points[points.length - 1];
  group.appendChild(
    el('circle', {
      cx: end.x,
      cy: end.y,
      r: fontSize * 0.35,
      class: 'plan-end',
    })
  );

  svg.appendChild(hitGroup);
}
