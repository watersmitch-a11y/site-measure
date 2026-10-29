// Wall-chain geometry. A "wall" is:
//   { id, lengthM, angle, note }
// For the first wall, `angle` is the ABSOLUTE starting heading in degrees
// (0 = up/forward on screen, clockwise positive).
// For every later wall, `angle` is the TURN relative to the previous wall's
// heading (clockwise positive, counter-clockwise negative).

export function computeHeadings(walls) {
  let heading = 0;
  return walls.map((w, i) => {
    heading = i === 0 ? w.angle : heading + w.angle;
    return heading;
  });
}

export function computePoints(walls) {
  const headings = computeHeadings(walls);
  let x = 0;
  let y = 0;
  const points = [{ x, y }];
  walls.forEach((w, i) => {
    const rad = (headings[i] * Math.PI) / 180;
    x += w.lengthM * Math.sin(rad);
    y -= w.lengthM * Math.cos(rad);
    points.push({ x, y });
  });
  return points;
}

export function perimeter(walls) {
  return walls.reduce((sum, w) => sum + w.lengthM, 0);
}

// Distance (in meters) between the last point and the starting point.
export function closingGap(walls) {
  if (walls.length < 2) return null;
  const points = computePoints(walls);
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y);
}

// Heading (degrees) and length (meters) of the wall that would close the
// polygon back to the start point. Useful so the crew can double check the
// final wall's measurement against what would be needed geometrically.
export function closingWall(walls) {
  if (walls.length < 2) return null;
  const points = computePoints(walls);
  const first = points[0];
  const last = points[points.length - 1];
  const dx = first.x - last.x;
  const dy = first.y - last.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { lengthM: 0, heading: 0 };
  let heading = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (heading < 0) heading += 360;
  return { lengthM: length, heading };
}

// Shoelace formula. Assumes the shape is implicitly closed back to the
// first point, regardless of whether the last measured wall actually
// reaches it.
export function area(walls) {
  if (walls.length < 3) return null;
  const points = computePoints(walls);
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    sum += a.x * b.y - b.x * a.y;
  }
  // close back to start explicitly for the shoelace sum
  const last = points[points.length - 1];
  const first = points[0];
  sum += last.x * first.y - first.x * last.y;
  return Math.abs(sum) / 2;
}

export function boundingBox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
