# Site Measure

A no-install, no-dependency web app for measuring a construction site wall-by-wall and watching the floor plan build live. Runs in any modern browser and installs as a PWA on Android.

## How the workflow maps to the app

1. Measure the first wall with a tape measure or laser distance measure, pick your starting facing direction, type the length, tap **Add Wall**.
2. For each wall after that, pick the direction relative to the wall you just measured — **Left 90°**, **Straight**, **Right 90°**, or **Custom Angle** (for anything not square — bay windows, angled walls, etc. — with quick presets and an exact-degree input, left/right toggle).
3. Type the length and tap **Add Wall**. The plan redraws immediately with the new segment, running perimeter, and area (once you have 3+ walls).
4. Tap **Complete Perimeter (Close Shape)** once you're back near the start — it computes the exact length/angle of the final wall needed to close the shape, so you can cross-check it against your own tape reading.
5. Edit (pencil) or delete (trash) any wall in the list if a measurement was wrong — everything downstream recalculates automatically.
6. Jobs auto-save to the phone/browser's local storage. Use the folder icon (top right) to load or delete saved jobs, or **New Job** to start fresh.

## Running it

No build step, no npm, no Python — just static files. Two ways to use it:

**Directly on your phone (easiest):**
Put the `site-measure-app` folder somewhere it's reachable — e.g. host it for free on [Netlify Drop](https://app.netlify.com/drop) or GitHub Pages — then open the URL in Chrome on Android and use **⋮ → Install app** (or **Add to Home screen**) to get an app icon and full-screen standalone experience.

**On your PC first, then to your phone over WiFi:**
```
powershell -ExecutionPolicy Bypass -File serve.ps1
```
This starts a local server at `http://localhost:5500`. To reach it from your phone, both devices need to be on the same WiFi and you'll need Windows Firewall to allow inbound connections on that port; run `serve.ps1 -BindHost 0.0.0.0` and browse to `http://<your-pc's-LAN-IP>:5500` from the phone.

## Data & units

Everything (job name, unit preference, every wall's length and angle) is stored only on-device via `localStorage` — nothing leaves the phone/browser. Switch between Feet & Inches, Decimal Feet, and Meters anytime; past measurements convert automatically since they're stored internally in meters.

## Moving to a native Android app later

The app logic is deliberately framework-free and split into plain modules (`js/geometry.js`, `js/units.js`, `js/storage.js`, `js/render.js`) so the measurement math and state logic can be ported into React Native, Flutter, or wrapped as-is in Capacitor/Trusted Web Activity for a Play Store build, without a rewrite. Capacitor is the lowest-effort path since this is already a well-behaved PWA.
