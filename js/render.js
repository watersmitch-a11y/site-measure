import { boundingBox } from './geometry.js';
import { formatLength, formatArea } from './units.js';
import { openingSpan, openingTags } from './openings.js';
import {
  roomGeometry, closingGap, polygonArea, insideSign as roomInsideSign, roomLabel, wallMerges, DEFAULT_WALL_THICKNESS_M,
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
  activeRoomId = null, selectedWallId = null, previewLine = null, print = false, viewBox = null,
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

  const hitGroup = el('g');
  // shared stretches and doorways of the room being worked on, drawn undimmed on top
  const brightGroup = el('g', { class: 'plan-room active' });
  const merges = wallMerges(rooms, geom);
  const ctx = { unit, strokeWidth, fontSize, tags, selectedWallId, hitGroup, print, merges, brightGroup, activeRoomId };

  if (print) {
    rooms.forEach((r, i) => drawRoom(svg, r, i, geom.get(r.id), true, ctx));
    svg.appendChild(brightGroup);
    return;
  }

  // inactive rooms first so the active room draws on top
  rooms
    .filter((r) => r !== activeRoom)
    .forEach((r) => {
      const index = rooms.indexOf(r);
      drawRoom(svg, r, index, geom.get(r.id), false, ctx);
    });
  if (activeRoom) {
    drawRoom(svg, activeRoom, rooms.indexOf(activeRoom), geom.get(activeRoom.id), true, ctx);
  }
  svg.appendChild(brightGroup);

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
  const group = el('g', { class: active ? 'plan-room active' : 'plan-room dim' });
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
  const loop = n > 1 && Math.hypot(points[0].x - points[n].x, points[0].y - points[n].y) < 0.01;
  const outerCorner = (j) => {
    const before = j > 0 ? j - 1 : loop ? n - 1 : null;
    const after = j < n ? j : loop ? 0 : null;
    const p = points[j];
    const plain = (k) => { const o = outOf(unitOf(k)); return { x: p.x + o.x * WALL_T, y: p.y + o.y * WALL_T }; };
    if (before === null) return plain(after);
    if (after === null) return plain(before);
    const u1 = unitOf(before);
    const u2 = unitOf(after);
    const o1 = outOf(u1);
    const o2 = outOf(u2);
    const P = { x: p.x + o1.x * WALL_T, y: p.y + o1.y * WALL_T };
    const Q = { x: p.x + o2.x * WALL_T, y: p.y + o2.y * WALL_T };
    const cross = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(cross) < 1e-6) return Q;
    const t = ((Q.x - P.x) * u2.y - (Q.y - P.y) * u2.x) / cross;
    const m = { x: P.x + u1.x * t, y: P.y + u1.y * t };
    return Math.hypot(m.x - p.x, m.y - p.y) > WALL_T * 4 ? Q : m; // very sharp corners: no long spike
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
    const outward = (p, d = WALL_T) => ({ x: p.x + ox * d, y: p.y + oy * d });

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
    const drawStretch = (target, from, to) => {
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
      // cut the opening right through the wall band, a hair wider than it
      const edge = (p, d) => outward(p, d);
      const cut = [edge(s0, -0.01), edge(e0, -0.01), edge(e0, WALL_T + 0.01), edge(s0, WALL_T + 0.01)];
      target.appendChild(el('polygon', { points: cut.map((v) => `${v.x},${v.y}`).join(' '), class: 'plan-cut-fill' }));
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
        [WALL_T / 3, (WALL_T * 2) / 3].forEach((d) => {
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
          'stroke-width': strokeWidth * 0.3,
        }));
        // tag sits inside the swing, clear of the leaf and the arc
        tagPos = {
          x: hinge.x + (swingX + (latch.x - hinge.x) / r) * r * 0.42,
          y: hinge.y + (swingY + (latch.y - hinge.y) / r) * r * 0.42,
        };
        tagText = tags[o.id];
      } else if (o.type === 'other') {
        const p = outward(s0, WALL_T / 2);
        const q = outward(e0, WALL_T / 2);
        target.appendChild(el('line', {
          x1: p.x, y1: p.y, x2: q.x, y2: q.y,
          class: 'plan-opening dotted',
          'stroke-width': strokeWidth * 0.3,
        }));
      }
      // other openings are tagged inside the measuring room; wall lengths go outside
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
      const blocked = (w.openings || [])
        .filter((o) => o.type === 'door' && (o.swing || 'in') === swingOnLabelSide)
        .map((o) => openingSpan(w, o))
        .sort((p, q) => p.startM - q.startM);
      const labelText = `${i + 1}. ${formatLength(w.lengthM, unit)}`;
      const halfLabel = labelText.length * fontSize * 0.28; // approx. half the text width
      let labelAt = w.lengthM / 2;
      if (blocked.some((sp) => sp.startM < labelAt + halfLabel && sp.endM > labelAt - halfLabel)) {
        let best = { from: 0, to: 0 };
        let cursor = 0;
        blocked.concat([{ startM: w.lengthM, endM: w.lengthM }]).forEach((sp) => {
          if (sp.startM - cursor > best.to - best.from) best = { from: cursor, to: sp.startM };
          cursor = Math.max(cursor, sp.endM);
        });
        labelAt = (best.from + best.to) / 2;
      }
      const labelBase = along(labelAt);
      // outside: clear of the wall band too
      const offset = (fontSize * 0.9 + (print ? 0 : WALL_T)) * labelSide;
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
    if (print) {
      const sub = el('text', {
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
    y: start.y - fontSize * 0.7,
    'text-anchor': 'middle',
    'font-size': fontSize * 0.85,
    class: 'plan-label plan-start-label',
  });
  startLabel.textContent = 'Start';
  group.appendChild(startLabel);

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
