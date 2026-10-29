import { computePoints, boundingBox, closingGap } from './geometry.js';
import { formatLength } from './units.js';
import { openingSpan, openingTags } from './openings.js';
import { computeFrames, insideSign as roomInsideSign, roomLabel } from './rooms.js';

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

// Renders every room of the job. The active room gets full detail (lengths,
// arrows, start/end markers); other rooms are drawn dimmed with their name.
export function renderPlan(svg, rooms, unit, { activeRoomId = null, selectedWallId = null, previewPoint = null } = {}) {
  svg.innerHTML = '';

  const frames = computeFrames(rooms);
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

  const roomPoints = new Map(rooms.map((r) => [r.id, computePoints(r.walls, frames.get(r.id))]));
  const box = boundingBox([...roomPoints.values()].flat());
  const padding = 1.2; // meters of padding around the drawing
  const width = Math.max(box.maxX - box.minX, 0.5) + padding * 2;
  const height = Math.max(box.maxY - box.minY, 0.5) + padding * 2;
  const viewMinX = box.minX - padding;
  const viewMinY = box.minY - padding;

  svg.setAttribute('viewBox', `${viewMinX} ${viewMinY} ${width} ${height}`);

  const strokeWidth = Math.max(width, height) * 0.012;
  const fontSize = Math.max(width, height) * 0.045;
  const tags = openingTags(rooms.flatMap((r) => r.walls));

  const hitGroup = el('g');
  const ctx = { unit, strokeWidth, fontSize, tags, selectedWallId, hitGroup };

  // inactive rooms first so the active room draws on top
  rooms
    .filter((r) => r !== activeRoom)
    .forEach((r) => {
      const index = rooms.indexOf(r);
      drawRoom(svg, r, index, roomPoints.get(r.id), false, ctx);
    });
  if (activeRoom) {
    drawRoom(svg, activeRoom, rooms.indexOf(activeRoom), roomPoints.get(activeRoom.id), true, ctx);
  }

  // where a new room will start, while it's being placed
  if (previewPoint) {
    svg.appendChild(el('circle', {
      cx: previewPoint.x,
      cy: previewPoint.y,
      r: fontSize * 0.45,
      class: 'plan-preview',
      'stroke-width': strokeWidth * 0.5,
    }));
  }

  svg.appendChild(hitGroup);
}

function drawRoom(svg, room, roomIndex, points, active, ctx) {
  const { unit, strokeWidth, fontSize, tags, selectedWallId, hitGroup } = ctx;
  const walls = room.walls;
  const group = el('g', { class: active ? 'plan-room active' : 'plan-room dim' });
  svg.appendChild(group);

  // Which side of each wall is inside the room. With y pointing down, +1
  // means the room is on the right-hand side of the direction of travel,
  // i.e. along (nx, ny) below.
  const insideSign = roomInsideSign(points);

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
      class: 'plan-wall' + (active && w.id === selectedWallId ? ' selected' : ''),
      'stroke-width': strokeWidth,
    });
    group.appendChild(line);

    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const textAngle = readableAngle(angle);

    // openings: cut a gap in the wall, then draw the symbol and tag
    (w.openings || []).forEach((o) => {
      let tagPos = null;
      let tagText = `${tags[o.id]} ${formatLength(o.widthM, unit)}`;
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
      } else if (o.type === 'door') {
        // leaf from the hinge jamb plus a quarter-circle swing to the other jamb
        const inX = nx * insideSign;
        const inY = ny * insideSign;
        const swingX = o.swing === 'out' ? -inX : inX;
        const swingY = o.swing === 'out' ? -inY : inY;
        // "left" as seen standing in the room facing the door
        const leftX = -inY;
        const leftY = inX;
        const sIsLeft = (s.x - e.x) * leftX + (s.y - e.y) * leftY > 0;
        const hingeLeft = o.hinge !== 'right';
        const hinge = sIsLeft === hingeLeft ? s : e;
        const latch = hinge === s ? e : s;
        const r = Math.hypot(latch.x - hinge.x, latch.y - hinge.y);
        const tip = { x: hinge.x + swingX * r, y: hinge.y + swingY * r };
        const cross = (tip.x - hinge.x) * (latch.y - hinge.y) - (tip.y - hinge.y) * (latch.x - hinge.x);
        group.appendChild(el('line', {
          x1: hinge.x, y1: hinge.y, x2: tip.x, y2: tip.y,
          class: 'plan-opening',
          'stroke-width': strokeWidth * 0.45,
        }));
        group.appendChild(el('path', {
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
        group.appendChild(el('line', {
          x1: s.x, y1: s.y, x2: e.x, y2: e.y,
          class: 'plan-opening dotted',
          'stroke-width': strokeWidth * 0.3,
        }));
      }
      // other openings are tagged inside the room; wall lengths go outside
      if (!tagPos) {
        const mid = along((Math.max(span.startM, 0) + Math.min(span.endM, w.lengthM)) / 2);
        tagPos = {
          x: mid.x + nx * insideSign * fontSize * 0.8,
          y: mid.y + ny * insideSign * fontSize * 0.8,
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
      group.appendChild(tag);
    });

    if (active) {
      // direction arrowhead at midpoint
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const arrow = el('path', {
        d: `M ${-fontSize * 0.35} ${-fontSize * 0.35} L ${fontSize * 0.35} 0 L ${-fontSize * 0.35} ${fontSize * 0.35} Z`,
        transform: `translate(${mx}, ${my}) rotate(${angle})`,
        class: 'plan-arrow',
      });
      group.appendChild(arrow);

      // length label outside the room, rotated to run along the wall. Centred
      // on the wall unless an outward door swing is there, in which case it
      // moves to the middle of the longest clear stretch.
      const blocked = (w.openings || [])
        .filter((o) => o.type === 'door' && o.swing === 'out')
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
      const offset = fontSize * 0.9 * -insideSign;
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
  if (walls.length >= 3) {
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
  }

  if (!active) return;

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
