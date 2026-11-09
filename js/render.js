import { boundingBox } from './geometry.js';
import { formatLength, formatArea } from './units.js';
import { openingSpan, openingTags } from './openings.js';
import { fixtureSpan, fixtureTags } from './fixtures.js';
import {
  roomGeometry, closingGap, polygonArea, insideSign as roomInsideSign, roomLabel, wallMerges, DEFAULT_WALL_THICKNESS_M, wallThickness,
} from './rooms.js';

// Walls are drawn to scale as bands this thick, outside the measured
// (plaster) line, so rooms placed a wall apart share one solid wall.
const WALL_T = DEFAULT_WALL_THICKNESS_M;

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// ---------- keeping labels clear of each other ----------
// Labels are drawn where they'd ideally go, with a few fallback spots. Once
// everything's drawn, each label (most important first) takes the first spot
// that doesn't overlap a label already placed, a wall line or a door swing.

const textSize = (text, fs) => ({ w: Math.max(String(text).length, 1) * fs * 0.56, h: fs * 1.05 });

// Does the segment p→q cross the box of half-size hw×hh centred at c and
// turned by angle (degrees)?
function segmentHitsBox(p, q, c, hw, hh, angle) {
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = (v) => ({ x: (v.x - c.x) * cos - (v.y - c.y) * sin, y: (v.x - c.x) * sin + (v.y - c.y) * cos });
  const a = local(p);
  const b = local(q);
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (pp, qq) => {
    if (Math.abs(pp) < 1e-12) return qq >= 0;
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a.x + hw) && clip(dx, hw - a.x) && clip(-dy, a.y + hh) && clip(dy, hh - a.y);
}

