// Rooms within a job. Each room is measured on its own:
//   { id, name, ceilingHeightM, walls, anchor }
// and its anchor says where it sits on the job plan:
//   null                                   first room, at the origin
//   { type: 'fixed', x, y, heading }       a fixed start point (heading null =
//                                          use the first wall's own direction)
//   { type: 'wall', roomId, wallId, fromCorner, offsetM, thicknessM }
//                                          on the far side of another room's
//                                          wall; Wall 1 runs along that wall,
//                                          away from the chosen corner

import { computePoints, boundingBox } from './geometry.js';

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

// Start point and heading for a room attached to a wall of a host room.
function attachedFrame(hostPoints, wallIndex, anchor) {
  const a = hostPoints[wallIndex];
  const b = hostPoints[wallIndex + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const sign = insideSign(hostPoints);
  // outward normal of the host room
  const ox = uy * sign;
  const oy = -ux * sign;
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
      if (hostPoints && idx >= 0) frame = attachedFrame(hostPoints, idx, anchor);
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

// Where to put a new room that isn't attached to anything: to the right of
// everything drawn so far.
export function separateRoomAnchor(rooms) {
  const frames = computeFrames(rooms);
  const all = rooms.flatMap((r) => (r.walls.length ? computePoints(r.walls, frames.get(r.id)) : []));
  if (all.length === 0) return { type: 'fixed', x: 0, y: 0, heading: null };
  const box = boundingBox(all);
  return { type: 'fixed', x: box.maxX + 1.5, y: box.maxY, heading: null };
}
