// Rooms within a job. Each room is measured on its own:
//   { id, name, ceilingHeightM, walls, anchor }
// and its anchor says where it sits on the job plan:
//   null                                   first room, at the origin
//   { type: 'fixed', x, y, heading }       a fixed start point (heading null =
//                                          use the first wall's own direction)
//   { type: 'wall', shared: true, roomId, wallId, offsetM, lengthM, thicknessM, side }
//                                          the room shares part of another
//                                          room's wall: lengthM of it, starting
//                                          offsetM along the host wall from its
//                                          start, on `side` (+1/-1 of the host
//                                          wall's normal), the wall thickness
//                                          away. The shared wall is NOT one of
//                                          this room's walls; the room starts
//                                          at the far end of the shared part
//                                          and closes onto the near end, so the
//                                          shared wall is its closing edge
//                                          (`reversed`: start at the near end).
// Older anchors still load:
//   { type: 'wall', roomId, wallId, offsetM, thicknessM, sides }
//                                          a tapped point moved off nearby
//                                          walls (sides: wall id -> +1/-1/0)
//   { type: 'wall', roomId, wallId, fromCorner, offsetM, thicknessM, side? }
//                                          Wall 1 ran along the host wall
//                                          (see migrateSharedWallRooms)

import { computePoints, computeHeadings } from './geometry.js';
import { openingSpan } from './openings.js';

export const DEFAULT_WALL_THICKNESS_M = 0.11;

// A wall's thickness: its own if set (e.g. 230 mm brick), else the default.
export function wallThickness(wall) {
  return (wall && wall.thicknessM) || DEFAULT_WALL_THICKNESS_M;
}

export function newRoom(anchor = null) {
  return {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    number: null,
    ceilingHeightM: null,
    walls: [],
    anchor,
  };
}

// Unnamed rooms are called by a number given when they're made, so deleting
// a room doesn't renumber the rest.
export function roomLabel(room, index) {
  return room.name || `Room ${room.number || index + 1}`;
}

// Give numbers to rooms that don't have one: their place in the list where
// that's free (so older jobs keep the names they showed), else the next one.
export function numberRooms(rooms) {
  const used = new Set(rooms.map((r) => r.number).filter(Boolean));
  rooms.forEach((r, i) => {
    if (r.number) return;
    r.number = used.has(i + 1) ? Math.max(0, ...used) + 1 : i + 1;
    used.add(r.number);
  });
}

export function nextRoomNumber(rooms) {
  return Math.max(0, ...rooms.map((r) => r.number || 0)) + 1;
}

// +1 if the room is on the right of the direction of travel (y down), else -1.
export function insideSign(points) {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return sum >= 0 ? 1 : -1;
}

// Shoelace area of the points, closed back to the first point.
export function polygonArea(points) {
  if (points.length < 3) return null;
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}

const headingOf = (dx, dy) => (Math.atan2(dx, -dy) * 180) / Math.PI;

