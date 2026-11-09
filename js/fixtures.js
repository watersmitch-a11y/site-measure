// Services and fixtures on a wall: power points, switches, taps, grab rails
// and the like. Each wall can carry
//   wall.fixtures = [{ id, type, fromCorner, offsetM, heightM, widthM, qty, note }]
// offsetM runs from the chosen end of the wall ('start' or 'end') to the
// centre of the fixture (to its near end for one with a width, e.g. a grab
// rail); heightM is its height above the floor, if measured.

export const FIXTURE_TYPES = {
  gpo: { label: 'Power point (single)', prefix: 'GPO' },
  gpo2: { label: 'Power point (double)', prefix: 'DGPO' },
  switch: { label: 'Light switch', prefix: 'SW' },
  data: { label: 'Data / phone', prefix: 'DATA' },
  tv: { label: 'TV / antenna', prefix: 'TV' },
  tap: { label: 'Tap / water point', prefix: 'TAP' },
  waste: { label: 'Waste / drain', prefix: 'WST' },
  grab: { label: 'Grab rail', prefix: 'GR', width: true },
  nurse: { label: 'Nurse call', prefix: 'NC' },
  ac: { label: 'A/C unit', prefix: 'AC', width: true },
  heater: { label: 'Heater / panel', prefix: 'HTR', width: true },
  bench: { label: 'Bench / joinery', prefix: 'BJ', width: true },
  other: { label: 'Other', prefix: 'F', width: true },
};

export const fixtureType = (f) => FIXTURE_TYPES[f.type] || FIXTURE_TYPES.other;

// Where a fixture sits along its wall from the wall's start: [from, to] (the
// same point twice for one without a width).
export function fixtureSpan(wall, f) {
  const w = f.widthM || 0;
  const near = f.fromCorner === 'end' ? wall.lengthM - f.offsetM - w : f.offsetM;
  return [near, near + w];
}

export function fixtureFits(wall, f) {
  const [a, b] = fixtureSpan(wall, f);
  return a >= -0.001 && b <= wall.lengthM + 0.001;
}

// Tags numbered per type through the job: GPO1, GPO2, SW1…
export function fixtureTags(walls) {
  const counts = {};
  const tags = {};
  walls.forEach((wall) => (wall.fixtures || []).forEach((f) => {
    const prefix = fixtureType(f).prefix;
    counts[prefix] = (counts[prefix] || 0) + 1;
    tags[f.id] = `${prefix}${counts[prefix]}`;
  }));
  return tags;
}
