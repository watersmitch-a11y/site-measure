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

export function newRoom(anchor = null) {
  return {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    ceilingHeightM: null,
    walls: [],
    anchor,
  };
}

export function roomLabel(room, index) {
  return room.name || `Room ${index + 1}`;
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
export function roomGeometry(rooms) {
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