function normalize180(a) {
  let x = a % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

function wallNormal(points, idx) {
  const a = points[idx];
  const b = points[idx + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

// A point `m` along host wall idx, moved `off` towards `side` of it.
function alongWall(hostPoints, idx, m, side, off) {
  const a = hostPoints[idx];
  const b = hostPoints[idx + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return { x: a.x + ux * m - uy * side * off, y: a.y + uy * m + ux * side * off };
}

// Start (far end) and closing target (near end) of a shared-wall room.
function sharedEnds(hostPoints, idx, anchor) {
  const side = anchor.side ?? -insideSign(hostPoints);
  const near = alongWall(hostPoints, idx, anchor.offsetM, side, anchor.thicknessM);
  const far = alongWall(hostPoints, idx, anchor.offsetM + anchor.lengthM, side, anchor.thicknessM);
  return anchor.reversed ? { start: near, target: far } : { start: far, target: near };
}

// Start point for a room placed by tapping a host wall (see `sides` above).
function sidedFrame(host, hostPoints, wallIndex, anchor) {
  const a = hostPoints[wallIndex];
  const b = hostPoints[wallIndex + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const offset = Math.min(Math.max(anchor.offsetM, 0), len);
  let x = a.x + ((b.x - a.x) / len) * offset;
  let y = a.y + ((b.y - a.y) / len) * offset;
  const atStart = offset < 0.001;
  const atEnd = len - offset < 0.001;
  const n = host.walls.length;
  Object.entries(anchor.sides || {}).forEach(([wallId, side]) => {
    if (!side) return;
    const idx = host.walls.findIndex((w) => w.id === wallId);
    if (idx < 0) return;
    const isPrev = idx === (wallIndex - 1 + n) % n && idx !== wallIndex;
    const isNext = idx === (wallIndex + 1) % n && idx !== wallIndex;
    if (idx !== wallIndex && !((isPrev && atStart) || (isNext && atEnd))) return;
    const nrm = wallNormal(hostPoints, idx);
    x += nrm.x * side * anchor.thicknessM;
    y += nrm.y * side * anchor.thicknessM;
  });
  return { x, y, heading: null };
}

// Start point and heading for a room whose Wall 1 runs along a host wall
// (older rooms, before migrateSharedWallRooms has converted them).
function attachedFrame(hostPoints, wallIndex, anchor) {
  const a = hostPoints[wallIndex];
  const b = hostPoints[wallIndex + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const side = anchor.side ?? -insideSign(hostPoints);
  const fromEnd = anchor.fromCorner === 'end';
  const base = alongWall(hostPoints, wallIndex, fromEnd ? len - anchor.offsetM : anchor.offsetM, side, anchor.thicknessM);
  return { x: base.x, y: base.y, heading: fromEnd ? headingOf(-ux, -uy) : headingOf(ux, uy) };
}

// The part of a host wall that a new room on `side` of it shares, as
// { startM, lengthM } along the host wall from its start. At each end, if the
// host's neighbouring wall runs into the new room (an inside corner from the
// new room's point of view, like the notch of an L), the shared part stops
// short by the wall thickness; if it carries on in line or turns away (like
// a continuous front wall) it runs right to the corner.
export function sharedWallSpan(hostPoints, hostWalls, wallIdx, side, thicknessM, closed) {
  const n = hostWalls.length;
  const a = hostPoints[wallIdx];
  const b = hostPoints[wallIdx + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const toRoom = { x: -u.y * side, y: u.x * side };
  // trim needed where a neighbouring wall leaves the corner along `dir`
  const trimFor = (dir) => {
    const into = dir.x * toRoom.x + dir.y * toRoom.y;
    if (into <= 0.01) return 0;
    const sin = Math.abs(u.x * dir.y - u.y * dir.x);
    return thicknessM / Math.max(sin, 0.2);
  };
  const dirOf = (from, to) => {
    const p = hostPoints[from];
    const q = hostPoints[to];
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
  };
  let startTrim = 0;
  let endTrim = 0;
  if (wallIdx > 0 || closed) {
    const prev = (wallIdx - 1 + n) % n;
    startTrim = trimFor(dirOf(prev + 1, prev)); // from the corner back along the previous wall
  }
  if (wallIdx < n - 1 || closed) {
    const next = (wallIdx + 1) % n;
    endTrim = trimFor(dirOf(next, next + 1));
  }
  return { startM: startTrim, lengthM: Math.max(len - startTrim - endTrim, 0) };
}

// Where every room sits: room id -> { frame, points, target }, where target
// is the point the room closes onto (its start, or for a shared-wall room the
// near end of the shared wall). Hosts always come before the rooms attached
// to them, so one pass in order works.
// The plan is redrawn often (every drag frame) and asks for the same rooms'
// geometry and wall merges many times over; work each out once per change.
// Callers must treat the results as read-only.
function lastResult(fn, keyOf) {
  let lastKey = null;
  let last = null;
  return (...args) => {
    const key = keyOf(...args);
    if (key !== lastKey) {
      last = fn(...args);
      lastKey = key;
    }
    return last;
  };
}

const geometryKey = (rooms) => JSON.stringify(rooms.map((r) => [r.id, r.anchor, r.walls.map((w) => [w.id, w.lengthM, w.angle])]));

export const roomGeometry = lastResult(computeGeometry, geometryKey);

function computeGeometry(rooms) {
  const geom = new Map();
  rooms.forEach((room) => {
    const anchor = room.anchor;
    let frame = { x: 0, y: 0, heading: null };
    let target = null;
    if (anchor && anchor.type === 'fixed') {
      frame = { x: anchor.x, y: anchor.y, heading: anchor.heading ?? null };
    } else if (anchor && anchor.type === 'wall') {
      const host = rooms.find((r) => r.id === anchor.roomId);
      const hostPoints = host && geom.get(host.id)?.points;
      const idx = host ? host.walls.findIndex((w) => w.id === anchor.wallId) : -1;
      if (hostPoints && idx >= 0) {
        if (anchor.shared) {
          const ends = sharedEnds(hostPoints, idx, anchor);
          frame = { x: ends.start.x, y: ends.start.y, heading: null };
          target = ends.target;
        } else if (anchor.sides) {
          frame = sidedFrame(host, hostPoints, idx, anchor);
        } else {
          frame = attachedFrame(hostPoints, idx, anchor);
        }
      }
    }
    geom.set(room.id, { frame, points: computePoints(room.walls, frame), target: target || { x: frame.x, y: frame.y } });
  });
  return geom;
}

export function computeFrames(rooms) {
  return new Map([...roomGeometry(rooms)].map(([id, g]) => [id, g.frame]));
}

export function computeRoomPoints(rooms) {
  return new Map([...roomGeometry(rooms)].map(([id, g]) => [id, g.points]));
}

// Distance from the end of the last wall to where the room closes, or null.
export function closingGap(room, g) {
  if (room.walls.length === 0) return null;
  const last = g.points[g.points.length - 1];
  return Math.hypot(g.target.x - last.x, g.target.y - last.y);
}

// Fewest walls before a room can be closed: a shared wall is one side already.
export function minWallsToClose(room) {
  return room.anchor && room.anchor.shared ? 1 : 2;
}

export function roomClosed(room, g) {
  return room.walls.length >= minWallsToClose(room) + 1 && closingGap(room, g) <= 0.05;
}

// Floor area once the room has at least three corners.
export function roomArea(room, g) {
  return polygonArea(g.points);
}

// The shared part of a host wall for a shared-wall room:
// { host, hostIndex, wall, wallIdx, startM, endM, lengthM }, or null.
export function sharedSpan(rooms, room) {
  const anchor = room.anchor;
  if (!anchor || !anchor.shared) return null;
  const host = rooms.find((r) => r.id === anchor.roomId);
  const wallIdx = host ? host.walls.findIndex((w) => w.id === anchor.wallId) : -1;
  if (wallIdx < 0) return null;
  return {
    host,
    hostIndex: rooms.indexOf(host),
    wall: host.walls[wallIdx],
    wallIdx,
    startM: anchor.offsetM,
    endM: anchor.offsetM + anchor.lengthM,
    lengthM: anchor.lengthM,
  };
}

export function roomPerimeter(rooms, room) {
  const span = sharedSpan(rooms, room);
  return room.walls.reduce((sum, w) => sum + w.lengthM, 0) + (span ? span.lengthM : 0);
}

// Net area (m²) of this room's face of a shared wall: the shared length times
// the ceiling height, less the host wall's openings that fall within it.
export function sharedWallArea(rooms, room, heightM) {
  const span = sharedSpan(rooms, room);
  if (!span || !heightM) return 0;
  let area = span.lengthM * heightM;
  (span.wall.openings || []).forEach((o) => {
    const s = openingSpan(span.wall, o);
    const overlap = Math.min(s.endM, span.endM) - Math.max(s.startM, span.startM);
    if (overlap > 0) area -= overlap * Math.min(o.heightM, Math.max(heightM - (o.sillM || 0), 0));
  });
  return area;
}

// Before a host room or wall is deleted, pin any rooms attached to it at
// their current position so they don't jump. A shared-wall room gets its
// shared wall added as a real wall, since it no longer has a host to share.
// The host's doors and windows in the stretch a shared-wall room shares, as
// openings of a new wall of that room running from a to b, seen from its side:
// a door hinged on the host's left and opening into the host is hinged on
// this room's right and opens out of it.
function sharedOpenings(rooms, geom, room, a, b) {
  const span = sharedSpan(rooms, room);
  if (!span) return [];
  const hp = geom.get(span.host.id).points;
  const p = hp[span.wallIdx];
  const q = hp[span.wallIdx + 1];
  if (!p || !q) return [];
  const hl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const at = (m) => ({ x: p.x + ((q.x - p.x) / hl) * m, y: p.y + ((q.y - p.y) / hl) * m });
  const along = (pt) => (pt.x - a.x) * u.x + (pt.y - a.y) * u.y;
  return (span.wall.openings || []).flatMap((o) => {
    const os = openingSpan(span.wall, o);
    const t = [along(at(os.startM)), along(at(os.endM))].sort((x, y) => x - y);
    if (t[1] < 0.01 || t[0] > len - 0.01) return []; // outside the shared stretch
    const copy = {
      ...o,
      id: `o_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromCorner: 'start',
      offsetM: Math.max(0, t[0]),
    };
    if (o.type === 'door') {
      copy.hinge = o.hinge === 'right' ? 'left' : 'right';
      copy.swing = o.swing === 'out' ? 'in' : 'out';
    }
    return [copy];
  });
}

export function pinAttachedRooms(rooms, isAffected) {
  const geom = roomGeometry(rooms);
  rooms.forEach((room) => {
    const anchor = room.anchor;
    if (!anchor || anchor.type !== 'wall' || !isAffected(anchor)) return;
    const g = geom.get(room.id);
    if (anchor.shared && room.walls.length > 0) {
      const last = g.points[g.points.length - 1];
      const start = g.points[0];
      const length = Math.hypot(start.x - last.x, start.y - last.y);
      if (length > 0.01) {
        const heading = headingOf(start.x - last.x, start.y - last.y);
        const headings = computeHeadings(room.walls, g.frame.heading);
        room.walls.push({
          id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          lengthM: length,
          angle: normalize180(heading - headings[headings.length - 1]),
          openings: sharedOpenings(rooms, geom, room, last, start),
          ...(anchor.thicknessM && Math.abs(anchor.thicknessM - DEFAULT_WALL_THICKNESS_M) > 0.0005 ? { thicknessM: anchor.thicknessM } : {}),
        });
      }
    }
    room.anchor = { type: 'fixed', x: g.frame.x, y: g.frame.y, heading: g.frame.heading };
  });
}

// Rooms made while the shared wall was added as the new room's Wall 1: drop
// that wall and make the room close onto the shared wall instead. The room's
// remaining walls keep exactly the same shape.
export function migrateSharedWallRooms(rooms) {
  const frames = computeFrames(rooms);
  rooms.forEach((room) => {
    const anchor = room.anchor;
    const first = room.walls[0];
    if (!anchor || anchor.type !== 'wall' || anchor.shared || anchor.sides || !first || !first.sharedWith) return;
    const hostHeading = frames.get(room.id).heading; // Wall 1 ran along the host wall
    const host = rooms.find((r) => r.id === anchor.roomId);
    const hostPoints = host && computePoints(host.walls, frames.get(host.id));
    const idx = host ? host.walls.findIndex((w) => w.id === anchor.wallId) : -1;
    if (!hostPoints || idx < 0) return;
    const hostLen = Math.hypot(hostPoints[idx + 1].x - hostPoints[idx].x, hostPoints[idx + 1].y - hostPoints[idx].y);
    const fromEnd = anchor.fromCorner === 'end';
    // where the old Wall 1 started, along the host wall from its start; it
    // ran towards the host wall's end, or back towards its start if measured
    // from the end corner. The room now starts where Wall 1 finished and
    // closes onto where it began.
    const began = fromEnd ? hostLen - anchor.offsetM : anchor.offsetM;
    room.anchor = {
      type: 'wall',
      shared: true,
      roomId: anchor.roomId,
      wallId: anchor.wallId,
      offsetM: fromEnd ? began - first.lengthM : began,
      lengthM: first.lengthM,
      thicknessM: anchor.thicknessM,
      side: anchor.side ?? -insideSign(hostPoints),
      reversed: fromEnd,
    };
    room.walls.shift();
    if (room.walls[0]) room.walls[0].angle = (((hostHeading + room.walls[0].angle) % 360) + 360) % 360;
  });
}

// ---------- walls that rooms share once they're placed side by side ----------
// Rooms measured separately each have their own walls. Where a wall of one
// room and a wall of another face each other a wall-thickness apart (parallel,
// back to back, up to maxGap), the overlapping part is one physical wall: it
// is drawn once (by the earlier room, the "owner"), and doorways measured from
// both sides are drawn once. Only the overlapping part merges; the rest of
// each wall stays its own. Measurements are untouched, so moving a room apart
// again un-merges it.

function wallFrame(points, idx) {
  const a = points[idx];
  const b = points[idx + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / (len || 1), y: (b.y - a.y) / (len || 1) };
  const out = -insideSign(points);
  return { a, len, u, n: { x: -u.y * out, y: u.x * out } }; // n: outward normal
}

const dot = (p, q) => p.x * q.x + p.y * q.y;
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });

// Wall A (owner) and wall B facing each other: the gap between them and the
// overlap, as [s, e] along each wall from its start; or null.
function facingOverlap(A, B, minGap, maxGap) {
  if (A.len < 0.01 || B.len < 0.01 || dot(A.n, B.n) > -0.999) return null;
  const gap = dot(sub(B.a, A.a), A.n);
  if (gap < minGap || gap > maxGap) return null;
  const t0 = dot(sub(B.a, A.a), A.u);
  const t1 = t0 + dot(B.u, A.u) * B.len;
  const s = Math.max(Math.min(t0, t1), 0);
  const e = Math.min(Math.max(t0, t1), A.len);
  if (e - s < 0.05) return null;
  // the same stretch along B
  const onB = (t) => dot(sub({ x: A.a.x + A.u.x * t, y: A.a.y + A.u.y * t }, B.a), B.u);
  const bs = onB(s);
  const be = onB(e);
  return { gap, a: [s, e], b: [Math.min(bs, be), Math.max(bs, be)], toA: (m) => t0 + dot(B.u, A.u) * m };
}

// Merged walls for drawing:
//   hidden:  'roomId|wallIdx' -> [[s, e], …]  stretches not drawn (the owner draws them)
//   shared:  'roomId|wallIdx' -> [{ s, e, otherRoomId }]  owner stretches shared with another room
//   extras:  'roomId|wallIdx' -> [{ opening, startM, endM, fromRoomId }]  the other room's
//            openings in a shared stretch, along the owner wall (only ones the owner lacks)
//   sameAs:  opening id -> { roomId, openingId }  a doorway the owner already has
export const wallMerges = lastResult(computeMerges, (rooms, geom, maxGap = 0.3) =>
  `${maxGap}|${geometryKey(rooms)}|${JSON.stringify(rooms.map((r) => r.walls.map((w) => [w.openings, w.thicknessM])))}`);

function computeMerges(rooms, geom, maxGap = 0.3) {
  const merges = { hidden: new Map(), shared: new Map(), extras: new Map(), sameAs: new Map() };
  const push = (map, key, item) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  };
  rooms.forEach((ra, i) => {
    const pa = geom.get(ra.id).points;
    rooms.slice(i + 1).forEach((rb) => {
      const pb = geom.get(rb.id).points;
      ra.walls.forEach((wa, ia) => {
        const A = wallFrame(pa, ia);
        rb.walls.forEach((wb, ib) => {
          const B = wallFrame(pb, ib);
          // facing walls up to the thicker one's thickness apart are one wall
          const ov = facingOverlap(A, B, -0.02, Math.max(maxGap, Math.max(wallThickness(wa), wallThickness(wb)) + 0.1));
          if (!ov) return;
          const keyA = `${ra.id}|${ia}`;
          push(merges.hidden, `${rb.id}|${ib}`, ov.b);
          push(merges.shared, keyA, { s: ov.a[0], e: ov.a[1], otherRoomId: rb.id });
          (wb.openings || []).forEach((o) => {
            const span = openingSpan(wb, o);
            const mid = (span.startM + span.endM) / 2;
            if (mid < ov.b[0] || mid > ov.b[1]) return;
            const ends = [ov.toA(span.startM), ov.toA(span.endM)].sort((x, y) => x - y);
            const twin = (wa.openings || []).find((oa) => {
              const sa = openingSpan(wa, oa);
              const overlap = Math.min(sa.endM, ends[1]) - Math.max(sa.startM, ends[0]);
              return overlap > 0.5 * Math.min(oa.widthM, o.widthM);
            });
            if (twin) merges.sameAs.set(o.id, { roomId: ra.id, openingId: twin.id });
            else push(merges.extras, keyA, { opening: o, startM: ends[0], endM: ends[1], fromRoomId: rb.id });
          });
        });
      });
    });
  });
  return merges;
}

// When a room is dropped near another, how far to slide it so it lines up:
// { dx, dy }, or null if nothing is close enough. Two snaps, at right angles
// to each other, so corners square up:
//  - across a shared wall: walls facing each other end up exactly
//    `thicknessM` apart
//  - along it: walls on the same side (a continuous front wall) end up in
//    line, or the ends of the facing walls line up
// Each only applies within `range` of where the room was dropped.
// roomId can be a list of ids: rooms moved together as one group.
export function snapOffset(rooms, geom, roomId, thicknessM, range = 0.35) {
  const ids = new Set([].concat(roomId));
  const movingWalls = groupWalls(rooms, geom, ids);
  const options = []; // { n: direction to move along, shift: metres }
  rooms.filter((r) => !ids.has(r.id)).forEach((other) => {
    const po = geom.get(other.id).points;
    other.walls.forEach((wo, io) => {
      const O = wallFrame(po, io);
      if (O.len < 0.01) return;
      movingWalls.forEach(({ frame: M, room: mr, idx: mi }) => {
        const t = Math.max(wallThickness(wo), wallThickness(mr.walls[mi]));
        if (M.len < 0.01) return;
        const facing = dot(M.n, O.n);
        if (Math.abs(facing) < 0.999) return;
        // where M sits along O, as an interval, and how far apart they are
        const m0 = dot(sub(M.a, O.a), O.u);
        const m1 = m0 + dot(M.u, O.u) * M.len;
        const lo = Math.min(m0, m1);
        const hi = Math.max(m0, m1);
        const off = dot(sub(M.a, O.a), O.n);
        if (facing < 0) {
          const overlap = Math.min(hi, O.len) - Math.max(lo, 0);
          if (overlap < 0.05) return;
          // only walls a wall-thickness apart (give or take) count as facing
          if (Math.abs(t - off) > range) return;
          options.push({ n: O.n, shift: t - off });
          // line up the ends of the two facing walls
          [[lo, 0], [lo, O.len], [hi, 0], [hi, O.len]].forEach(([mEnd, oEnd]) => {
            if (Math.abs(oEnd - mEnd) <= range) options.push({ n: O.u, shift: oEnd - mEnd });
          });
        } else {
          // same side: put the walls in line if they're near each other
          const apart = Math.max(lo - O.len, 0 - hi, 0);
          if (apart <= t + range && Math.abs(off) <= range) options.push({ n: O.n, shift: -off });
        }
      });
    });
  });
  if (!options.length) return null;
  const smallest = (list) => list.reduce((b, o) => (Math.abs(o.shift) < Math.abs(b.shift) ? o : b));
  const first = smallest(options);
  const across = options.filter((o) => Math.abs(dot(o.n, first.n)) < 0.1);
  const second = across.length ? smallest(across) : null;
  const dx = first.n.x * first.shift + (second ? second.n.x * second.shift : 0);
  const dy = first.n.y * first.shift + (second ? second.n.y * second.shift : 0);
  return Math.hypot(dx, dy) > 0.0005 ? { dx, dy } : null;
}

// The wall of another room that a room's wall faces most closely, for setting
// exact offsets while moving it: { other, otherIdx, wallIdx, gap, n, u, len,
// lo, hi } where n points from the other wall towards this room, u runs along
// the other wall from its start, and lo/hi are where this room's wall starts
// and ends along it. null if no facing wall is within maxGap.
export function nearestFacingWall(rooms, geom, roomId, maxGap = 1.5) {
  const ids = new Set([].concat(roomId));
  const movingWalls = groupWalls(rooms, geom, ids);
  let best = null;
  rooms.filter((r) => !ids.has(r.id)).forEach((other) => {
    const po = geom.get(other.id).points;
    other.walls.forEach((wo, io) => {
      const O = wallFrame(po, io);
      if (O.len < 0.01) return;
      movingWalls.forEach(({ frame: M, idx: im }) => {
        if (M.len < 0.01 || dot(M.n, O.n) > -0.999) return;
        const gap = dot(sub(M.a, O.a), O.n);
        if (gap < -0.05 || gap > maxGap) return;
        const m0 = dot(sub(M.a, O.a), O.u);
        const m1 = m0 + dot(M.u, O.u) * M.len;
        const lo = Math.min(m0, m1);
        const hi = Math.max(m0, m1);
        const apart = Math.max(lo - O.len, -hi, 0); // along the wall, 0 when they overlap
        const score = Math.abs(gap) + apart * 2;
        if (apart > 1.5) return;
        if (!best || score < best.score) best = { score, other, otherIdx: io, wallIdx: im, gap, n: O.n, u: O.u, len: O.len, lo, hi };
      });
    });
  });
  return best;
}

// How far a wall drawn from `from` in plan direction `heading` (0 up,
// clockwise) can run before it meets another room's wall: the face of that
// wall it reaches first (the measured line from inside that room, the outer
// face of its band from outside). Returns { distM, roomId, x, y } or null.
export function clearRunTo(rooms, geom, roomId, from, heading, thicknessM = DEFAULT_WALL_THICKNESS_M, maxM = 30) {
  const rad = (heading * Math.PI) / 180;
  const d = { x: Math.sin(rad), y: -Math.cos(rad) };
  let best = null;
  const hit = (a, b, other) => {
    const e = { x: b.x - a.x, y: b.y - a.y };
    const denom = d.x * e.y - d.y * e.x;
    if (Math.abs(denom) < 1e-9) return; // running alongside it
    const w = { x: a.x - from.x, y: a.y - from.y };
    const t = (w.x * e.y - w.y * e.x) / denom;
    const s = (w.x * d.y - w.y * d.x) / denom;
    // just grazing an end (e.g. running along a wall's face) isn't meeting it
    const graze = 0.005 / Math.hypot(e.x, e.y);
    if (t < 0.02 || t > maxM || s < graze || s > 1 - graze) return;
    if (!best || t < best.distM) best = { distM: t, roomId: other.id, x: from.x + d.x * t, y: from.y + d.y * t };
  };
  rooms.forEach((other) => {
    if (other.id === roomId) return;
    const pts = geom.get(other.id).points;
    if (pts.length < 2) return;
    const sign = insideSign(pts);
    other.walls.forEach((wall, i) => {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a || !b) return;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01) return;
      const tw = wallThickness(wall);
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const o = { x: u.y * sign * tw, y: -u.x * sign * tw }; // outward, a wall thick
      hit(a, b, other);
      // the band's outer face, run on past the corners where bands mitre
      const ext = { x: u.x * tw, y: u.y * tw };
      hit({ x: a.x + o.x - ext.x, y: a.y + o.y - ext.y }, { x: b.x + o.x + ext.x, y: b.y + o.y + ext.y }, other);
    });
  });
  if (!best) return null;
  // a run that slides along or through another room's wall isn't a clear gap
  const mid = { x: (from.x + best.x) / 2, y: (from.y + best.y) / 2 };
  const blocked = rooms.some((other) => {
    if (other.id === roomId) return false;
    const pts = geom.get(other.id).points;
    return other.walls.some((wall, i) => pts[i] && pts[i + 1] && distToSegment(mid, pts[i], pts[i + 1]) < wallThickness(wall) - 0.001);
  });
  return blocked ? null : best;
}

function distToSegment(p, a, b) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)) : 0;
  return Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t));
}

// Clear gaps between facing walls of other rooms, around the given points
// (the corners a room is being drawn from), so a room can be drawn to fill
// them. Measured between the faces of the wall bands. Each is
// { x1, y1, x2, y2, distM }.
export function roomGapsNear(rooms, geom, roomId, near, thicknessM = DEFAULT_WALL_THICKNESS_M, maxGap = 10, reach = 0.4) {
  const others = rooms.filter((r) => r.id !== roomId && r.walls.length);
  const walls = others.flatMap((r) => {
    const pts = geom.get(r.id).points;
    return r.walls.map((wall, i) => (pts[i + 1] ? { room: r, f: wallFrame(pts, i), t: wallThickness(wall) } : null)).filter((w) => w && w.f.len > 0.05);
  });
  const gaps = [];
  walls.forEach((A) => {
    walls.forEach((B) => {
      if (A.room === B.room) return;
      if (dot(A.f.n, B.f.n) > -0.999) return;
      // the two faces looking at each other
      const fa = { x: A.f.a.x + A.f.n.x * A.t, y: A.f.a.y + A.f.n.y * A.t };
      const fb = { x: B.f.a.x + B.f.n.x * B.t, y: B.f.a.y + B.f.n.y * B.t };
      const gap = dot(sub(fb, fa), A.f.n);
      if (gap < 0.05 || gap > maxGap) return;
      // where they overlap, along A
      const b0 = dot(sub(fb, fa), A.f.u);
      const b1 = b0 + dot(B.f.u, A.f.u) * B.f.len;
      const lo = Math.max(0, Math.min(b0, b1));
      const hi = Math.min(A.f.len, Math.max(b0, b1));
      if (hi - lo < 0.1) return;
      // only gaps next to where the room is being drawn
      const nearIt = near.some((p) => {
        const along = dot(sub(p, fa), A.f.u);
        const across = dot(sub(p, fa), A.f.n);
        return along > lo - reach && along < hi + reach && across > -reach && across < gap + reach;
      });
      if (!nearIt) return;
      const m = (lo + hi) / 2;
      const p1 = { x: fa.x + A.f.u.x * m, y: fa.y + A.f.u.y * m };
      // nothing else in between
      const heading = (Math.atan2(A.f.n.x, -A.f.n.y) * 180) / Math.PI;
      const run = clearRunTo(rooms, geom, roomId, p1, heading, thicknessM, maxGap + 1);
      if (!run || run.roomId !== B.room.id || Math.abs(run.distM - gap) > 0.01) return;
      // each gap once
      if (gaps.some((g) => Math.abs(g.distM - gap) < 0.005 &&
        Math.hypot((g.x1 + g.x2) / 2 - (p1.x + run.x) / 2, (g.y1 + g.y2) / 2 - (p1.y + run.y) / 2) < 0.5)) return;
      gaps.push({ x1: p1.x, y1: p1.y, x2: run.x, y2: run.y, distM: gap });
    });
  });
  return gaps;
}

// A shared-wall room whose last wall ends on the shared wall's line, but not
// at the end it was expected to close at (the room is narrower or wider than
// the stretch picked when placing it): make the shared stretch end where the
// walls do, as far as the host wall goes, and close any part beyond the host
// wall with a wall of the room's own along the same line. Returns true if
// anything changed.
export function settleSharedClose(rooms, room, tolerance = 0.06) {
  const anchor = room.anchor;
  if (!anchor || !anchor.shared || room.walls.length < 2) return false;
  const span = sharedSpan(rooms, room);
  if (!span) return false;
  const g = roomGeometry(rooms).get(room.id);
  const last = g.points[g.points.length - 1];
  const start = g.points[0];
  const L = Math.hypot(g.target.x - start.x, g.target.y - start.y);
  if (L < 0.01) return false;
  const u = { x: (g.target.x - start.x) / L, y: (g.target.y - start.y) / L };
  const rel = sub(last, start);
  const across = Math.abs(rel.x * u.y - rel.y * u.x);
  const s = dot(rel, u); // how far along the shared line the walls end
  if (across > tolerance || Math.abs(s - L) <= 0.005 || s < 0.05) return false;
  // the start end of the stretch stays put; the other end moves to s
  const hostLen = span.wall.lengthM;
  const room0 = anchor.reversed ? anchor.offsetM : anchor.offsetM + anchor.lengthM; // start, along the host wall
  const dir = anchor.reversed ? 1 : -1; // towards the target, along the host wall
  const room1 = Math.min(Math.max(room0 + dir * s, 0), hostLen);
  const shared = Math.abs(room1 - room0);
  if (shared < 0.05) return false;
  anchor.lengthM = shared;
  if (!anchor.reversed) anchor.offsetM = room1;
  // the part past the end of the host wall is a wall of this room
  const rest = s - shared;
  if (rest > 0.005) {
    const g2 = roomGeometry(rooms).get(room.id);
    const end = g2.points[g2.points.length - 1];
    const heading = headingOf(g2.target.x - end.x, g2.target.y - end.y);
    const headings = computeHeadings(room.walls, g2.frame.heading);
    room.walls.push({
      id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      lengthM: Math.hypot(g2.target.x - end.x, g2.target.y - end.y),
      angle: normalize180(heading - headings[headings.length - 1]),
      openings: [],
      ...(span.wall.thicknessM ? { thicknessM: span.wall.thicknessM } : {}),
    });
  }
  return true;
}

// Every wall of the given rooms, with its frame.
function groupWalls(rooms, geom, ids) {
  return rooms.filter((r) => ids.has(r.id)).flatMap((r) => {
    const pts = geom.get(r.id).points;
    return r.walls.map((_, idx) => (pts[idx + 1] ? { room: r, idx, frame: wallFrame(pts, idx) } : null)).filter(Boolean);
  });
}

// Rooms that move together with `room`: joined by a shared wall (either way
// round), or with walls touching or facing a wall's thickness apart, and so
// on through their neighbours.
export function joinedRooms(rooms, geom, room, direct = false) {
  const merges = wallMerges(rooms, geom);
  const links = new Map(rooms.map((r) => [r.id, new Set()]));
  const link = (a, b) => {
    if (!links.has(a) || !links.has(b) || a === b) return;
    links.get(a).add(b);
    links.get(b).add(a);
  };
  rooms.forEach((r) => {
    if (r.anchor && r.anchor.type === 'wall') link(r.id, r.anchor.roomId);
  });
  // rooms that were separated don't pull each other along just by touching
  const apart = (a, b) => (rooms.find((r) => r.id === a)?.apart || []).includes(b);
  merges.shared.forEach((list, key) => {
    const id = key.slice(0, key.lastIndexOf('|'));
    list.forEach((sh) => { if (!apart(id, sh.otherRoomId)) link(id, sh.otherRoomId); });
  });
  if (direct) return rooms.filter((r) => links.get(room.id).has(r.id));
  const seen = new Set([room.id]);
  const queue = [room.id];
  while (queue.length) {
    links.get(queue.shift()).forEach((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    });
  }
  return rooms.filter((r) => seen.has(r.id));
}

// The rooms of a group that hold its position: the ones not hanging off
// another room's wall in the group. Moving these moves the lot.
export function groupRoots(group) {
  const ids = new Set(group.map((r) => r.id));
  return group.filter((r) => !(r.anchor && r.anchor.type === 'wall' && ids.has(r.anchor.roomId)));
}

// Unjoin a room from every room it's joined to: a shared wall it hangs off
// becomes a wall of its own (with the doors and windows in it), rooms hanging
// off it get their own copy likewise, and rooms it just touches no longer
// move with it. Each room keeps where it is. Returns the rooms it was joined to.
export function separateRoom(rooms, room) {
  const geom = roomGeometry(rooms);
  const joined = joinedRooms(rooms, geom, room, true);
  pinAttachedRooms(rooms, (a) => a === room.anchor || a.roomId === room.id);
  joined.forEach((other) => {
    room.apart = [...new Set([...(room.apart || []), other.id])];
    other.apart = [...new Set([...(other.apart || []), room.id])];
  });
  return joined;
}

// Set a room's walls to run through the given corner points (points[0] stays
// where the room starts), keeping how its wall angles are stored.
function setWallsThrough(room, frame, pts) {
  let prev = null;
  room.walls.forEach((w, i) => {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const heading = headingOf(dx, dy);
    w.lengthM = Math.round(Math.hypot(dx, dy) * 1000) / 1000;
    if (i === 0) {
      const a = frame.heading == null ? heading : heading - frame.heading;
      w.angle = Math.round((((a % 360) + 360) % 360) * 100) / 100;
    } else {
      w.angle = Math.round(normalize180(heading - prev) * 100) / 100;
    }
    prev = heading;
  });
}

// Close a room by sharing its closing gap out over all its walls, in
// proportion to their lengths (the surveyor's compass rule), instead of
// adding a short closing wall. Returns the biggest change to any wall's
// length, in metres, or null if there's nothing to spread.
export function spreadClosingGap(rooms, room, apply = true) {
  const g = roomGeometry(rooms).get(room.id);
  const n = room.walls.length;
  if (n < minWallsToClose(room) + 1) return null;
  const last = g.points[n];
  const gap = { x: g.target.x - last.x, y: g.target.y - last.y };
  if (Math.hypot(gap.x, gap.y) < 0.0005) return null;
  const total = room.walls.reduce((sum, w) => sum + w.lengthM, 0);
  let run = 0;
  const pts = g.points.map((p, k) => {
    if (k > 0) run += room.walls[k - 1].lengthM;
    return { x: p.x + gap.x * (run / total), y: p.y + gap.y * (run / total) };
  });
  const maxChange = Math.max(...room.walls.map((w, i) =>
    Math.abs(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) - w.lengthM)));
  if (apply) setWallsThrough(room, g.frame, pts);
  return maxChange;
}

// Names for a room's corners from where they sit in the room, e.g.
// "top-left"; corner k is where wall k starts.
export function cornerNames(rooms, room) {
  const pts = roomGeometry(rooms).get(room.id).points.slice(0, room.walls.length);
  if (pts.length < 3) return pts.map((_, k) => `Corner ${k + 1}`);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const names = pts.map((p) => {
    const v = Math.abs(p.y - cy) < 0.05 ? '' : p.y < cy ? 'top' : 'bottom';
    const h = Math.abs(p.x - cx) < 0.05 ? '' : p.x < cx ? 'left' : 'right';
    return [v, h].filter(Boolean).join('-') || 'middle';
  });
  return names.map((name, k) => (names.filter((x) => x === name).length > 1 ? `${name} (${k + 1})` : name));
}

// The plan's distance between two corners of a room.
export function cornerDistance(rooms, room, a, b) {
  const pts = roomGeometry(rooms).get(room.id).points;
  return Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
}

// A closed four-walled room is fixed by its four walls and one diagonal:
// re-shape it so the diagonal between opposite corners a and b is lengthM,
// keeping the wall lengths and the first wall where it is. Returns false if
// the room isn't one that can be squared this way or the lengths can't meet.
export function squareFromDiagonal(rooms, room, a, b, lengthM) {
  const g = roomGeometry(rooms).get(room.id);
  if (room.walls.length !== 4 || (room.anchor && room.anchor.shared) || !roomClosed(room, g)) return false;
  if (Math.abs(a - b) !== 2) return false;
  const L = room.walls.map((w) => w.lengthM);
  const P = g.points.slice(0, 4);
  // circle intersection: the point lengths r0 from c0 and r1 from c1, on the
  // same side of c0→c1 as `like`
  const meet = (c0, r0, c1, r1, like) => {
    const d = Math.hypot(c1.x - c0.x, c1.y - c0.y);
    if (d < 1e-6 || d > r0 + r1 + 1e-6 || d < Math.abs(r0 - r1) - 1e-6) return null;
    const along = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(r0 * r0 - along * along, 0));
    const ux = (c1.x - c0.x) / d;
    const uy = (c1.y - c0.y) / d;
    const base = { x: c0.x + ux * along, y: c0.y + uy * along };
    const side = Math.sign((c1.x - c0.x) * (like.y - c0.y) - (c1.y - c0.y) * (like.x - c0.x)) || 1;
    return { x: base.x - uy * h * side, y: base.y + ux * h * side };
  };
  const pts = [P[0], P[1]];
  if (a % 2 === 0) {
    // diagonal from corner 0 to corner 2: corners 0 and 1 stay, 2 then 3 follow
    pts[2] = meet(P[0], lengthM, P[1], L[1], P[2]);
    if (!pts[2]) return false;
    pts[3] = meet(pts[2], L[2], P[0], L[3], P[3]);
  } else {
    // diagonal from corner 1 to corner 3: corners 0 and 1 stay, 3 then 2 follow
    pts[3] = meet(P[0], L[3], P[1], lengthM, P[3]);
    if (!pts[3]) return false;
    pts[2] = meet(P[1], L[1], pts[3], L[2], P[2]);
  }
  if (!pts[2] || !pts[3]) return false;
  pts[4] = P[0];
  setWallsThrough(room, g.frame, pts);
  return true;
}
