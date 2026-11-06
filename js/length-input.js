// Builds and reads the unit-aware length fields used for walls, ceiling
// heights and openings. Each set of fields is identified by an id prefix,
// e.g. prefix 'len' gives #lenSingle, or #lenFeet + #lenInches in ft-in mode.

import * as units from './units.js';

// Measurements can be typed as sums, e.g. "=2500-(920/2)": + - * / and
// brackets, with x or × also meaning multiply. A leading = is optional;
// commas are ignored (2,500). Returns the number, or null if it isn't one.
export function evaluateExpression(raw) {
  const src = String(raw).trim().replace(/^=/, '').replace(/,/g, '').replace(/[x×]/gi, '*').replace(/÷/g, '/');
  const tokens = src.match(/\d*\.?\d+|[-+*/()]|\S/g) || [];
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const fail = () => { throw new Error('bad expression'); };
  function factor() {
    const t = take();
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') {
      const v = expr();
      if (take() !== ')') fail();
      return v;
    }
    if (t !== undefined && /^\d*\.?\d+$/.test(t)) return parseFloat(t);
    return fail();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') v = take() === '*' ? v * factor() : v / factor();
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term();
    return v;
  }
  try {
    if (!tokens.length) return null;
    const v = expr();
    return pos === tokens.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const isSum = (raw) => /[-+*/x×÷()=]/i.test(String(raw).trim().replace(/^-?\d*\.?\d+$/, ''));

// What a field's typed value comes to, as a number in its own unit: a plain
// number or a sum, and nothing else (so stray letters aren't read as a number).
function fieldValue(raw) {
  return raw === '' ? null : evaluateExpression(raw);
}

const SINGLE_UNIT_CONFIG = {
  mm: { placeholder: 'Millimeters', suffix: 'mm', step: '1' },
  m: { placeholder: 'Meters', suffix: 'm', step: '0.01' },
  ft: { placeholder: 'Feet', suffix: 'ft', step: '0.01' },
};

// Text rather than number fields, so a sum can be typed; they still bring up
// the number keypad until the = button asks for the full keyboard.
function numberInput(id, placeholder) {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.placeholder = placeholder;
  input.id = id;
  return input;
}

// The = button and the line under the fields showing what a sum comes to.
function addCalculator(container, unitSuffixes) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'calc-btn';
  btn.textContent = '=';
  btn.title = 'Type a sum, e.g. =2500-(920/2)';
  const preview = document.createElement('div');
  preview.className = 'calc-preview';
  const inputs = [...container.querySelectorAll('input')];
  let current = inputs[0];
  inputs.forEach((input) => {
    input.addEventListener('focus', () => { current = input; });
    input.addEventListener('input', () => {
      const parts = inputs
        .filter((inp) => isSum(inp.value))
        .map((inp) => {
          const v = evaluateExpression(inp.value);
          const unit = unitSuffixes[inputs.indexOf(inp)];
          return v == null ? 'not a valid sum yet' : `= ${Math.round(v * 1000) / 1000} ${unit}`;
        });
      preview.textContent = parts.join(' · ');
      preview.classList.toggle('bad', parts.some((t) => t.startsWith('not')));
    });
    // a finished sum is replaced by its answer when leaving the field
    input.addEventListener('change', () => {
      if (!isSum(input.value)) return;
      const v = evaluateExpression(input.value);
      if (v == null) return;
      input.value = String(Math.round(v * 1000) / 1000);
      input.inputMode = 'decimal';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  // keep focus in the field, and bring up the full keyboard with its symbols
  btn.addEventListener('pointerdown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    current.inputMode = 'text';
    if (!current.value.startsWith('=')) current.value = `=${current.value}`;
    current.blur();
    current.focus();
    const end = current.value.length;
    current.setSelectionRange(end, end);
  });
  container.append(btn, preview);
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
    container.append(numberInput(`${prefix}Feet`, 'Feet'), suffix('ft'), numberInput(`${prefix}Inches`, 'Inches'), suffix('in'));
    addCalculator(container, ['ft', 'in']);
    return;
  }
  const cfg = SINGLE_UNIT_CONFIG[unit];
  const input = numberInput(`${prefix}Single`, placeholder || cfg.placeholder);
  container.append(input, suffix(cfg.suffix));
  addCalculator(container, [cfg.suffix]);
}

// Returns meters, or null when blank or invalid. Zero is only accepted with
// allowZero (e.g. a 0 mm distance from a corner, or a door's 0 mm sill);
// negative values only with allowNegative (e.g. an offset either side of a line).
export function readLength(unit, prefix, { allowZero = false, allowNegative = false } = {}) {
  let meters;
  if (unit === 'ft-in') {
    const feetRaw = document.getElementById(`${prefix}Feet`).value.trim();
    const inchesRaw = document.getElementById(`${prefix}Inches`).value.trim();
    if (feetRaw === '' && inchesRaw === '') return null;
    const feet = feetRaw === '' ? 0 : fieldValue(feetRaw);
    const inches = inchesRaw === '' ? 0 : fieldValue(inchesRaw);
    if (feet == null || inches == null) return null;
    meters = units.feetInchesToMeters(feet, inches);
  } else {
    const value = fieldValue(document.getElementById(`${prefix}Single`).value.trim());
    if (value == null) return null;
    if (unit === 'mm') meters = units.parseMm(String(value));
    else meters = unit === 'm' ? units.parseMeters(String(value)) : units.parseDecimalFeet(String(value));
  }
  if (meters == null || !Number.isFinite(meters) || (meters < 0 && !allowNegative)) return null;
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
