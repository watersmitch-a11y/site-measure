// Rooms within a job. Each room is measured on its own:
//   { id, name, ceilingHeightM, walls, anchor }
// and its anchor says where it sits on the job plan:
//   null                                   first room, at the origin
//   { type: 'fixed', x, y, heading }       a fixed start point (heading null =
//                                          use the first wall's own direction)
//   { type: 'wall', roomId, wallId, offsetM, thicknessM, sides }
//                                          a point on another room's wall,
//                                          offsetM from the wall's start,
//                                          moved off it by the wall thickness.
//                                          sides maps wall id -> +1/-1 (which
//                                          way to move off that wall line) or
//                                          0 (no move); it covers the tapped
//                                          wall and the walls either side, the
//                                          neighbours only counting when the
//                                          point is at their shared corner.
//                                          Wall 1's direction is the room's own.
//   { type: 'wall', roomId, wallId, fromCorner, offsetM, thicknessM, side }
//                                          Wall 1 is the far face of a shared
//                                          wall: it starts offsetM along the
//                                          host wall (from fromCorner) and runs
//                                          along it, moved off it by the wall
//                                          thickness towards `side` (+1/-1 of
//                                          the host wall's normal). Rooms from
//                                          before `side` existed go outward.

import { computePoints } from './geometry.js';

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

function wallNormal(points, idx) {
  const a = points[idx];
  const b = points[idx + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
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

// Start point and heading for a room attached along a wall of a host room
// (rooms created before tap-to-place).
function attachedFrame(hostPoints, wallIndex, anchor) {
  const a = hostPoints[wallIndex];
  const b = hostPoints[wallIndex + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  // move off the host wall towards the new room: the side tapped, or for
  // older rooms the host's outside
  const side = anchor.side ?? -insideSign(hostPoints);
  const ox = -uy * side;
  const oy = ux * side;
  const fromEnd = anchor.fromCorner === 'end';
  const base = fromEnd
    ? { x: b.x - ux * anchor.offsetM, y: b.y - uy * anchor.offsetM }
    : { x: a.x + ux * anchor.offsetM, y: a.y + uy * anchor.offsetM };
  const dx = fromEnd ? -ux : ux;
  const dy = fromEnd ? -uy : uy;
  return {
    x: base.x + ox * anchor.thicknessM,
    y: base.y + oy * anchor.thicknessM,
    heading: (Math.atan2(dx, -dy) * 180) / Math.PI,
  };
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
  const dirOf = (idx, from, to) => {
    const p = hostPoints[from];
    const q = hostPoints[to];
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
  };
  let startTrim = 0;
  let endTrim = 0;
  if (wallIdx > 0 || closed) {
    const prev = (wallIdx - 1 + n) % n;
    startTrim = trimFor(dirOf(prev, prev + 1, prev)); // from the corner back along the previous wall
  }
  if (wallIdx < n - 1 || closed) {
    const next = (wallIdx + 1) % n;
    endTrim = trimFor(dirOf(next, next, next + 1));
  }
  return { startM: startTrim, lengthM: Math.max(len - startTrim - endTrim, 0) };
}

// Map of room id -> frame { x, y, heading } for every room in the job.
// Attached rooms always come after their host, so one pass in order works.
export function computeFrames(rooms) {
  const frames = new Map();
  const pointsById = new Map();
  rooms.forEach((room) => {
    const anchor = room.anchor;
    let frame = { x: 0, y: 0, heading: null };
    if (anchor && anchor.type === 'fixed') {
      frame = { x: anchor.x, y: anchor.y, heading: anchor.heading ?? null };
    } else if (anchor && anchor.type === 'wall') {
      const host = rooms.find((r) => r.id === anchor.roomId);
      const hostPoints = host && pointsById.get(host.id);
      const idx = host ? host.walls.findIndex((w) => w.id === anchor.wallId) : -1;
      if (hostPoints && idx >= 0) {
        frame = anchor.sides ? sidedFrame(host, hostPoints, idx, anchor) : attachedFrame(hostPoints, idx, anchor);
      }
    }
    frames.set(room.id, frame);
    pointsById.set(room.id, computePoints(room.walls, frame));
  });
  return frames;
}

// Before a host room or wall is deleted, pin any rooms attached to it at
// their current position so they don't jump.
export function pinAttachedRooms(rooms, isAffected) {
  const frames = computeFrames(rooms);
  rooms.forEach((room) => {
    if (room.anchor && room.anchor.type === 'wall' && isAffected(room.anchor)) {
      const f = frames.get(room.id);
      room.anchor = { type: 'fixed', x: f.x, y: f.y, heading: f.heading };
    }
  });
}

// Every room's corner points on the job plan, keyed by room id.
export function computeRoomPoints(rooms) {
  const frames = computeFrames(rooms);
  return new Map(rooms.map((r) => [r.id, computePoints(r.walls, frames.get(r.id))]));
}
