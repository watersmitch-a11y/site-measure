// Builds and reads the unit-aware length fields used for walls, ceiling
// heights and openings. Each set of fields is identified by an id prefix,
// e.g. prefix 'len' gives #lenSingle, or #lenFeet + #lenInches in ft-in mode.

import * as units from './units.js';

const SINGLE_UNIT_CONFIG = {
  mm: { placeholder: 'Millimeters', suffix: 'mm', step: '1' },
  m: { placeholder: 'Meters', suffix: 'm', step: '0.01' },
  ft: { placeholder: 'Feet', suffix: 'ft', step: '0.01' },
};

function numberInput(id, placeholder) {
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.placeholder = placeholder;
  input.id = id;
  input.min = '0';
  return input;
}

function suffix(text) {
  const span = document.createElement('span');
  span.className = 'unit-suffix';
  span.textContent = text;
  return span;
}

export function buildLengthInput(container, unit, prefix, placeholder) {
  container.innerHTML = '';
  if (unit === 'ft-in') {
    const inches = numberInput(`${prefix}Inches`, 'Inches');
    inches.max = '11.9';
    container.append(numberInput(`${prefix}Feet`, 'Feet'), suffix('ft'), inches, suffix('in'));
    return;
  }
  const cfg = SINGLE_UNIT_CONFIG[unit];
  const input = numberInput(`${prefix}Single`, placeholder || cfg.placeholder);
  input.step = cfg.step;
  container.append(input, suffix(cfg.suffix));
}

// Returns meters, or null when blank or invalid. Zero is only accepted with
// allowZero (e.g. a 0 mm distance from a corner, or a door's 0 mm sill).
export function readLength(unit, prefix, { allowZero = false } = {}) {
  let meters;
  if (unit === 'ft-in') {
    const feetRaw = document.getElementById(`${prefix}Feet`).value;
    const inchesRaw = document.getElementById(`${prefix}Inches`).value;
    if (feetRaw === '' && inchesRaw === '') return null;
    meters = units.feetInchesToMeters(parseFloat(feetRaw) || 0, parseFloat(inchesRaw) || 0);
  } else {
    const raw = document.getElementById(`${prefix}Single`).value;
    if (raw === '') return null;
    if (unit === 'mm') meters = units.parseMm(raw);
    else meters = unit === 'm' ? units.parseMeters(raw) : units.parseDecimalFeet(raw);
  }
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  if (meters === 0 && !allowZero) return null;
  return meters;
}

export function setLength(unit, prefix, meters) {
  if (unit === 'ft-in') {
    const feetEl = document.getElementById(`${prefix}Feet`);
    const inchesEl = document.getElementById(`${prefix}Inches`);
    if (meters == null) {
      feetEl.value = '';
      inchesEl.value = '';
      return;
    }
    const { feet, inches } = units.metersToFeetInches(meters);
    feetEl.value = feet;
    inchesEl.value = Math.round(inches * 8) / 8;
    return;
  }
  const el = document.getElementById(`${prefix}Single`);
  if (meters == null) el.value = '';
  else if (unit === 'mm') el.value = Math.round(units.metersToMm(meters));
  else if (unit === 'm') el.value = meters.toFixed(2);
  else el.value = units.metersToFeet(meters).toFixed(2);
}
