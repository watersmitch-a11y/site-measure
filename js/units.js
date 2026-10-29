// Unit conversion helpers. Canonical internal storage unit is always meters.

const M_PER_FT = 0.3048;
const IN_PER_FT = 12;

export function feetToMeters(ft) {
  return ft * M_PER_FT;
}

export function metersToFeet(m) {
  return m / M_PER_FT;
}

export function metersToFeetInches(m) {
  const totalFeet = metersToFeet(m);
  let feet = Math.floor(totalFeet);
  let inches = (totalFeet - feet) * IN_PER_FT;
  // guard against floating point rounding pushing inches to ~12
  if (inches >= IN_PER_FT - 1e-6) {
    inches -= IN_PER_FT;
    feet += 1;
  }
  return { feet, inches };
}

export function feetInchesToMeters(feet, inches) {
  const totalFeet = (Number(feet) || 0) + (Number(inches) || 0) / IN_PER_FT;
  return feetToMeters(totalFeet);
}

// Parses a decimal feet string, e.g. "12.5"
export function parseDecimalFeet(str) {
  const v = parseFloat(str);
  return Number.isFinite(v) ? feetToMeters(v) : null;
}

export function parseMeters(str) {
  const v = parseFloat(str);
  return Number.isFinite(v) ? v : null;
}

export function metersToMm(m) {
  return m * 1000;
}

export function mmToMeters(mm) {
  return mm / 1000;
}

export function parseMm(str) {
  const v = parseFloat(str);
  return Number.isFinite(v) ? mmToMeters(v) : null;
}

// Formats a length (stored in meters) for display according to unit mode.
export function formatLength(meters, unit, precision) {
  if (meters == null || !Number.isFinite(meters)) return '--';
  if (unit === 'mm') {
    return `${Math.round(metersToMm(meters))} mm`;
  }
  if (unit === 'm') {
    return `${meters.toFixed(precision ?? 2)} m`;
  }
  if (unit === 'ft') {
    return `${metersToFeet(meters).toFixed(precision ?? 2)} ft`;
  }
  // ft-in
  const { feet, inches } = metersToFeetInches(meters);
  const inchesRounded = Math.round(inches * 8) / 8; // nearest 1/8 inch
  const wholeInches = Math.floor(inchesRounded);
  const frac = inchesRounded - wholeInches;
  const fracStr = frac > 0 ? ` ${formatFraction(frac)}` : '';
  return `${feet}' ${wholeInches}${fracStr}"`;
}

function formatFraction(frac) {
  // approximate to nearest 1/8
  const eighths = Math.round(frac * 8);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(eighths, 8) || 1;
  return `${eighths / g}/${8 / g}`;
}

export function formatArea(squareMeters, unit, precision = 1) {
  if (squareMeters == null || !Number.isFinite(squareMeters)) return '--';
  if (unit === 'mm' || unit === 'm') {
    return `${squareMeters.toFixed(precision)} m²`;
  }
  const sqFt = squareMeters / (M_PER_FT * M_PER_FT);
  return `${sqFt.toFixed(precision)} ft²`;
}

export const UNIT_LABELS = {
  mm: 'Millimeters',
  'ft-in': 'Feet & Inches',
  ft: 'Decimal Feet',
  m: 'Meters',
};
