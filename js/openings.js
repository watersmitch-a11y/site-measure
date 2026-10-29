// Doors, windows and other openings. Each wall can carry:
//   wall.openings = [{ id, type, measuredTo, fromCorner, offsetM, widthM, heightM, sillM, note }]
//   wall.ceilingHeightM  (optional override of the job's ceiling height)
// offsetM is the distance from the chosen corner ('start' or 'end' of the
// wall) to the near edge of the opening, exactly as measured on site, so the
// opening stays anchored to that corner if the wall length is later edited.

export const OPENING_TYPES = {
  door: { label: 'Door', prefix: 'D' },
  window: { label: 'Window', prefix: 'W' },
  opening: { label: 'Opening', prefix: 'O' },
  other: { label: 'Other', prefix: 'X' },
};

export const MEASURED_TO = {
  plaster: 'Plaster to plaster',
  structural: 'Structural opening',
  frame: 'Inside frame',
};

const TOLERANCE_M = 0.001;

// Start and end of the opening along the wall, measured from the wall's start.
export function openingSpan(wall, opening) {
  const startM = opening.fromCorner === 'end'
    ? wall.lengthM - opening.offsetM - opening.widthM
    : opening.offsetM;
  return { startM, endM: startM + opening.widthM };
}

export function fitsOnWall(wall, opening) {
  const { startM, endM } = openingSpan(wall, opening);
  return startM >= -TOLERANCE_M && endM <= wall.lengthM + TOLERANCE_M;
}

// Returns the first other opening on the wall that this one overlaps, if any.
export function overlappingOpening(wall, opening) {
  const a = openingSpan(wall, opening);
  return (wall.openings || []).find((other) => {
    if (other.id === opening.id) return false;
    const b = openingSpan(wall, other);
    return a.startM < b.endM - TOLERANCE_M && b.startM < a.endM - TOLERANCE_M;
  });
}

// Tags like D1, D2, W1 numbered across the whole job in wall order.
export function openingTags(walls) {
  const counts = {};
  const tags = {};
  walls.forEach((wall) => {
    (wall.openings || []).forEach((o) => {
      const prefix = (OPENING_TYPES[o.type] || OPENING_TYPES.other).prefix;
      counts[prefix] = (counts[prefix] || 0) + 1;
      tags[o.id] = `${prefix}${counts[prefix]}`;
    });
  });
  return tags;
}

export function wallCeilingHeight(wall, jobCeilingM) {
  return wall.ceilingHeightM || jobCeilingM || null;
}

// Gross and net wall area (m²) over walls whose ceiling height is known.
export function wallAreas(walls, jobCeilingM) {
  let gross = 0;
  let openingArea = 0;
  let wallsCounted = 0;
  walls.forEach((wall) => {
    const h = wallCeilingHeight(wall, jobCeilingM);
    if (!h) return;
    wallsCounted += 1;
    gross += wall.lengthM * h;
    (wall.openings || []).forEach((o) => {
      openingArea += o.widthM * Math.min(o.heightM, Math.max(h - (o.sillM || 0), 0));
    });
  });
  return { gross, net: gross - openingArea, wallsCounted };
}
