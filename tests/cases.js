// The test cases run by tests/run.js. Each gets { page, context, base, tmp, assert }.

const fs = require('fs');
const path = require('path');

// A rectangular room's walls, walked from its bottom-left corner: up, right,
// down, left. Ids are prefix + a/b/c/d.
const rect = (id, w, h, openings = {}) => ['a', 'b', 'c', 'd'].map((k, i) => ({
  id: id + k,
  lengthM: i % 2 === 0 ? h : w,
  angle: i === 0 ? 0 : 90,
  openings: openings[k] || [],
}));

const door = (id, offsetM, extra = {}) => ({
  id, type: 'door', measuredTo: 'plaster', fromCorner: 'start', offsetM, widthM: 0.82, heightM: 2.04, sillM: 0, hinge: 'left', swing: 'in', note: '', ...extra,
});

async function loadJob(page, job) {
  await page.evaluate((j) => {
    const full = { id: 'job', name: 'Test', unit: 'mm', activeRoomId: j.rooms[0].id, ...j, updatedAt: new Date().toISOString() };
    localStorage.clear();
    localStorage.setItem(`siteMeasure.job.${full.id}`, JSON.stringify(full));
    localStorage.setItem('siteMeasure.jobIndex', JSON.stringify([{ id: full.id, name: full.name, updatedAt: full.updatedAt }]));
  }, job);
  await page.reload();
}

const saved = (page) => page.evaluate(() => {
  const idx = JSON.parse(localStorage.getItem('siteMeasure.jobIndex'));
  const latest = [...idx].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  return JSON.parse(localStorage.getItem(`siteMeasure.job.${latest.id}`));
});

async function addWall(page, heading, mm) {
  await page.click(`#dirPad .pad-btn[data-heading="${heading}"]`);
  await page.fill('#lenSingle', String(mm));
  await page.click('#addWallBtn');
}

