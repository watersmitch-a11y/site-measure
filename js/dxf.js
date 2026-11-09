// CAD export: the printed plan as a DXF drawing (AutoCAD R12 format, which
// every CAD program opens), in millimetres with y up. Walls are closed
// polylines on WALLS, door leaves/swings and window lines on OPENINGS, and
// room names, lengths and opening tags on TEXT.

import { renderPlan } from './render.js';

const LAYERS = [
  { name: 'WALLS', color: 7 },
  { name: 'OPENINGS', color: 4 },
  { name: 'TEXT', color: 2 },
  { name: 'FIXTURES', color: 6 },
];

const mm = (v) => Math.round(v * 1000 * 10) / 10; // plan metres to mm, to 0.1 mm

// DXF R12 text is plain 8-bit text: swap the few symbols the app uses.
const plain = (t) => String(t).replace(/²/g, '2').replace(/×/g, 'x').replace(/–/g, '-').replace(/[^\x20-\x7e]/g, '');

function pairs(list) {
  return list.map(([code, value]) => `${code}\n${value}`).join('\n');
}

export function dxfString(job) {
  const out = [];
  const add = (...rows) => out.push(pairs(rows));
  // each level is drawn on its own, side by side, 5 m apart, with its name over it
  const levels = job.levels && job.levels.length ? job.levels : ['Ground floor'];
  const levelOf = (r) => (r.level && levels.includes(r.level) ? r.level : levels[0]);
  const plans = levels.map((name) => ({ name, rooms: job.rooms.filter((r) => levelOf(r) === name) }))
    .filter((l) => l.rooms.some((r) => r.walls.length));
  let shiftX = 0;
  plans.forEach((plan) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    renderPlan(svg, plan.rooms, job.unit, { print: true });
    const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    const dx = shiftX - vb[0];
    if (plans.length > 1) {
      add([0, 'TEXT'], [8, 'TEXT'], [10, mm(dx + vb[0])], [20, mm(-vb[1]) + 300], [30, 0], [40, 400], [1, plain(plan.name)]);
    }
    drawPlanSvg(svg, add, (x, y) => [mm(x + dx), mm(-y)]);
    shiftX += vb[2] + 5;
  });
  return wrapDxf(out);
}

// The entities for one rendered plan. P maps plan metres to CAD millimetres.
function drawPlanSvg(svg, add, P) {
  svg.querySelectorAll('polygon.plan-band').forEach((poly) => {
    const pts = poly.getAttribute('points').trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
    add([0, 'POLYLINE'], [8, 'WALLS'], [66, 1], [70, 1]);
    pts.forEach(([x, y]) => {
      const [X, Y] = P(x, y);
      add([0, 'VERTEX'], [8, 'WALLS'], [10, X], [20, Y], [30, 0]);
    });
    add([0, 'SEQEND'], [8, 'WALLS']);
  });

  svg.querySelectorAll('circle.plan-fixture').forEach((c) => {
    const [x, y] = P(Number(c.getAttribute('cx')), Number(c.getAttribute('cy')));
    add([0, 'CIRCLE'], [8, 'FIXTURES'], [10, x], [20, y], [30, 0], [40, mm(Number(c.getAttribute('r')))]);
  });
  svg.querySelectorAll('line.plan-fixture-line').forEach((line) => {
    const [x1, y1] = P(Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
    const [x2, y2] = P(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
    add([0, 'LINE'], [8, 'FIXTURES'], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]);
  });

  svg.querySelectorAll('line.plan-opening').forEach((line) => {
    const [x1, y1] = P(Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
    const [x2, y2] = P(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
    add([0, 'LINE'], [8, 'OPENINGS'], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]);
  });

  // door swings: a quarter circle about the hinge, from the leaf's tip to the latch
  svg.querySelectorAll('path.plan-swing').forEach((path) => {
    const [hx, hy] = path.getAttribute('data-hinge').split(',').map(Number);
    const nums = path.getAttribute('d').match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);
    const [tx, ty] = [nums[0], nums[1]];
    const [lx, ly] = [nums[nums.length - 2], nums[nums.length - 1]];
    const r = Math.hypot(lx - hx, ly - hy);
    const deg = (x, y) => (((Math.atan2(-(y - hy), x - hx) * 180) / Math.PI) + 360) % 360;
    let a1 = deg(tx, ty);
    let a2 = deg(lx, ly);
    if ((a2 - a1 + 360) % 360 > 180) [a1, a2] = [a2, a1]; // DXF arcs run anticlockwise
    const [cx, cy] = P(hx, hy);
    add([0, 'ARC'], [8, 'OPENINGS'], [10, cx], [20, cy], [30, 0], [40, mm(r)], [50, a1.toFixed(3)], [51, a2.toFixed(3)]);
  });

  svg.querySelectorAll('text').forEach((text) => {
    const content = plain(text.textContent).trim();
    if (!content) return;
    const x = Number(text.getAttribute('x'));
    const y = Number(text.getAttribute('y'));
    const h = Number(text.getAttribute('font-size')) || 0.2;
    const rot = /rotate\(\s*(-?[\d.e-]+)/i.exec(text.getAttribute('transform') || '');
    const [X, Y] = P(x, y);
    add([0, 'TEXT'], [8, text.classList.contains('plan-fixture-label') ? 'FIXTURES' : 'TEXT'], [10, X], [20, Y], [30, 0], [40, mm(h * 0.8)], [1, content],
      [50, rot ? (-Number(rot[1])).toFixed(3) : 0], [72, 1], [11, X], [21, Y], [31, 0], [73, 2]);
  });
}

function wrapDxf(out) {
  const header = pairs([
    [0, 'SECTION'], [2, 'HEADER'],
    [9, '$ACADVER'], [1, 'AC1009'],
    [9, '$INSUNITS'], [70, 4],
    [0, 'ENDSEC'],
  ]);
  const tables = [
    pairs([[0, 'SECTION'], [2, 'TABLES']]),
    pairs([[0, 'TABLE'], [2, 'LTYPE'], [70, 1],
      [0, 'LTYPE'], [2, 'CONTINUOUS'], [70, 0], [3, 'Solid line'], [72, 65], [73, 0], [40, 0.0],
      [0, 'ENDTAB']]),
    pairs([[0, 'TABLE'], [2, 'LAYER'], [70, LAYERS.length]]),
    ...LAYERS.map((l) => pairs([[0, 'LAYER'], [2, l.name], [70, 0], [62, l.color], [6, 'CONTINUOUS']])),
    pairs([[0, 'ENDTAB'], [0, 'ENDSEC']]),
  ].join('\n');
  const entities = [pairs([[0, 'SECTION'], [2, 'ENTITIES']]), ...out, pairs([[0, 'ENDSEC'], [0, 'EOF']])].join('\n');
  return `${header}\n${tables}\n${entities}\n`;
}

export function exportDxf(job) {
  return new Blob([dxfString(job).replace(/\n/g, '\r\n')], { type: 'application/dxf' });
}
