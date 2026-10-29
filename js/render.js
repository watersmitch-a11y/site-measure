import { computePoints, boundingBox, closingGap } from './geometry.js';
import { formatLength } from './units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// Renders the wall chain into the given SVG container element.
export function renderPlan(svg, walls, unit) {
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

  const group = el('g');
  svg.appendChild(group);

  // wall segments
  walls.forEach((w, i) => {
    const a = points[i];
    const b = points[i + 1];
    const line = el('line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      class: 'plan-wall',
      'stroke-width': strokeWidth,
    });
    group.appendChild(line);

    // direction arrowhead at midpoint
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
    const arrow = el('path', {
      d: `M ${-fontSize * 0.35} ${-fontSize * 0.35} L ${fontSize * 0.35} 0 L ${-fontSize * 0.35} ${fontSize * 0.35} Z`,
      transform: `translate(${mx}, ${my}) rotate(${angle})`,
      class: 'plan-arrow',
    });
    group.appendChild(arrow);

    // length label, offset perpendicular to the wall
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offset = fontSize * 0.9;
    const lx = mx + nx * offset;
    const ly = my + ny * offset;
    // rotate the label to run along the wall, flipped so it never reads upside down
    let textAngle = angle;
    if (textAngle > 90) textAngle -= 180;
    if (textAngle <= -90) textAngle += 180;
    const label = el('text', {
      x: lx,
      y: ly,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': fontSize,
      transform: `rotate(${textAngle}, ${lx}, ${ly})`,
      class: 'plan-label',
    });
    label.textContent = `${i + 1}. ${formatLength(w.lengthM, unit)}`;
    group.appendChild(label);
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
}