function boxOf(item, p) {
  const rad = ((item.angle || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const hw = item.w / 2;
  const hh = item.h / 2;
  const ex = c * hw + s * hh;
  const ey = s * hw + c * hh;
  return { x0: p.x - ex, x1: p.x + ex, y0: p.y - ey, y1: p.y + ey };
}

const boxesOverlap = (a, b, pad) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

function placeLabels(ctx) {
  const placed = [...ctx.obstacles];
  const pad = ctx.fontSize * 0.08;
  [...ctx.labels].sort((a, b) => a.prio - b.prio).forEach((item) => {
    const allowed = item.inside ? item.cands.filter(item.inside) : item.cands;
    const pool = allowed.length ? allowed : item.cands;
    const sized = (k) => ({ ...item, w: item.w * k, h: item.h * k });
    const fits = (it, p) => {
      const box = boxOf(it, p);
      if (placed.some((o) => boxesOverlap(box, o, pad))) return false;
      const hw = it.w / 2 + pad;
      const hh = it.h / 2 + pad;
      return !ctx.segments.some(([a, b]) => segmentHitsBox(a, b, p, hw, hh, it.angle || 0));
    };
    // full size if there's a clear spot, else a little smaller (names and tags)
    let scale = 1;
    let at = null;
    for (const k of [1, ...(item.shrink || [])]) {
      at = pool.find((p) => fits(sized(k), p));
      if (at) { scale = k; break; }
    }
    if (!at) {
      // nowhere clear: take the spot that covers least of what's there
      scale = (item.shrink || [1]).slice(-1)[0];
      const it = sized(scale);
      const cost = (p) => {
        const box = boxOf(it, p);
        let c = 0;
        placed.forEach((o) => {
          const w = Math.min(box.x1, o.x1) - Math.max(box.x0, o.x0);
          const h = Math.min(box.y1, o.y1) - Math.max(box.y0, o.y0);
          if (w > 0 && h > 0) c += w * h;
        });
        ctx.segments.forEach(([a, b]) => { if (segmentHitsBox(a, b, p, it.w / 2, it.h / 2, it.angle || 0)) c += it.h * it.h * 0.5; });
        return c;
      };
      at = pool.reduce((best, p) => (cost(p) < cost(best) ? p : best), pool[0]);
    }
    placed.push(boxOf(sized(scale), at));
    if (scale !== 1) {
      item.el.setAttribute('font-size', Number(item.el.getAttribute('font-size')) * scale);
      if (item.onScale) item.onScale(scale);
    }
    item.el.setAttribute('x', at.x);
    item.el.setAttribute('y', at.y);
    if (item.angle) item.el.setAttribute('transform', `rotate(${item.angle}, ${at.x}, ${at.y})`);
    if (item.after) item.after(at, scale);
  });
}

function insidePolygon(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Keeps text upright: an angle along the wall, flipped by 180° if needed.
function readableAngle(angle) {
  let a = angle;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

// The view that fits every room, with some padding, in plan metres.
export function fitViewBox(rooms) {
  const points = [...roomGeometry(rooms).values()].flatMap((g) => g.points);
  if (points.length < 2) return { x: 0, y: 0, width: 10, height: 10 };
  const box = boundingBox(points);
  const padding = 1.2;
  return {
    x: box.minX - padding,
    y: box.minY - padding,
    width: Math.max(box.maxX - box.minX, 0.5) + padding * 2,
    height: Math.max(box.maxY - box.minY, 0.5) + padding * 2,
  };
}

// Renders every room of the job. The active room gets full detail (lengths,
// arrows, start/end markers); other rooms are drawn dimmed with their name.
// For print, every room is dimensioned, with lengths inside each room so
// shared walls don't put two labels in the same gap, and no arrows/markers.
// viewBox ({ x, y, width, height }) holds the view still, e.g. while dragging.
export function renderPlan(svg, rooms, unit, {
  activeRoomId = null, selectedWallId = null, previewLine = null, gapDims = [], print = false, viewBox = null, movingIds = null,
} = {}) {
  svg.innerHTML = '';

  const geom = roomGeometry(rooms);
  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  const anyWalls = rooms.some((r) => r.walls.length > 0);

  if (!anyWalls) {
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

  const view = viewBox || fitViewBox(rooms);
  const { width, height } = view;
  const viewMinX = view.x;
  const viewMinY = view.y;

  svg.setAttribute('viewBox', `${viewMinX} ${viewMinY} ${width} ${height}`);

  // print is viewed much larger than a phone screen, so finer lines and text
  const strokeWidth = Math.max(width, height) * (print ? 0.005 : 0.012);
  const fontSize = Math.max(width, height) * (print ? 0.024 : 0.045);
  const tags = openingTags(rooms.flatMap((r) => r.walls));
  const fxTags = fixtureTags(rooms.flatMap((r) => r.walls));

  const hitGroup = el('g');
  // shared stretches and doorways of the room being worked on, drawn undimmed on top
  const brightGroup = el('g', { class: 'plan-room active' });
  const merges = wallMerges(rooms, geom);
  const ctx = {
    unit, strokeWidth, fontSize, tags, fxTags, selectedWallId, hitGroup, print, merges, brightGroup, activeRoomId, movingIds,
    labels: [], obstacles: [], segments: [],
  };

  if (print) {
    rooms.forEach((r, i) => drawRoom(svg, r, i, geom.get(r.id), true, ctx));
    svg.appendChild(brightGroup);
    placeLabels(ctx);
    return;
  }

  // inactive rooms first so the active room draws on top
  // one room failing to draw mustn't take the rest of the plan with it
  const safeDraw = (r, active) => {
    try {
      drawRoom(svg, r, rooms.indexOf(r), geom.get(r.id), active, ctx);
    } catch (err) {
      console.error(`Couldn't draw ${roomLabel(r, rooms.indexOf(r))}`, err);
    }
  };
  rooms.filter((r) => r !== activeRoom).forEach((r) => safeDraw(r, false));
  if (activeRoom) safeDraw(activeRoom, true);
  svg.appendChild(brightGroup);
  placeLabels(ctx);

  // clear runs to the next room's wall, for drawing a room into a gap
  gapDims.forEach((dim) => {
    const dx = dim.x2 - dim.x1;
    const dy = dim.y2 - dim.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const tick = fontSize * 0.3;
    svg.appendChild(el('line', {
      x1: dim.x1, y1: dim.y1, x2: dim.x2, y2: dim.y2,
      class: 'plan-dim', 'stroke-width': strokeWidth * 0.4,
    }));
    svg.appendChild(el('line', {
      x1: dim.x2 - nx * tick, y1: dim.y2 - ny * tick, x2: dim.x2 + nx * tick, y2: dim.y2 + ny * tick,
      class: 'plan-dim-tick', 'stroke-width': strokeWidth * 0.5,
    }));
    const mx = (dim.x1 + dim.x2) / 2 + nx * fontSize * 0.6;
    const my = (dim.y1 + dim.y2) / 2 + ny * fontSize * 0.6;
    const label = el('text', {
      x: mx, y: my,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': fontSize * 0.8,
      transform: `rotate(${readableAngle(Math.atan2(dy, dx) * (180 / Math.PI))}, ${mx}, ${my})`,
      class: 'plan-dim-label',
    });
    label.textContent = dim.label;
    svg.appendChild(label);
  });

  // the shared wall a new room will get, while it's being placed
  if (previewLine) {
    svg.appendChild(el('line', {
      ...previewLine,
      class: 'plan-preview-line',
      'stroke-width': strokeWidth * 1.2,
    }));
    svg.appendChild(el('circle', {
      cx: previewLine.x1,
      cy: previewLine.y1,
      r: fontSize * 0.4,
      class: 'plan-preview',
      'stroke-width': strokeWidth * 0.5,
    }));
  }

  svg.appendChild(hitGroup);
}

// g: the room's geometry from roomGeometry ({ points, target })
function drawRoom(svg, room, roomIndex, g, active, ctx) {
  const { points, target } = g;
  const { unit, strokeWidth, fontSize, tags, selectedWallId, hitGroup, print, merges, brightGroup, activeRoomId } = ctx;
  const walls = room.walls;
  // rooms being moved along with the active one are picked out too
  const moving = !active && ctx.movingIds && ctx.movingIds.includes(room.id);
  const group = el('g', { class: active ? 'plan-room active' : moving ? 'plan-room moving' : 'plan-room dim' });
  svg.appendChild(group);

  // Which side of each wall is inside the room. With y pointing down, +1
  // means the room is on the right-hand side of the direction of travel,
  // i.e. along (nx, ny) below.
  const insideSign = roomInsideSign(points);

  // Outer corners of the wall bands, mitred where two walls meet.
  const n = walls.length;
  const unitOf = (j) => {
    const p = points[j];
    const q = points[j + 1];
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
  };
  const outOf = (u) => ({ x: u.y * insideSign, y: -u.x * insideSign }); // outward normal
  const T = (k) => wallThickness(walls[k]); // each wall's own thickness
  const loop = n > 1 && Math.hypot(points[0].x - points[n].x, points[0].y - points[n].y) < 0.01;
  const outerCorner = (j) => {
    const before = j > 0 ? j - 1 : loop ? n - 1 : null;
    const after = j < n ? j : loop ? 0 : null;
    const p = points[j];
    const plain = (k) => { const o = outOf(unitOf(k)); return { x: p.x + o.x * T(k), y: p.y + o.y * T(k) }; };
    if (before === null && after === null) return p; // a room with no walls yet
    if (before === null) return plain(after);
    if (after === null) return plain(before);
    const u1 = unitOf(before);
    const u2 = unitOf(after);
    const o1 = outOf(u1);
    const o2 = outOf(u2);
    const P = { x: p.x + o1.x * T(before), y: p.y + o1.y * T(before) };
    const Q = { x: p.x + o2.x * T(after), y: p.y + o2.y * T(after) };
    const cross = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(cross) < 1e-6) return Q;
    const t = ((Q.x - P.x) * u2.y - (Q.y - P.y) * u2.x) / cross;
    const m = { x: P.x + u1.x * t, y: P.y + u1.y * t };
    return Math.hypot(m.x - p.x, m.y - p.y) > Math.max(T(before), T(after)) * 4 ? Q : m; // very sharp corners: no long spike
  };
  const corners = points.map((_, j) => outerCorner(j));

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
    const ox = nx * -insideSign; // outward normal
    const oy = ny * -insideSign;
    const WT = T(i);
    const outward = (p, d = WT) => ({ x: p.x + ox * d, y: p.y + oy * d });
    // both faces of the wall, for keeping labels off it
    if (len > 0.01) ctx.segments.push([a, b], [outward(a), outward(b)]);

    const key = `${room.id}|${i}`;
    const hidden = merges.hidden.get(key) || [];
    // shared stretches drawn bright when the other room is the one being worked on
    const brightRanges = active || print
      ? []
      : (merges.shared.get(key) || []).filter((sh) => sh.otherRoomId === activeRoomId).map((sh) => [sh.s, sh.e]);
    const inRanges = (m, ranges) => ranges.some(([rs, re]) => m >= rs - 0.001 && m <= re + 0.001);
    const groupAt = (m) => (inRanges(m, brightRanges) ? brightGroup : group);

    // the wall band, less any stretch another room draws for both
    const wallClass = 'plan-band' + (active && w.id === selectedWallId ? ' selected' : '');
    // doorways and windows leave real gaps in the band (so a CAD export has
    // them too): this wall's own openings, and the other room's on a shared
    // stretch this wall draws
    const cuts = [
      ...(w.openings || []).map((o) => openingSpan(w, o))
        .filter((sp) => !inRanges((sp.startM + sp.endM) / 2, hidden)),
      ...(merges.extras.get(key) || []).map((x) => ({ startM: x.startM, endM: x.endM })),
    ].map((sp) => [Math.max(sp.startM, 0), Math.min(sp.endM, len)]).filter(([cs, ce]) => ce - cs > 0.001)
      .sort((x, y) => x[0] - y[0]);
    const drawStretch = (target, from, to) => {
      let at = from;
      cuts.forEach(([cs, ce]) => {
        if (ce <= at || cs >= to) return;
        if (cs > at + 0.001) drawPiece(target, at, cs);
        at = Math.max(at, ce);
      });
      if (to > at + 0.001) drawPiece(target, at, to);
    };
    const drawPiece = (target, from, to) => {
      const p = along(from);
      const q = along(to);
      const pOut = from < 0.001 ? corners[i] : outward(p);
      const qOut = to > len - 0.001 ? corners[i + 1] : outward(q);
      const pts = [p, q, qOut, pOut].map((v) => `${v.x},${v.y}`).join(' ');
      target.appendChild(el('polygon', { points: pts, class: wallClass }));
    };
    let cursor = 0;
    [...hidden].sort((x, y) => x[0] - y[0]).forEach(([hs, he]) => {
      if (hs > cursor + 0.001) drawStretch(group, cursor, hs);
      cursor = Math.max(cursor, he);
    });
    if (cursor < len - 0.001) drawStretch(group, cursor, len);
    brightRanges.forEach(([bs, be]) => drawStretch(brightGroup, bs, be));

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const textAngle = readableAngle(angle);

    // Cut a gap in the wall for an opening and draw its symbol and tag. side
    // is the inside of the room the opening was measured from: this room, or
    // for another room's doorway drawn on this shared wall, the far side.
    const drawOpening = (target, o, span, side) => {
      let tagPos = null;
      let tagText = `${tags[o.id]} ${formatLength(o.widthM, unit)}`;
      const s0 = along(Math.max(span.startM, 0));
      const e0 = along(Math.min(span.endM, w.lengthM));
      // the band already has a gap here (see cuts above); draw the jambs
      [s0, e0].forEach((p) => {
        const q = outward(p);
        target.appendChild(el('line', {
          x1: p.x, y1: p.y, x2: q.x, y2: q.y,
          class: 'plan-opening',
          'stroke-width': strokeWidth * 0.4,
        }));
      });
      // the face of the band on the measuring room's side, where its symbols sit
      const towardsRoom = nx * side * ox + ny * side * oy > 0; // that room is beyond this wall
      const s = towardsRoom ? outward(s0) : s0;
      const e = towardsRoom ? outward(e0) : e0;
      if (o.type === 'window') {
        [WT / 3, (WT * 2) / 3].forEach((d) => {
          const p = outward(s0, d);
          const q = outward(e0, d);
          target.appendChild(el('line', {
            x1: p.x, y1: p.y, x2: q.x, y2: q.y,
            class: 'plan-opening',
            'stroke-width': strokeWidth * 0.3,
          }));
        });
      } else if (o.type === 'door') {
        // leaf from the hinge jamb plus a quarter-circle swing to the other jamb
        const inX = nx * side;
        const inY = ny * side;
        const swingX = o.swing === 'out' ? -inX : inX;
        const swingY = o.swing === 'out' ? -inY : inY;
        // "left" as seen standing in the room facing the door
        const leftX = -inY;
        const leftY = inX;
        const sIsLeft = (s0.x - e0.x) * leftX + (s0.y - e0.y) * leftY > 0;
        const hingeLeft = o.hinge !== 'right';
        // hinged on the face the door swings towards
        const swingsOut = swingX * ox + swingY * oy > 0;
        const [fs, fe] = swingsOut ? [outward(s0), outward(e0)] : [s0, e0];
        const hinge = sIsLeft === hingeLeft ? fs : fe;
        const latch = hinge === fs ? fe : fs;
        const r = Math.hypot(latch.x - hinge.x, latch.y - hinge.y);
        const tip = { x: hinge.x + swingX * r, y: hinge.y + swingY * r };
        const cross = (tip.x - hinge.x) * (latch.y - hinge.y) - (tip.y - hinge.y) * (latch.x - hinge.x);
        target.appendChild(el('line', {
          x1: hinge.x, y1: hinge.y, x2: tip.x, y2: tip.y,
          class: 'plan-opening',
          'stroke-width': strokeWidth * 0.45,
        }));
        target.appendChild(el('path', {
          d: `M ${tip.x} ${tip.y} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${latch.x} ${latch.y}`,
          class: 'plan-opening plan-swing',
          'data-hinge': `${hinge.x},${hinge.y}`, // for the CAD export's arc
          'stroke-width': strokeWidth * 0.3,
        }));
        // the swing's area is kept clear of other labels
        const xs = [hinge.x, tip.x, latch.x, hinge.x + (swingX + (latch.x - hinge.x) / r) * r * 0.71];
        const ys = [hinge.y, tip.y, latch.y, hinge.y + (swingY + (latch.y - hinge.y) / r) * r * 0.71];
        ctx.obstacles.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), door: true });
        // tag sits inside the swing, clear of the leaf and the arc
        tagPos = {
          x: hinge.x + (swingX + (latch.x - hinge.x) / r) * r * 0.42,
          y: hinge.y + (swingY + (latch.y - hinge.y) / r) * r * 0.42,
        };
        tagText = tags[o.id];
      } else if (o.type === 'other') {
        const p = outward(s0, WT / 2);
        const q = outward(e0, WT / 2);
        target.appendChild(el('line', {
          x1: p.x, y1: p.y, x2: q.x, y2: q.y,
          class: 'plan-opening dotted',
          'stroke-width': strokeWidth * 0.3,
        }));
      }
      // other openings are tagged inside the measuring room; wall lengths go outside
      const isDoorTag = !!tagPos;
      if (!tagPos) {
        const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
        tagPos = {
          x: mid.x + nx * side * fontSize * 0.8,
          y: mid.y + ny * side * fontSize * 0.8,
        };
      }
      const { x: tx, y: ty } = tagPos;
      const tag = el('text', {
        x: tx,
        y: ty,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': fontSize * 0.75,
        transform: `rotate(${textAngle}, ${tx}, ${ty})`,
        class: 'plan-opening-label',
      });
      tag.textContent = tagText;
      target.appendChild(tag);
      // a door's tag stays in its swing (whose area keeps others away);
      // other tags can step further into the room
      if (!isDoorTag) {
        const step = (k) => ({ x: tx + nx * side * fontSize * 0.9 * k, y: ty + ny * side * fontSize * 0.9 * k });
        ctx.labels.push({
          el: tag, angle: textAngle, ...textSize(tagText, fontSize * 0.75), prio: 2,
          cands: [step(0), step(1), step(2), step(3)],
        });
      }
    };

    // this wall's own openings, unless they sit in a stretch another room draws
    (w.openings || []).forEach((o) => {
      const span = openingSpan(w, o);
      const mid = (span.startM + span.endM) / 2;
      if (inRanges(mid, hidden)) return;
      drawOpening(groupAt(mid), o, span, insideSign);
    });
    // doorways the other room has in a shared stretch that this room doesn't
    (merges.extras.get(key) || []).forEach((x) => {
      const target = !active && !print && x.fromRoomId === activeRoomId ? brightGroup : group;
      drawOpening(target, x.opening, { startM: x.startM, endM: x.endM }, -insideSign);
    });

    // services and fixtures: a dot (or a bar along the wall for one with a
    // length) just inside the room, tagged further in
    (w.fixtures || []).forEach((f) => {
      const [f0, f1] = fixtureSpan(w, f);
      const inX = nx * insideSign;
      const inY = ny * insideSign;
      const inset = fontSize * 0.4;
      const at = (m, d) => { const p = along(m); return { x: p.x + inX * d, y: p.y + inY * d }; };
      if (f1 - f0 > 0.001) {
        const p = at(f0, inset);
        const q = at(f1, inset);
        group.appendChild(el('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, class: 'plan-fixture-line', 'stroke-width': strokeWidth * 0.5 }));
      }
      const mid = (f0 + f1) / 2;
      const c = at(mid, inset);
      const dotR = fontSize * 0.2;
      group.appendChild(el('circle', { cx: c.x, cy: c.y, r: dotR, class: 'plan-fixture' }));
      ctx.obstacles.push({ x0: c.x - dotR, x1: c.x + dotR, y0: c.y - dotR, y1: c.y + dotR });
      // other rooms on screen just show the dot, to keep the plan readable
      if (!active && !print) return;
      // the tag reads level, a little way into the room, with a leader back
      // to the dot so it can sit wherever there's space
      const text = `${f.qty > 1 ? `${f.qty}×` : ''}${ctx.fxTags[f.id]}`;
      const fs = fontSize * 0.62;
      const leader = el('line', { class: 'plan-fixture-leader', 'stroke-width': strokeWidth * 0.25 });
      group.appendChild(leader);
      const label = el('text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': fs,
        class: 'plan-fixture-label',
      });
      label.textContent = text;
      group.appendChild(label);
      const size = textSize(text, fs);
      const cands = [];
      [1.3, 2.2, 3.1].forEach((d) => [0, -1.6, 1.6, -3.2, 3.2].forEach((sk) => {
        const p = at(mid + sk * fontSize, inset + fontSize * d);
        cands.push(p);
      }));
      ctx.labels.push({
        // they sit by their wall; the room's name has more room to move
        el: label, angle: 0, ...size, prio: 1.2, cands, shrink: [0.8, 0.65],
        inside: (p) => insidePolygon(p, points),
        after: (p, k = 1) => {
          // leader from the dot to the near edge of the tag
          const dx = p.x - c.x;
          const dy = p.y - c.y;
          const d = Math.hypot(dx, dy) || 1;
          const stop = Math.min(Math.abs((size.w * k / 2) / (dx / d || 1e-9)), Math.abs((size.h * k / 2) / (dy / d || 1e-9)));
          const end = Math.max(d - stop - fontSize * 0.08, 0);
          leader.setAttribute('x1', c.x + (dx / d) * dotR);
          leader.setAttribute('y1', c.y + (dy / d) * dotR);
          leader.setAttribute('x2', c.x + (dx / d) * end);
          leader.setAttribute('y2', c.y + (dy / d) * end);
        },
      });
    });

    if (active) {
      // direction arrowhead at midpoint
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (!print) {
        const arrow = el('path', {
          d: `M ${-fontSize * 0.35} ${-fontSize * 0.35} L ${fontSize * 0.35} 0 L ${-fontSize * 0.35} ${fontSize * 0.35} Z`,
          transform: `translate(${mx}, ${my}) rotate(${angle})`,
          class: 'plan-arrow',
        });
        group.appendChild(arrow);
      }

      // length label outside the room (inside for print), rotated to run
      // along the wall. Centred on the wall unless a door swings into that
      // side, in which case it moves to the middle of the longest clear stretch.
      const labelSide = print ? insideSign : -insideSign;
      const swingOnLabelSide = print ? 'in' : 'out';
      // In print the lengths sit inside the room, beside the opening and
      // fixture tags, so keep clear of all of them; on screen they're outside,
      // where only a door swinging out gets in the way.
      const tagRoom = fontSize * 1.6; // room to leave either side of a tag
      const blocked = (print
        ? [
          ...(w.openings || []).map((o) => {
            const sp = openingSpan(w, o);
            const mid = (sp.startM + sp.endM) / 2;
            return o.type === 'door' && (o.swing || 'in') !== 'in'
              ? null
              : { startM: Math.min(sp.startM, mid - tagRoom), endM: Math.max(sp.endM, mid + tagRoom) };
          }).filter(Boolean),
          ...(w.fixtures || []).map((f) => {
            const [f0, f1] = fixtureSpan(w, f);
            return { startM: f0 - tagRoom * 0.7, endM: f1 + tagRoom * 0.7 };
          }),
        ]
        : (w.openings || [])
          .filter((o) => o.type === 'door' && (o.swing || 'in') === swingOnLabelSide)
          .map((o) => openingSpan(w, o)))
        .sort((p, q) => p.startM - q.startM);
      const labelText = formatLength(w.lengthM, unit); // no wall number: it read as part of the length
      const halfLabel = labelText.length * fontSize * 0.28; // approx. half the text width
      let labelAt = w.lengthM / 2;
      let extraRow = 0;
      if (blocked.some((sp) => sp.startM < labelAt + halfLabel && sp.endM > labelAt - halfLabel)) {
        let best = { from: 0, to: 0 };
        let cursor = 0;
        blocked.concat([{ startM: w.lengthM, endM: w.lengthM }]).forEach((sp) => {
          if (sp.startM - cursor > best.to - best.from) best = { from: cursor, to: sp.startM };
          cursor = Math.max(cursor, sp.endM);
        });
        labelAt = (best.from + best.to) / 2;
        // no gap wide enough: keep it central, a line further into the room
        if (best.to - best.from < halfLabel * 2) {
          labelAt = w.lengthM / 2;
          extraRow = print ? fontSize * 1.4 : 0;
        }
      }
      const labelBase = along(labelAt);
      // outside: clear of the wall band too
      const offset = (fontSize * 0.9 + (print ? 0 : WT) + extraRow) * labelSide;
      const lx = labelBase.x + nx * offset;
      const ly = labelBase.y + ny * offset;
      const label = el('text', {
        x: lx,
        y: ly,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': fontSize,
        transform: `rotate(${textAngle}, ${lx}, ${ly})`,
        class: 'plan-label' + (w.id === selectedWallId ? ' selected' : ''),
      });
      label.textContent = labelText;
      group.appendChild(label);
      // fallbacks: slide along the wall, then step further out
      const halfW = labelText.length * fontSize * 0.28;
      const lo = Math.min(halfW * 0.8, w.lengthM / 2);
      const hi = Math.max(w.lengthM - halfW * 0.8, w.lengthM / 2);
      const spotAt = (m, extra) => {
        const base = along(Math.min(Math.max(m, lo), hi));
        const off = offset + extra * labelSide;
        return { x: base.x + nx * off, y: base.y + ny * off };
      };
      const cands = [{ x: lx, y: ly }];
      [0.15, -0.15, 0.3, -0.3].forEach((k) => cands.push(spotAt(labelAt + k * w.lengthM, 0)));
      [1.2, 2.4].forEach((r) => [0, 0.2, -0.2].forEach((k) => cands.push(spotAt(labelAt + k * w.lengthM, fontSize * r))));
      // in print, a cramped room's lengths can go just outside its wall
      if (print) {
        const outside = -(WT + fontSize * 0.9) - offset * labelSide; // from the inside spot to just past the wall
        [0, 0.2, -0.2].forEach((k) => cands.push(spotAt(labelAt + k * w.lengthM, outside)));
      }
      ctx.labels.push({ el: label, angle: textAngle, ...textSize(labelText, fontSize), prio: active && !print ? 0 : 1, cands });
    }

    // wide invisible line on top so walls are easy to tap
    hitGroup.appendChild(el('line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      class: 'plan-hit',
      'stroke-width': Math.max(fontSize * 1.6, strokeWidth * 6),
      'data-wall-id': w.id,
      'data-room-id': room.id,
    }));
  });

  // room name at the centre of the floor area (an L-shaped room's corner
  // average can fall outside it, the area centroid usually doesn't)
  if (points.length >= 3) {
    let a2 = 0;
    let cx = 0;
    let cy = 0;
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      const cross = p.x * q.y - q.x * p.y;
      a2 += cross;
      cx += (p.x + q.x) * cross;
      cy += (p.y + q.y) * cross;
    });
    if (Math.abs(a2) > 1e-9) {
      cx /= 3 * a2;
      cy /= 3 * a2;
    } else {
      cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    }
    const name = el('text', {
      x: cx,
      y: cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': fontSize * 0.9,
      class: 'plan-room-name',
    });
    name.textContent = roomLabel(room, roomIndex);
    group.appendChild(name);
    let sub = null;
    if (print) {
      sub = el('text', {
        x: cx,
        y: cy + fontSize * 1.1,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': fontSize * 0.8,
        class: 'plan-room-name',
      });
      sub.textContent = formatArea(polygonArea(points), unit);
      group.appendChild(sub);
    }
    // the name (and area under it in print) moves as one block if it must
    const nameSize = textSize(name.textContent.length > (sub ? sub.textContent.length : 0) ? name.textContent : sub.textContent, fontSize * 0.9);
    const blockH = sub ? fontSize * 2.1 : nameSize.h;
    const shiftY = sub ? fontSize * 0.55 : 0;
    const cands = [];
    [0, 1, -1, 2, -2, 3, -3].forEach((ky) => [0, 1.5, -1.5, 3, -3].forEach((kx) => {
      cands.push({ x: cx + kx * fontSize, y: cy + shiftY + ky * fontSize * 0.9 });
    }));
    ctx.labels.push({
      // in print the name goes first: lengths can step outside, the name can't
      el: name, angle: 0, w: nameSize.w, h: blockH, prio: print ? 0.2 : 1.5, cands, shrink: [0.8, 0.65],
      onScale: (k) => { if (sub) sub.setAttribute('font-size', Number(sub.getAttribute('font-size')) * k); },
      inside: points.length >= 3 && Math.abs(polygonArea(points) || 0) > 0.01 && roomClosedEnough(points) ? (p) => insidePolygon(p, points) : null,
      after: (p, k = 1) => {
        name.setAttribute('y', p.y - shiftY * k);
        if (sub) {
          sub.setAttribute('x', p.x);
          sub.setAttribute('y', p.y - shiftY * k + fontSize * 1.1 * k);
        }
      },
    });
  }

  if (!active || print) return;

  // dashed line from the open end to where the room closes (its start, or
  // the near end of a shared wall)
  const gap = closingGap(room, g);
  const minWalls = room.anchor && room.anchor.shared ? 1 : 2;
  if (walls.length >= minWalls && gap != null && gap > 0.05) {
    const last = points[points.length - 1];
    const dashed = el('line', {
      x1: last.x,
      y1: last.y,
      x2: target.x,
      y2: target.y,
      class: 'plan-gap',
      'stroke-width': strokeWidth * 0.6,
    });
    group.appendChild(dashed);
  }

  // start marker (shown even before the first wall, so an attached room's
  // starting corner is visible)
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
    y: start.y - fontSize * 0.9,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-size': fontSize * 0.85,
    class: 'plan-label plan-start-label',
  });
  startLabel.textContent = 'Start';
  // once the room's closed the dot's enough; the word only crowds a small room
  const isClosed = walls.length >= minWalls + 1 && gap != null && gap <= 0.05;
  if (!isClosed) group.appendChild(startLabel);
  const sr = fontSize * 0.35;
  ctx.obstacles.push({ x0: start.x - sr, x1: start.x + sr, y0: start.y - sr, y1: start.y + sr });
  const d = fontSize * 0.95;
  if (!isClosed) ctx.labels.push({
    el: startLabel, angle: 0, ...textSize('Start', fontSize * 0.85), prio: 0.5,
    cands: [[0, -1], [0, 1], [-1.9, 0], [1.9, 0], [-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]].map(([kx, ky]) => ({ x: start.x + kx * d, y: start.y + ky * d })),
  });

  // current open end marker
  if (walls.length > 0) {
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
}

// A room's own outline only counts as an inside once it nearly closes.
function roomClosedEnough(points) {
  const a = points[0];
  const b = points[points.length - 1];
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.2;
}