async function tapWall(page, wallId) {
  await page.$eval('#planSvg', (e) => e.scrollIntoView({ block: 'center' }));
  // let any redraw from the sheet changing height land first
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const box = await page.$eval(`.plan-hit[data-wall-id="${wallId}"]`, (l) => {
    const r = l.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForSelector('#wallPanel:not(.hidden)');
}

const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const mmOf = (m) => Math.round(m * 1000);
const confirm = (page) => page.click('.confirm-ok');

const tests = [
  {
    name: 'every room draws when one room has no walls yet',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [
        { id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null },
        { id: 'r2', number: 2, walls: [], anchor: { type: 'fixed', x: 6, y: 0, heading: null } },
        { id: 'r3', number: 3, walls: rect('r3', 2, 2), anchor: { type: 'fixed', x: 9, y: 0, heading: null } },
      ], activeRoomId: 'r3' });
      const names = await texts(page, '.plan-room-name');
      assert.ok(names.includes('Room 1') && names.includes('Room 3'), `room names drawn: ${names}`);
      assert.match(await page.textContent('#statsBar'), /4\.0 m²/);
    },
  },
  {
    name: 'gap to the next room is dimensioned and fills the length',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [
        { id: 'r1', number: 1, walls: rect('r1', 6, 4), anchor: null },
        { id: 'r3', number: 2, walls: rect('r3', 3, 4), anchor: { type: 'fixed', x: 8.5, y: 0, heading: null } },
        { id: 'r8', number: 3, walls: [], anchor: { type: 'fixed', x: 6.11, y: 0, heading: null } },
      ], activeRoomId: 'r8' });
      assert.deepEqual(await texts(page, '.plan-dim-label'), ['2280 mm']);
      await addWall(page, 0, 4000);
      await page.click('#dirPad .pad-btn[data-heading="90"]');
      const chips = await texts(page, '#matchChips .chip');
      assert.ok(chips.some((c) => c.includes('to Room 2') && c.includes('2280')), `chips: ${chips}`);
      await page.click('#matchChips .chip >> nth=-1');
      assert.equal(await page.inputValue('#lenSingle'), '2280');
    },
  },
  {
    name: 'gaps between neighbouring rooms show around a shared-wall room',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [
        { id: 'r1', number: 1, walls: rect('r1', 8, 3), anchor: null },
        { id: 'r2', number: 2, walls: rect('r2', 2, 2.5), anchor: { type: 'fixed', x: 0, y: -3.22, heading: null } },
        { id: 'r3', number: 3, walls: rect('r3', 3.18, 3), anchor: { type: 'fixed', x: 2.9, y: -5, heading: null } },
        { id: 'r8', number: 4, walls: [], anchor: { type: 'wall', shared: true, roomId: 'r3', wallId: 'r3d', offsetM: 0, lengthM: 3.18, thicknessM: 0.11, side: -1, reversed: true } },
      ], activeRoomId: 'r8' });
      const dims = await texts(page, '.plan-dim-label');
      assert.ok(dims.includes('1780 mm') && dims.includes('680 mm'), `dims: ${dims}`);
    },
  },
  {
    name: 'a shared-wall room wider or narrower than the stretch still closes',
    async run({ page, assert }) {
      for (const [width, walls, shared] of [[4000, 4, 3180], [2500, 3, 2500]]) {
        await loadJob(page, { rooms: [
          { id: 'r1', number: 1, walls: rect('r1', 8, 3), anchor: null },
          { id: 'r3', number: 2, walls: rect('r3', 3.18, 3), anchor: { type: 'fixed', x: 2.9, y: -5, heading: null } },
          { id: 'r8', number: 3, walls: [], anchor: { type: 'wall', shared: true, roomId: 'r3', wallId: 'r3d', offsetM: 0, lengthM: 3.18, thicknessM: 0.11, side: -1, reversed: true } },
        ], activeRoomId: 'r8' });
        await addWall(page, 180, 1780);
        await addWall(page, 270, width);
        await addWall(page, 0, 1780);
        const r8 = (await saved(page)).rooms.find((r) => r.id === 'r8');
        assert.equal(r8.walls.length, walls, `walls for ${width}`);
        assert.equal(mmOf(r8.anchor.lengthM), shared);
        assert.match(await page.textContent('#statsBar'), /Closed ✓/);
      }
    },
  },
  {
    name: 'moving a joined room moves its group; cancel puts it back; separate frees it',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [
        { id: 'r1', number: 1, walls: rect('r1', 8, 3), anchor: null },
        { id: 'r3', number: 2, walls: rect('r3', 3.18, 3, { d: [door('d1', 1)] }), anchor: { type: 'fixed', x: 2.9, y: -5, heading: null } },
        { id: 'r8', number: 3, walls: [], anchor: { type: 'wall', shared: true, roomId: 'r3', wallId: 'r3d', offsetM: 0, lengthM: 3.18, thicknessM: 0.11, side: -1, reversed: true } },
        { id: 'r9', number: 4, walls: rect('r9', 2, 2), anchor: { type: 'fixed', x: 12, y: -8, heading: null } },
      ], activeRoomId: 'r8' });
      await addWall(page, 180, 1780); await addWall(page, 270, 3180); await addWall(page, 0, 1780);
      await page.click('#moveRoomBtn');
      assert.match(await page.textContent('#moveTitle'), /with Room 1, Room 2 \(joined\)/);
      await page.click('#nudgePad button[data-dx="1"]');
      await page.click('#doneMoveBtn');
      let j = await saved(page);
      const x = (id) => j.rooms.find((r) => r.id === id).anchor.x;
      assert.equal(x('r1'), 0.1);
      assert.equal(x('r3'), 3);
      assert.equal(x('r9'), 12);
      const before = JSON.stringify(j.rooms.map((r) => r.anchor));
      await page.click('#moveRoomBtn');
      await page.click('#rotateRightBtn');
      await page.click('#cancelMoveBtn');
      j = await saved(page);
      assert.equal(JSON.stringify(j.rooms.map((r) => r.anchor)), before);
      await page.click('#separateRoomBtn');
      await confirm(page);
      j = await saved(page);
      const r8 = j.rooms.find((r) => r.id === 'r8');
      assert.equal(r8.anchor.type, 'fixed');
      assert.deepEqual(r8.walls.map((w) => mmOf(w.lengthM)), [1780, 3180, 1780, 3180]);
      assert.deepEqual(r8.walls[3].openings.map((o) => [mmOf(o.offsetM), o.hinge, o.swing]), [[1360, 'right', 'out']]);
      await page.click('#moveRoomBtn');
      assert.doesNotMatch(await page.textContent('#moveTitle'), /joined/);
      await page.click('#cancelMoveBtn');
    },
  },
  {
    name: 'breaking a wall and inserting a nib keeps the room closed',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 8, 3), anchor: null }] });
      await tapWall(page, 'r1b');
      await page.click('#wallTabs [data-tab="size"]');
      await page.selectOption('#breakEndSelect', { index: 0 });
      await page.fill('#breakAtSingle', '2000');
      await page.click('#breakWallBtn');
      assert.match(await page.textContent('#entryTitle'), /Inserting a wall after Wall 2/);
      await addWall(page, 0, 300); await addWall(page, 90, 1000); await addWall(page, 180, 300);
      await page.click('#finishInsertBtn');
      const r1 = (await saved(page)).rooms[0];
      assert.deepEqual(r1.walls.map((w) => mmOf(w.lengthM)), [3000, 2000, 300, 1000, 300, 5000, 3000, 8000]);
      assert.match(await page.textContent('#statsBar'), /24\.3 m².*Closed ✓/);
    },
  },
  {
    name: 'room numbers stay put; undo and redo step through changes',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [
        { id: 'r1', walls: rect('r1', 4, 3), anchor: null },
        { id: 'r2', name: 'Kitchen', walls: rect('r2', 3, 3), anchor: { type: 'fixed', x: 4.11, y: 0, heading: null } },
        { id: 'r3', walls: rect('r3', 2, 2), anchor: { type: 'fixed', x: 10, y: 0, heading: null } },
      ] });
      const tabs = () => page.$$eval('#roomTabs .room-tab:not(.add)', (b) => b.map((x) => x.firstChild.textContent));
      assert.deepEqual(await tabs(), ['Room 1', 'Kitchen', 'Room 3']);
      await page.click('#deleteRoomBtn');
      await confirm(page);
      assert.deepEqual(await tabs(), ['Kitchen', 'Room 3']);
      await page.click('#undoActionBtn');
      assert.deepEqual(await tabs(), ['Room 1', 'Kitchen', 'Room 3']);
      await page.click('#redoActionBtn');
      assert.deepEqual(await tabs(), ['Kitchen', 'Room 3']);
      await page.click('#undoActionBtn');
      assert.equal(await page.$eval('#undoActionBtn', (b) => b.disabled), true);
    },
  },
  {
    name: 'wall thickness, photos, PDF, DXF and job file round trip',
    async run({ page, browser, tmp, base, assert }) {
      await loadJob(page, { name: 'Test/Job', rooms: [
        { id: 'r1', walls: rect('r1', 4, 3, { b: [door('d1', 0.5)] }), anchor: null },
        { id: 'r2', name: 'Kitchen', walls: rect('r2', 3, 3), anchor: { type: 'fixed', x: 4.11, y: 0, heading: null } },
      ] });
      await tapWall(page, 'r1a');
      await page.click('#wallTabs [data-tab="size"]');
      await page.click('#wallThickChips .chip[data-mm="230"]');
      assert.equal((await saved(page)).rooms[0].walls[0].thicknessM, 0.23);
      const png = path.join(tmp, 'tiny.png');
      fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64'));
      await page.setInputFiles('#wallPhotoInput', png);
      await page.waitForSelector('#photoViewer:not(.hidden)');
      await page.fill('#photoNote', 'cracked plaster');
      await page.click('#donePhotoBtn');
      await page.click('#closeWallPanelBtn');
      assert.deepEqual((await saved(page)).rooms[0].photos.map((p) => p.note), ['cracked plaster']);

      await page.click('#menuBtn'); await page.click('#exportBtn');
      await page.click('#exportPdfBtn');
      await page.waitForFunction(() => window.__printed === 1);
      assert.equal((await page.$$('#printView .print-photos img')).length, 1);
      assert.match(await page.textContent('#printView'), /230 mm wall/);

      await page.click('#menuBtn'); await page.click('#exportBtn');
      const [dxf] = await Promise.all([page.waitForEvent('download'), page.click('#exportDxfBtn')]);
      assert.equal(dxf.suggestedFilename(), 'Test-Job.dxf');
      const text = fs.readFileSync(await dxf.path(), 'utf8').split('\r\n');
      assert.equal(text.length % 2, 1, 'group codes come in pairs'); // plus the trailing newline
      const values = text.filter((_, i) => i % 2 === 1);
      assert.equal(values[values.length - 1], 'EOF');
      assert.ok(values.filter((v) => v === 'POLYLINE').length >= 8 && values.includes('ARC'), 'walls and door swing in the DXF');

      await page.click('#menuBtn'); await page.click('#exportBtn');
      const [jf] = await Promise.all([page.waitForEvent('download'), page.click('#exportJobBtn')]);
      const file = path.join(tmp, 'job.json');
      await jf.saveAs(file);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(data.format, 'site-measure-job');
      assert.equal(Object.keys(data.photos).length, 1);

      const other = await (await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' })).newPage();
      await other.goto(base);
      await other.click('#menuBtn'); await other.click('#jobsBtn');
      await other.setInputFiles('#importJobInput', file);
      await other.waitForFunction(() => document.querySelector('#jobName').value === 'Test/Job');
      await other.waitForSelector('#roomPhotos .photo-thumb img[src^="blob:"]');
      await other.context().close();
    },
  },
  {
    name: 'spreading a closing gap and squaring from a diagonal',
    async run({ page, assert }) {
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await addWall(page, 0, 3000); await addWall(page, 90, 4000); await addWall(page, 180, 3030); await addWall(page, 270, 4000);
      await page.click('#spreadGapBtn');
      assert.match(await page.textContent('.confirm-message'), /30 mm gap/);
      await confirm(page);
      let walls = (await saved(page)).rooms[0].walls;
      assert.deepEqual(walls.map((w) => mmOf(w.lengthM)), [3006, 4000, 3024, 4000]);
      await page.click('#squareCheck summary');
      await page.selectOption('#diagFrom', '0');
      await page.selectOption('#diagTo', '2');
      await page.fill('#diagSingle', '5040');
      await page.click('#diagCheckBtn');
      assert.match(await page.textContent('#diagResult'), /longer than the plan/);
      await page.click('#diagFixBtn');
      walls = (await saved(page)).rooms[0].walls;
      assert.deepEqual(walls.map((w) => mmOf(w.lengthM)), [3006, 4000, 3024, 4000]);
      const job = await saved(page);
      assert.ok(Math.abs(job.rooms[0].diagonal.planM - 5.04) < 0.002, `diagonal now ${job.rooms[0].diagonal.planM}`);
    },
  },
  {
    name: 'job details, room picker and site mode',
    async run({ page, assert }) {
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.click('#menuBtn'); await page.click('#newJobBtn');
      await page.waitForSelector('#detailsPanel:not(.hidden)');
      await page.fill('#detailAddress', '12 Smith St, Fitzroy VIC 3065');
      await page.fill('#detailClient', 'Acme Aged Care');
      await page.click('#doneDetailsBtn');
      assert.equal(await page.inputValue('#jobName'), '12 Smith St, Fitzroy VIC 3065');
      assert.match(await page.textContent('#saveState'), /Saved ✓/);
      const job = await saved(page);
      await loadJob(page, { ...job, rooms: [...job.rooms, ...[2, 3, 4, 5, 6, 7].map((n) => ({ id: `x${n}`, number: n, walls: [], anchor: { type: 'fixed', x: n * 3, y: 0, heading: null } }))] });
      assert.equal((await page.$$('.room-select option')).length, 7);
      await page.selectOption('.room-select', 'x4');
      assert.match(await page.textContent('#entryTitle'), /Room 4/);
      await page.click('#menuBtn'); await page.click('#siteModeBtn');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '18px');
      await page.click('#menuBtn'); await page.click('#siteModeBtn');
    },
  },
  {
    name: 'room details, fixtures, levels and a Bluetooth laser',
    async run({ page, assert }) {
      await page.addInitScript(() => {
        const listeners = [];
        const ch = {
          addEventListener: (t, f) => listeners.push(f),
          startNotifications: async () => {
            window.__laserSend = (m) => {
              const buf = new ArrayBuffer(4);
              new DataView(buf).setFloat32(0, m, true);
              listeners.forEach((f) => f({ target: { value: new DataView(buf) } }));
            };
          },
        };
        const device = {
          name: 'DISTO D2',
          addEventListener: () => {},
          gatt: { connected: true, disconnect: () => {}, connect: async () => ({ getPrimaryService: async (u) => { if (u.startsWith('3ab10100')) return { getCharacteristic: async () => ch }; throw new Error('no'); } }) },
        };
        Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => device } });
      });
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      await page.click('#roomDetails summary');
      await page.fill('#rdFloor', 'Vinyl planks');
      await page.press('#rdFloor', 'Tab');
      assert.deepEqual((await saved(page)).rooms[0].details, { floor: 'Vinyl planks' });

      await tapWall(page, 'r1b');
      await page.click('#wallTabs [data-tab="fixtures"]');
      await page.click('#addFixtureBtn');
      await page.selectOption('#fixtureType', 'gpo2');
      await page.fill('#fxOffSingle', '600');
      await page.fill('#fixtureQty', '2');
      await page.click('#saveFixtureBtn');
      await page.click('#addFixtureBtn');
      await page.selectOption('#fixtureType', 'switch');
      await page.fill('#fxOffSingle', '5000');
      await page.click('#saveFixtureBtn');
      assert.match(await page.textContent('#fixtureError'), /past the end/);
      await page.click('#cancelFixtureBtn');
      await page.click('#closeWallPanelBtn');
      assert.deepEqual(await texts(page, '.plan-fixture-label'), ['2×DGPO1']);

      await page.click('#addAnywayBtn'); // the room's closed, so the wall form is tucked away
      await page.click('#numPad [data-key="laser"]');
      await page.waitForFunction(() => document.querySelector('#laserBtn').textContent.includes('connected'));
      await page.evaluate(() => window.__laserSend(2.345));
      assert.equal(await page.inputValue('#lenSingle'), '2345');

      await page.click('#menuBtn'); await page.click('#addLevelBtn');
      await page.fill('.prompt-input', 'Level 1');
      await confirm(page);
      await addWall(page, 0, 2000); await addWall(page, 90, 2000); await addWall(page, 180, 2000); await addWall(page, 270, 2000);
      assert.equal((await page.$$('.plan-band')).length, 4, 'only this level drawn');
      await page.selectOption('#levelSelect', 'Ground floor');
      const job = await saved(page);
      assert.deepEqual(job.levels, ['Ground floor', 'Level 1']);
      await page.click('#menuBtn'); await page.click('#exportBtn');
      await page.click('#exportPdfBtn');
      await page.waitForFunction(() => window.__printed === 1);
      assert.equal((await page.$$('#printView .print-plan')).length, 2);
      assert.match(await page.textContent('#printView'), /Services & fixtures[\s\S]*Vinyl planks|Vinyl planks[\s\S]*Services & fixtures/);
    },
  },
  {
    name: 'a wall can’t be shortened past its doors, windows or fixtures',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3, { b: [door('d1', 2.5)] }), anchor: null }] });
      await tapWall(page, 'r1b');
      await page.click('#wallTabs [data-tab="size"]');
      await page.fill('#panelLenSingle', '3000');
      await page.click('#updateLengthBtn');
      assert.match(await page.textContent('#panelLengthError'), /D1/);
      assert.equal(mmOf((await saved(page)).rooms[0].walls[1].lengthM), 4000);
    },
  },
  {
    name: 'placing a room on a wall, adding a door, lining up doorways and zooming',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [
        { id: 'r1', number: 1, walls: rect('r1', 4, 3, { c: [door('d1', 1)] }), anchor: null },
        { id: 'r2', number: 2, walls: rect('r2', 3, 3, { a: [door('d2', 1)] }), anchor: { type: 'fixed', x: 9, y: 2, heading: null } },
      ] });
      // a new room off Room 1's right-hand wall
      await page.click('#roomTabs .room-tab.add');
      await page.$eval('#planSvg', (e) => e.scrollIntoView({ block: 'center' }));
      const box = await page.$eval('.plan-hit[data-wall-id="r1c"]', (l) => { const r = l.getBoundingClientRect(); return { x: r.x + r.width / 2 + 12, y: r.y + r.height / 2 }; });
      await page.mouse.click(box.x, box.y);
      await page.waitForSelector('#roomPanel:not(.hidden)');
      await page.click('#createRoomBtn');
      let job = await saved(page);
      const r3 = job.rooms[job.rooms.length - 1];
      assert.equal(r3.anchor.shared, true);
      assert.equal(r3.anchor.wallId, 'r1c');
      // a door on its first wall, through the form
      await addWall(page, 90, 2000);
      await tapWall(page, job.rooms[2] ? (await saved(page)).rooms[2].walls[0].id : '');
      await page.click('#wallTabs [data-tab="openings"]');
      await page.click('#addOpeningBtn');
      await page.click('#openingTypeButtons [data-type="door"]');
      await page.fill('#opOffSingle', '300');
      await page.fill('#opWSingle', '820');
      await page.fill('#opHSingle', '2040');
      await page.click('#saveOpeningBtn');
      await page.click('#closeWallPanelBtn');
      job = await saved(page);
      assert.equal(job.rooms[2].walls[0].openings.length, 1);
      // Room 2 lined up with Room 1 by its doorway
      await page.click('#roomTabs .room-tab >> nth=1');
      await page.click('#moveRoomBtn');
      await page.click('#matchDoorBtn');
      await page.selectOption('#doorHereSelect', 'd2');
      await page.selectOption('#doorThereSelect', 'd1');
      await page.click('#applyDoorMatchBtn');
      await page.click('#doneMoveBtn');
      job = await saved(page);
      const a = job.rooms.find((r) => r.id === 'r2').anchor;
      assert.ok(Math.abs(a.x - 4.11) < 0.002, `Room 2 now starts at x ${a.x}`);
      // zoom in and back out
      await page.click('#zoomInBtn');
      assert.equal(await page.isVisible('#zoomFitBtn'), true);
      await page.click('#zoomFitBtn');
      assert.equal(await page.isVisible('#zoomFitBtn'), false);
    },
  },
  {
    name: 'a full phone storage is reported, not silently lost',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      await page.evaluate(() => {
        window.__realSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      });
      await page.click('#roomDetails summary');
      await page.fill('#rdFloor', 'Carpet');
      await page.waitForSelector('.confirm-message');
      assert.match(await page.textContent('.confirm-message'), /storage for this app is full/);
      await confirm(page);
      assert.match(await page.textContent('#saveState'), /Not saved/);
      await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
      await page.fill('#rdFloor', 'Carpet tiles');
      await page.waitForFunction(() => /Saved ✓/.test(document.querySelector('#saveState').textContent));
    },
  },
  {
    name: 'PDF wall lengths keep clear of opening and fixture tags',
    async run({ page, assert }) {
      const win = { id: 'w1', type: 'window', measuredTo: 'plaster', fromCorner: 'start', offsetM: 0.9, widthM: 1.2, heightM: 1.2, sillM: 0.9 };
      const walls = rect('r1', 4, 3, { c: [win] });
      walls[1].fixtures = [{ id: 'f1', type: 'gpo2', fromCorner: 'start', offsetM: 2, qty: 1 }];
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls, anchor: null }] });
      await page.click('#menuBtn'); await page.click('#exportBtn');
      await page.click('#exportPdfBtn');
      await page.waitForFunction(() => window.__printed === 1);
      await page.emulateMedia({ media: 'print' });
      const clashes = await page.evaluate(() => {
        const t = [...document.querySelectorAll('#printView svg text')].map((e) => ({ s: e.textContent, r: e.getBoundingClientRect() }));
        const hits = [];
        t.forEach((a, i) => t.slice(i + 1).forEach((c) => {
          if (a.r.left < c.r.right && c.r.left < a.r.right && a.r.top < c.r.bottom && c.r.top < a.r.bottom) hits.push(`${a.s} / ${c.s}`);
        }));
        return { hits, count: t.length, sized: t.every((x) => x.r.width > 0) };
      });
      await page.emulateMedia({ media: 'screen' });
      assert.ok(clashes.count > 5 && clashes.sized, 'labels measured');
      assert.deepEqual(clashes.hits, []);
    },
  },
  {
    name: 'a closed room says so instead of offering another wall',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      assert.match(await page.textContent('#entryTitle'), /closed ✓/);
      assert.equal(await page.isVisible('#addWallBtn'), false);
      await page.click('#addAnywayBtn');
      assert.equal(await page.isVisible('#addWallBtn'), true);
      await page.click('#wallList .edit-btn >> nth=0');
      assert.match(await page.textContent('#entryTitle'), /Editing Wall 1/);
    },
  },
  {
    name: 'notes save as they are typed, as one undo step',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      await page.click('#roomDetails summary');
      await page.type('#rdNotes', 'Damp under window', { delay: 20 });
      await page.waitForFunction(() => {
        const idx = JSON.parse(localStorage.getItem('siteMeasure.jobIndex'));
        const j = JSON.parse(localStorage.getItem(`siteMeasure.job.${idx[0].id}`));
        return j.rooms[0].details && j.rooms[0].details.notes === 'Damp under window';
      });
      // the phone locking saves straight away
      await page.type('#rdNotes', '!', { delay: 0 });
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal((await saved(page)).rooms[0].details.notes, 'Damp under window!');
      await page.evaluate(() => { delete document.visibilityState; });
      await page.click('#undoActionBtn');
      assert.equal((await saved(page)).rooms[0].details, undefined, 'one undo takes the whole note away');
    },
  },
  {
    name: 'photos no job uses are cleaned up',
    async run({ page, tmp, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      const png = path.join(tmp, 'tiny2.png');
      fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64'));
      await page.setInputFiles('#roomPhotoInput', png);
      await page.waitForSelector('#photoViewer:not(.hidden)');
      await page.click('#donePhotoBtn');
      const count = () => page.evaluate(() => import('./js/photos.js').then((m) => m.listPhotoIds()).then((k) => k.length));
      assert.equal(await count(), 1);
      // delete the job: its photo goes
      await page.click('#menuBtn'); await page.click('#jobsBtn');
      await page.click('#jobsList .delete-btn');
      await confirm(page);
      await page.waitForFunction(() => import('./js/photos.js').then((m) => m.listPhotoIds()).then((k) => k.length === 0));
    },
  },
  {
    name: 'empty levels can be deleted and leave no stray rooms',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      assert.equal(await page.$eval('#deleteLevelBtn', (b) => b.classList.contains('hidden')), true);
      await page.click('#menuBtn'); await page.click('#addLevelBtn');
      await page.fill('.prompt-input', 'Level 1');
      await confirm(page);
      assert.equal(await page.$eval('#deleteLevelBtn', (b) => b.classList.contains('hidden')), false);
      await page.selectOption('#levelSelect', 'Ground floor');
      let job = await saved(page);
      assert.equal(job.rooms.length, 1, 'the unused room on Level 1 went');
      await page.selectOption('#levelSelect', 'Level 1');
      await page.click('#menuBtn'); await page.click('#deleteLevelBtn');
      await confirm(page);
      job = await saved(page);
      assert.deepEqual(job.levels, ['Ground floor']);
      assert.equal(job.rooms.length, 1);
      assert.equal(await page.inputValue('#levelSelect'), 'Ground floor');
    },
  },
  {
    name: 'labels on a busy plan don’t overlap, on screen or in the PDF',
    async run({ page, assert }) {
      const r1 = rect('r1', 5.2, 4.1, { b: [{ id: 'w1', type: 'window', measuredTo: 'plaster', fromCorner: 'start', offsetM: 1.5, widthM: 1.8, heightM: 1.2, sillM: 0.9 }], c: [door('d1', 1.2)] });
      r1[3].fixtures = [{ id: 'f1', type: 'gpo2', fromCorner: 'start', offsetM: 1, qty: 2 }];
      const r2 = rect('r2', 3.2, 4.1, { a: [door('d2', 1.2, { hinge: 'right' })], c: [door('d3', 2, { swing: 'out' })] });
      const r3 = rect('r3', 2.4, 2.2, { b: [door('d4', 0.8)] });
      r3[0].fixtures = [{ id: 'f2', type: 'grab', fromCorner: 'start', offsetM: 0.4, widthM: 0.9 }, { id: 'f3', type: 'tap', fromCorner: 'start', offsetM: 1.6 }];
      await loadJob(page, { rooms: [
        { id: 'r1', number: 1, name: 'Lounge', walls: r1, anchor: null },
        { id: 'r2', number: 2, name: 'Bedroom 1', walls: r2, anchor: { type: 'fixed', x: 5.31, y: 0, heading: null } },
        { id: 'r3', number: 3, name: 'Ensuite', walls: r3, anchor: { type: 'fixed', x: 5.31, y: -6.42, heading: null } },
      ] });
      const overlaps = (sel) => page.evaluate((selector) => {
        const t = [...document.querySelectorAll(selector)].filter((e) => e.textContent.trim())
          .map((e) => ({ s: e.textContent, r: e.getBoundingClientRect() }));
        const hits = [];
        const pad = 1; // px
        t.forEach((a, i) => t.slice(i + 1).forEach((c) => {
          if (a.r.left + pad < c.r.right && c.r.left + pad < a.r.right && a.r.top + pad < c.r.bottom && c.r.top + pad < a.r.bottom) hits.push(`${a.s} / ${c.s}`);
        }));
        return hits;
      }, sel);
      for (const tab of [0, 1, 2]) {
        await page.click(`#roomTabs .room-tab >> nth=${tab}`);
        assert.deepEqual(await overlaps('#planSvg text'), [], `screen, room ${tab + 1} selected`);
      }
      await page.click('#menuBtn'); await page.click('#exportBtn');
      await page.click('#exportPdfBtn');
      await page.waitForFunction(() => window.__printed === 1);
      await page.emulateMedia({ media: 'print' });
      assert.deepEqual(await overlaps('#printView svg text'), [], 'PDF');
      await page.emulateMedia({ media: 'screen' });
    },
  },
  {
    name: 'the selected room tab stays in view; the wall window has tabs',
    async run({ page, assert }) {
      const rooms = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `r${n}`, number: n, name: `Long room name ${n}`, walls: rect(`r${n}`, 3, 3), anchor: { type: 'fixed', x: n * 4, y: 0, heading: null } }));
      await loadJob(page, { rooms, activeRoomId: 'r6' });
      const inView = await page.evaluate(() => {
        const strip = document.querySelector('#roomTabs').getBoundingClientRect();
        const tab = document.querySelector('#roomTabs .room-tab.selected').getBoundingClientRect();
        return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
      });
      assert.ok(inView, 'selected tab fully visible');
      await tapWall(page, 'r6b');
      assert.deepEqual(await texts(page, '#wallTabs .wall-tab'), ['Size', 'Openings', 'Fixtures', 'Photos']);
      assert.equal(await page.isVisible('#addOpeningBtn'), true, 'opens on Openings');
      assert.equal(await page.isVisible('#updateLengthBtn'), false);
      await page.click('#wallTabs [data-tab="size"]');
      assert.equal(await page.isVisible('#updateLengthBtn'), true);
      await page.click('#closeWallPanelBtn');
      await tapWall(page, 'r6c');
      assert.equal(await page.isVisible('#updateLengthBtn'), true, 'remembers the last tab');
    },
  },
  {
    name: 'renaming a room renames it on the plan as you type',
    async run({ page, assert }) {
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      await page.click('#roomName');
      await page.keyboard.type('Kitchen');
      assert.deepEqual(await texts(page, '.plan-room-name'), ['Kitchen']);
      await page.click('#entryTitle');
      await page.reload();
      assert.deepEqual(await texts(page, '.plan-room-name'), ['Kitchen']);
      await page.click('#menuBtn'); await page.click('#detailsBtn');
      assert.match(await page.textContent('#versionText'), /Version \d+/);
    },
  },
  {
    name: 'number pad types lengths and sums; the sheet steps up and down; the menu',
    async run({ page, assert }) {
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      const key = (k) => page.click(`#numPad [data-key="${k}"]`);
      assert.equal(await page.isVisible('#numPad'), true, 'pad shows while entering a wall');
      assert.equal(await page.$eval('#lenSingle', (i) => i.inputMode), 'none', 'no phone keyboard');
      await page.click('#dirPad .pad-btn[data-heading="0"]');
      for (const k of ['2', '5', '0', '0', '-', '(', '9', '2', '0', '/', '2', ')']) await key(k);
      assert.equal(await page.inputValue('#lenSingle'), '2500-(920/2)');
      await key('back');
      await key(')');
      await page.click('#addWallBtn');
      const job = await saved(page);
      assert.equal(mmOf(job.rooms[0].walls[0].lengthM), 2040);
      // the phone keyboard instead
      await key('kb');
      assert.equal(await page.isVisible('#numPad'), false);
      assert.equal(await page.$eval('#lenSingle', (i) => i.inputMode), 'decimal');
      await page.reload();
      assert.equal(await page.isVisible('#numPad'), false, 'remembered');
      // the sheet: low → half → full → low
      const size = () => page.$eval('#sheet', (e) => e.dataset.size);
      const plan = () => page.$eval('#planSvg', (e) => e.getBoundingClientRect().height);
      const low = await plan();
      await page.click('#sheetHandle');
      assert.equal(await size(), 'half');
      await page.click('#sheetHandle');
      assert.equal(await size(), 'full');
      assert.ok(await plan() < low, 'plan gives way to the sheet');
      await page.click('#sheetHandle');
      assert.equal(await size(), 'low');
      // the menu opens and closes
      await page.click('#menuBtn');
      assert.equal(await page.isVisible('#unitSelect'), true);
      await page.mouse.click(10, 500);
      assert.equal(await page.isVisible('#unitSelect'), false);
    },
  },
  {
    name: 'on a tablet the plan and the sheet sit side by side',
    async run({ page, assert }) {
      await page.setViewportSize({ width: 1024, height: 768 });
      await loadJob(page, { rooms: [{ id: 'r1', number: 1, walls: rect('r1', 4, 3), anchor: null }] });
      const plan = await page.$eval('#planSvg', (e) => e.getBoundingClientRect().toJSON());
      const sheet = await page.$eval('#sheet', (e) => e.getBoundingClientRect().toJSON());
      assert.ok(sheet.left >= plan.right - 1, 'sheet to the right of the plan');
      assert.ok(plan.height > 500, `plan uses the height (${plan.height})`);
      assert.equal(await page.isVisible('#sheetHandle'), false);
    },
  },
  {
    name: 'random jobs draw and switch rooms without errors',
    async run({ page, assert }) {
      let seed = 11;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      for (let trial = 0; trial < 25; trial++) {
        const rooms = [];
        const n = 3 + Math.floor(rnd() * 5);
        for (let r = 0; r < n; r++) {
          const walls = [];
          const nw = pick([0, 1, 2, 4, 4, 5, 6]);
          for (let w = 0; w < nw; w++) {
            const len = pick([0.6, 1, 2, 3, 4.89, 5]);
            const openings = rnd() < 0.4 ? [door(`o${r}_${w}`, rnd() * len * 0.5, { type: pick(['door', 'window', 'opening', 'other']), widthM: Math.min(0.9, len * 0.4), fromCorner: pick(['start', 'end']) })] : [];
            const fixtures = rnd() < 0.3 ? [{ id: `f${r}_${w}`, type: pick(['gpo', 'grab', 'tap']), fromCorner: 'start', offsetM: len / 3, widthM: 0.3 }] : [];
            walls.push({ id: `w${r}_${w}`, lengthM: len, angle: w === 0 ? pick([0, 90, 180, 270]) : pick([90, -90, 0]), openings, fixtures, thicknessM: pick([undefined, undefined, 0.23]) });
          }
          let anchor = null;
          const hosts = rooms.filter((h) => h.walls.length);
          if (r > 0 && hosts.length && rnd() < 0.8) {
            const host = pick(hosts);
            const hw = pick(host.walls);
            anchor = rnd() < 0.6
              ? { type: 'wall', shared: true, roomId: host.id, wallId: hw.id, offsetM: rnd() * hw.lengthM * 0.5, lengthM: hw.lengthM * 0.5, thicknessM: 0.11, side: pick([1, -1]), reversed: rnd() < 0.3 }
              : { type: 'fixed', x: rnd() * 8 - 4, y: rnd() * 8 - 4, heading: null };
          }
          rooms.push({ id: `r${r}`, walls, anchor, level: pick([undefined, 'Ground floor']) });
        }
        await loadJob(page, { rooms });
        const count = (await page.$$('#roomTabs .room-tab:not(.add)')).length;
        for (let t = 0; t < count; t++) await page.click(`#roomTabs .room-tab:not(.add) >> nth=${t}`);
      }
      assert.ok(true);
    },
  },
];

module.exports = { tests };
