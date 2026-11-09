// Bluetooth laser measures: a reading taken on the laser is typed into the
// length box in use. Works in Chrome on Android (and desktop Chrome/Edge);
// iPhones don't allow web apps to use Bluetooth.
//
// Supported:
//  - Leica DISTO with Bluetooth (D1, D2, D110, D510, X3, X4…): the DISTO
//    service sends each reading as a 32-bit float in metres.
//  - Bosch GLM with Bluetooth (GLM 50 C, 100 C, 120 C…): after switching on
//    sync mode, each reading arrives in a framed message with the distance
//    as a 32-bit float in metres.

const LEICA_SERVICE = '3ab10100-f831-4395-b29d-570977d5bf94';
const LEICA_DISTANCE = '3ab10101-f831-4395-b29d-570977d5bf94';
const BOSCH_SERVICE = '02a6c0d0-0451-4000-b000-fb3210111989';
const BOSCH_CHAR = '02a6c0d1-0451-4000-b000-fb3210111989';
const BOSCH_SYNC_ON = new Uint8Array([0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a]);

export const laserSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

let device = null;

// Bosch frames: C0 55 10 06 … with the distance at byte 7 (metres, float LE).
export function parseBosch(view) {
  if (view.byteLength >= 11 && view.getUint8(0) === 0xc0 && view.getUint8(1) === 0x55 &&
    view.getUint8(2) === 0x10 && view.getUint8(3) === 0x06) {
    return view.getFloat32(7, true);
  }
  return null;
}

export function parseLeica(view) {
  return view.byteLength >= 4 ? view.getFloat32(0, true) : null;
}

// Asks the user to pick their laser, then calls onReading(metres) for each
// measurement taken on it, and onDisconnect() if it drops out.
// Returns the device's name.
export async function connectLaser(onReading, onDisconnect) {
  if (!laserSupported()) throw new Error("This browser can't use Bluetooth. Use Chrome on Android.");
  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [LEICA_SERVICE] }, { namePrefix: 'DISTO' }, { namePrefix: 'GLM' }, { services: [BOSCH_SERVICE] }],
    optionalServices: [LEICA_SERVICE, BOSCH_SERVICE],
  });
  device.addEventListener('gattserverdisconnected', () => onDisconnect && onDisconnect());
  const server = await device.gatt.connect();
  const ok = (m) => Number.isFinite(m) && m > 0.01 && m < 300 && onReading(m);

  let service = await server.getPrimaryService(LEICA_SERVICE).catch(() => null);
  if (service) {
    const ch = await service.getCharacteristic(LEICA_DISTANCE);
    ch.addEventListener('characteristicvaluechanged', (e) => ok(parseLeica(e.target.value)));
    await ch.startNotifications();
    return device.name || 'Leica DISTO';
  }
  service = await server.getPrimaryService(BOSCH_SERVICE).catch(() => null);
  if (service) {
    const ch = await service.getCharacteristic(BOSCH_CHAR);
    ch.addEventListener('characteristicvaluechanged', (e) => ok(parseBosch(e.target.value)));
    await ch.startNotifications();
    await ch.writeValue(BOSCH_SYNC_ON);
    return device.name || 'Bosch GLM';
  }
  device.gatt.disconnect();
  throw new Error("That device isn't a laser this app knows (Leica DISTO or Bosch GLM).");
}

export function disconnectLaser() {
  if (device && device.gatt.connected) device.gatt.disconnect();
  device = null;
}
