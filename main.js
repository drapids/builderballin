const { app, BrowserWindow, ipcMain, dialog, shell, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

const EXE = 'project_garden-Win64-Shipping.exe';
const LAUNCHER = 'project_garden.exe';
const UA = 'Builderballin/1.0 (map editor for Hyperballin; github.com/drapids/Builderballin)';
const WEB_PARTITION = 'persist:web';
const GRAB_EXT = /\.(glb|gltf|zip|obj|stl|ply|fbx|3mf|vox|schem|schematic|litematic|nbt|bsp|png|jpe?g|webp)$/i;

let win = null;
let store = {};
let storePath = '';
let gameRunning = false;
let lastState = '';
let lastStateMtime = 0;
let webWin = null;

function hookSource() {
  return app.isPackaged ? path.join(process.resourcesPath, 'hook') : path.join(__dirname, 'hook');
}

function loadStore() {
  storePath = path.join(app.getPath('userData'), 'builderballin.json');
  try {
    store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    store = {};
  }
  store.recent = Array.isArray(store.recent) ? store.recent : [];
}

function saveStore() {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  } catch {}
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function findExe(dir, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === EXE.toLowerCase()) return dir;
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
      const r = findExe(path.join(dir, e.name), depth - 1);
      if (r) return r;
    }
  }
  return null;
}

function win64From(p) {
  if (!p) return null;
  let s;
  try {
    s = fs.statSync(p);
  } catch {
    return null;
  }
  if (s.isFile()) {
    const base = path.basename(p).toLowerCase();
    if (base === EXE.toLowerCase()) return path.dirname(p);
    if (base === LAUNCHER.toLowerCase()) p = path.dirname(p);
    else return null;
  }
  for (const c of [p, path.join(p, 'project_garden', 'Binaries', 'Win64'), path.join(p, 'Windows', 'project_garden', 'Binaries', 'Win64'), path.join(p, 'Binaries', 'Win64')]) {
    if (exists(path.join(c, EXE))) return c;
  }
  return findExe(p, 5);
}

function autoFind() {
  const home = os.homedir();
  const roots = [path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Games'), path.join(home, 'AppData', 'Roaming', 'itch', 'apps'), 'C:\\Games'];
  for (const r of roots) {
    let entries;
    try {
      entries = fs.readdirSync(r, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && /hyper|ballin|garden/i.test(e.name)) {
        const hit = findExe(path.join(r, e.name), 5);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function run(cmd, args, ms) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: ms }, (err, out) => resolve(err ? '' : out || '')));
}

async function processPath() {
  if (process.platform !== 'win32') return null;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-Process 'project_garden-Win64-Shipping' -ErrorAction SilentlyContinue | Select-Object -First 1).Path"], 8000);
  return out.trim() || null;
}

function layout(w = store.gameDir) {
  if (!w || !exists(path.join(w, EXE))) return null;
  const nested = path.join(w, 'ue4ss');
  const base = exists(path.join(nested, 'UE4SS.dll')) || exists(path.join(nested, 'Mods')) ? nested : w;
  return {
    base,
    mods: path.join(base, 'Mods'),
    mod: path.join(base, 'Mods', 'Hyperboi'),
    bridge: path.join(base, 'Mods', 'Hyperboi', 'bridge'),
    maps: path.join(base, 'Mods', 'Hyperboi', 'maps'),
    ue4ss: exists(path.join(base, 'UE4SS.dll')),
    proxy: ['dwmapi.dll', 'xinput1_3.dll'].some((d) => exists(path.join(w, d))),
    off: ['dwmapi.dll', 'xinput1_3.dll'].find((d) => exists(path.join(w, d + '.hyperboi-off'))),
    settings: path.join(base, 'UE4SS-settings.ini')
  };
}

function modVersion(file) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(/"ver=(\d+)"/);
    return m ? +m[1] : 0;
  } catch {
    return 0;
  }
}

function bundledVersion() {
  return modVersion(path.join(hookSource(), 'Hyperboi', 'Scripts', 'main.lua'));
}

function info() {
  const h = layout();
  const installed = h ? modVersion(path.join(h.mod, 'Scripts', 'main.lua')) : 0;
  return {
    desktop: true,
    gameDir: h ? store.gameDir : null,
    ue4ss: !!(h && h.ue4ss),
    hookOn: !!(h && h.proxy),
    hookOff: !!(h && h.off),
    mod: installed,
    bundled: bundledVersion(),
    ready: !!(h && h.ue4ss && h.proxy && installed > 0),
    running: gameRunning,
    hyperboi: hasHyperboi(),
    sketchfab: !!store.sketchfabToken,
    mapsFolder: h && exists(h.mod) ? h.maps : null,
    docs: mapsHome()
  };
}

function hasHyperboi() {
  const p = path.join(app.getPath('appData'), 'Hyperboi', 'hyperboi.json');
  return exists(p);
}

function push() {
  if (win && !win.isDestroyed()) win.webContents.send('info', info());
}

function send(ch, d) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, d);
}

function syncMod(force = false) {
  const h = layout();
  if (!h || !h.ue4ss) return false;
  const src = path.join(hookSource(), 'Hyperboi');
  const have = modVersion(path.join(h.mod, 'Scripts', 'main.lua'));
  if (!force && have >= bundledVersion()) return false;
  fs.mkdirSync(h.mods, { recursive: true });
  fs.cpSync(src, h.mod, { recursive: true, force: true });
  fs.mkdirSync(h.bridge, { recursive: true });
  fs.mkdirSync(h.maps, { recursive: true });
  fs.writeFileSync(path.join(h.mod, 'enabled.txt'), '');
  const txt = path.join(h.mods, 'mods.txt');
  if (exists(txt)) {
    let t = fs.readFileSync(txt, 'utf8');
    if (/^\s*Hyperboi\s*:/m.test(t)) t = t.replace(/^\s*Hyperboi\s*:.*$/m, 'Hyperboi : 1');
    else t = 'Hyperboi : 1\n' + t;
    fs.writeFileSync(txt, t);
  }
  const json = path.join(h.mods, 'mods.json');
  if (exists(json)) {
    try {
      const arr = JSON.parse(fs.readFileSync(json, 'utf8'));
      if (Array.isArray(arr)) {
        const e = arr.find((m) => m.mod_name === 'Hyperboi');
        if (e) e.mod_enabled = true;
        else arr.unshift({ mod_name: 'Hyperboi', mod_enabled: true });
        fs.writeFileSync(json, JSON.stringify(arr, null, 4));
      }
    } catch {}
  }
  if (exists(h.settings)) {
    const s = fs
      .readFileSync(h.settings, 'utf8')
      .replace(/^(\s*ConsoleEnabled\s*=\s*)\d/m, '$10')
      .replace(/^(\s*GuiConsoleEnabled\s*=\s*)\d/m, '$10')
      .replace(/^(\s*GuiConsoleVisible\s*=\s*)\d/m, '$10');
    fs.writeFileSync(h.settings, s);
  }
  return true;
}

function getJson(url, headers = {}) {
  return net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } }).then(async (r) => {
    if (!r.ok) throw new Error(`${new URL(url).hostname} said ${r.status}`);
    return r.json();
  });
}

async function download(url, dest, onProgress, headers = {}) {
  const r = await net.fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const total = Number(r.headers.get('content-length') || 0);
  const out = fs.createWriteStream(dest);
  const reader = r.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    out.write(Buffer.from(value));
    if (total && onProgress) onProgress(got / total);
  }
  await new Promise((res) => out.end(res));
}

function expand(zip, dest) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
      { windowsHide: true, timeout: 180000 },
      (err, _o, se) => (err ? reject(new Error((se || err.message).trim())) : resolve())
    );
  });
}

function pickAsset(releases) {
  const ok = (a) => /^UE4SS.*\.zip$/i.test(a.name) && !/zDEV|zCustom|source/i.test(a.name);
  const order = [...releases].sort((a, b) => (b.tag_name === 'experimental-latest') - (a.tag_name === 'experimental-latest'));
  for (const r of order) {
    if (r.draft) continue;
    const a = (r.assets || []).find(ok);
    if (a) return { url: a.browser_download_url, name: a.name, tag: r.tag_name };
  }
  return null;
}

async function installHook() {
  const step = (msg, p) => send('install', { msg, p });
  if (!store.gameDir) throw new Error('Find the game first.');
  if (gameRunning) throw new Error('Close Hyperballin first, it locks the files.');
  let h = layout();
  if (!h.ue4ss) {
    step('Asking GitHub for UE4SS', 0.05);
    const rel = await getJson('https://api.github.com/repos/UE4SS-RE/RE-UE4SS/releases?per_page=15');
    const asset = pickAsset(rel);
    if (!asset) throw new Error("Couldn't find a UE4SS download on GitHub.");
    const zip = path.join(os.tmpdir(), `builderballin-${asset.name}`);
    step(`Downloading ${asset.name}`, 0.1);
    await download(asset.url, zip, (p) => step(`Downloading ${asset.name}`, 0.1 + p * 0.6));
    step('Unzipping into the game', 0.75);
    await expand(zip, store.gameDir);
    try {
      fs.unlinkSync(zip);
    } catch {}
  }
  h = layout();
  if (!h.proxy && h.off) fs.renameSync(path.join(store.gameDir, h.off + '.hyperboi-off'), path.join(store.gameDir, h.off));
  step('Putting the map loader in', 0.9);
  syncMod(true);
  saveStore();
  step('Done', 1);
  push();
  return info();
}

function checkProcess() {
  if (process.platform !== 'win32') return;
  execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${EXE}`, '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 5000 }, async (err, out) => {
    const running = !err && out.toLowerCase().includes(EXE.toLowerCase());
    if (running && !store.gameDir) {
      const w = win64From(await processPath());
      if (w) {
        store.gameDir = w;
        saveStore();
      }
    }
    if (running !== gameRunning) {
      gameRunning = running;
      push();
    }
  });
}

function pollState() {
  const h = layout();
  if (!h) return;
  const p = path.join(h.bridge, 'state.txt');
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return;
  }
  if (st.mtimeMs === lastStateMtime) return;
  lastStateMtime = st.mtimeMs;
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return;
  }
  if (!raw.includes('end=1') || raw === lastState) return;
  lastState = raw;
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i);
    if (/^(status|level|map_)/.test(k)) out[k] = line.slice(i + 1);
  }
  out.fresh = Date.now() - st.mtimeMs < 3000;
  send('game', out);
}

function slug(s) {
  return (
    String(s || 'map')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'map'
  );
}

function writeIndex(dir) {
  const maps = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.hbmap$/i.test(f)) continue;
    try {
      const full = path.join(dir, f);
      const d = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (d.format !== 'builderballin' || !d.build) continue;
      maps.push({ f, m: d.meta || {}, t: fs.statSync(full).mtimeMs });
    } catch {}
  }
  maps.sort((a, b) => b.t - a.t);
  const clean = (v) => String(v || '').replace(/[|\r\n]/g, ' ');
  fs.writeFileSync(path.join(dir, 'index.txt'), maps.map((x) => [x.f, clean(x.m.name || x.f), clean(x.m.author), clean(x.m.difficulty)].join('|')).join('\n') + '\n');
}

async function playInGame(text, name) {
  const h = layout();
  if (!h || !h.ue4ss) throw new Error('Set up the game first.');
  if (modVersion(path.join(h.mod, 'Scripts', 'main.lua')) < bundledVersion()) syncMod(true);
  fs.mkdirSync(h.maps, { recursive: true });
  fs.mkdirSync(h.bridge, { recursive: true });
  const file = `${slug(name)}.hbmap`;
  fs.writeFileSync(path.join(h.maps, file), text);
  writeIndex(h.maps);
  const id = Date.now();
  fs.writeFileSync(path.join(h.bridge, 'play.txt'), `${id}|${file}|${Math.floor(id / 1000)}`);
  if (!gameRunning) {
    const root = path.resolve(store.gameDir, '..', '..', '..');
    const launcher = path.join(root, LAUNCHER);
    const exe = exists(launcher) ? launcher : path.join(store.gameDir, EXE);
    spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref();
    return { file, launched: true };
  }
  return { file, launched: false };
}

function mapsHome() {
  const d = path.join(app.getPath('documents'), 'Builderballin');
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {}
  return d;
}

function remember(p) {
  store.recent = [p, ...store.recent.filter((x) => x !== p)].slice(0, 30);
  saveStore();
}

function recentList() {
  const out = [];
  for (const p of store.recent) {
    try {
      const st = fs.statSync(p);
      const head = fs.readFileSync(p, 'utf8');
      const d = JSON.parse(head);
      out.push({ path: p, name: (d.meta && d.meta.name) || path.basename(p), difficulty: (d.meta && d.meta.difficulty) || '', objects: (d.objects || []).length, marbles: d.build ? (d.build.marbles || []).length : 0, updated: st.mtimeMs });
    } catch {}
  }
  return out;
}

function polyThumb(slugName) {
  return `https://cdn.polyhaven.com/asset_img/thumbs/${slugName}.png?width=320&height=240`;
}

let polyCache = null;
async function searchPolyHaven(q) {
  if (!polyCache) {
    const all = await getJson('https://api.polyhaven.com/assets?type=models');
    polyCache = Object.entries(all).map(([id, a]) => ({ id, name: a.name || id, tags: [...(a.tags || []), ...(a.categories || [])].map(String), downloads: a.download_count || 0, polycount: a.polycount || 0 }));
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = polyCache.filter((a) => !words.length || words.every((w) => a.name.toLowerCase().includes(w) || a.tags.some((t) => t.toLowerCase().includes(w))));
  hits.sort((a, b) => b.downloads - a.downloads);
  return hits.slice(0, 24).map((a) => ({
    source: 'polyhaven',
    id: a.id,
    name: a.name,
    by: 'Poly Haven',
    thumb: polyThumb(a.id),
    page: `https://polyhaven.com/a/${a.id}`,
    license: 'CC0',
    faces: a.polycount || 0,
    signup: false,
    free: true
  }));
}

async function searchSketchfab(q, cursor) {
  const u = new URL('https://api.sketchfab.com/v3/search');
  u.searchParams.set('type', 'models');
  u.searchParams.set('downloadable', 'true');
  u.searchParams.set('count', '24');
  u.searchParams.set('sort_by', '-likeCount');
  if (q) u.searchParams.set('q', q);
  if (cursor) u.searchParams.set('cursor', cursor);
  const d = await getJson(u.toString());
  const items = (d.results || [])
    .filter((m) => m.isDownloadable !== false && !(m.price > 0))
    .map((m) => {
      const imgs = ((m.thumbnails && m.thumbnails.images) || []).filter((i) => i.width >= 200).sort((a, b) => a.width - b.width);
      const glb = m.archives && m.archives.glb;
      return {
        source: 'sketchfab',
        id: m.uid,
        name: m.name,
        by: (m.user && (m.user.displayName || m.user.username)) || '',
        thumb: imgs[0] ? imgs[0].url : '',
        page: m.viewerUrl || `https://sketchfab.com/3d-models/${m.uid}`,
        license: (m.license && (m.license.label || m.license)) || '',
        faces: (glb && glb.faceCount) || m.faceCount || 0,
        size: (glb && glb.size) || 0,
        signup: !store.sketchfabToken,
        free: true
      };
    });
  return { items, next: d.cursors && d.cursors.next };
}

async function fetchPolyHaven(id, onProgress) {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const g = files.gltf || {};
  const res = g['1k'] || g['2k'] || Object.values(g)[0];
  if (!res || !res.gltf) throw new Error('No glTF version of that one.');
  const list = [{ url: res.gltf.url, name: path.basename(new URL(res.gltf.url).pathname) }];
  for (const [rel, f] of Object.entries(res.gltf.include || {})) list.push({ url: f.url, name: path.basename(rel) });
  const out = [];
  let i = 0;
  for (const f of list) {
    const r = await net.fetch(f.url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Poly Haven said ${r.status}`);
    out.push({ name: f.name, data: Buffer.from(await r.arrayBuffer()) });
    i++;
    onProgress(i / list.length);
  }
  return out;
}

async function fetchSketchfab(id, onProgress) {
  if (!store.sketchfabToken) return null;
  const d = await getJson(`https://api.sketchfab.com/v3/models/${id}/download`, { Authorization: `Token ${store.sketchfabToken}` });
  const pick = d.glb || d.gltf;
  if (!pick) throw new Error('Sketchfab has no download for that one.');
  const tmp = path.join(os.tmpdir(), `bb-${id}${d.glb ? '.glb' : '.zip'}`);
  await download(pick.url, tmp, onProgress);
  const data = fs.readFileSync(tmp);
  try {
    fs.unlinkSync(tmp);
  } catch {}
  return [{ name: `${id}${d.glb ? '.glb' : '.zip'}`, data }];
}

function openWeb(url) {
  if (webWin && !webWin.isDestroyed()) {
    webWin.loadURL(url);
    webWin.focus();
    return;
  }
  webWin = new BrowserWindow({
    width: 1180,
    height: 820,
    parent: win,
    backgroundColor: '#14132a',
    autoHideMenuBar: true,
    title: 'Find something to import',
    webPreferences: { partition: WEB_PARTITION, contextIsolation: true, sandbox: true }
  });
  webWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https:\/\//.test(u)) webWin.loadURL(u);
    return { action: 'deny' };
  });
  webWin.loadURL(url);
  webWin.on('closed', () => (webWin = null));
}

function watchDownloads() {
  const ses = session.fromPartition(WEB_PARTITION);
  ses.on('will-download', (_e, item) => {
    const name = item.getFilename();
    if (!GRAB_EXT.test(name)) return;
    const tmp = path.join(os.tmpdir(), `bb-grab-${Date.now()}-${name}`);
    item.setSavePath(tmp);
    send('grab', { name, state: 'start' });
    item.on('updated', () => {
      const t = item.getTotalBytes();
      if (t) send('grab', { name, state: 'progress', p: item.getReceivedBytes() / t });
    });
    item.once('done', (_ev, state) => {
      if (state !== 'completed') return send('grab', { name, state: 'failed' });
      try {
        const data = fs.readFileSync(tmp);
        fs.unlinkSync(tmp);
        send('grab', { name, state: 'done', files: [{ name, data }] });
        if (win) win.focus();
      } catch {
        send('grab', { name, state: 'failed' });
      }
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#14132a',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#14132a', symbolColor: '#aaa6d8', height: 52 },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());
  const f = fileArg(process.argv);
  if (f) win.webContents.once('did-finish-load', () => setTimeout(() => send('openFile', f), 2500));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => (win = null));
}

const handle = (ch, fn) =>
  ipcMain.handle(ch, async (_e, ...a) => {
    try {
      return { ok: true, value: await fn(...a) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

handle('info', () => info());
handle('game:detect', async () => {
  let w = gameRunning ? win64From(await processPath()) : null;
  if (!w) w = autoFind();
  if (!w) throw new Error("Couldn't find Hyperballin. Point me at it instead.");
  store.gameDir = w;
  saveStore();
  syncMod();
  push();
  return info();
});
handle('game:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Find Hyperballin', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Hyperballin', extensions: ['exe'] }] });
  if (r.canceled || !r.filePaths[0]) return info();
  const w = win64From(r.filePaths[0]);
  if (!w) throw new Error("That isn't Hyperballin. Look for the folder with project_garden in it.");
  store.gameDir = w;
  saveStore();
  syncMod();
  push();
  return info();
});
handle('game:install', () => installHook());
handle('game:play', (text, name) => playInGame(text, name));
handle('game:folder', () => {
  const h = layout();
  if (h) shell.openPath(exists(h.maps) ? h.maps : store.gameDir);
});
handle('game:log', () => {
  const h = layout();
  if (!h) return 'Find the game first.';
  const out = [];
  for (const [f, label] of [['maps_log.txt', 'Maps'], ['menu_log.txt', 'Menu'], ['error.txt', 'Errors']]) {
    const p = path.join(h.bridge, f);
    if (!exists(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    out.push(`${label}\n${lines.slice(-40).join('\n')}`);
  }
  return out.length ? out.join('\n\n') : 'Nothing yet. Start the game, then check again.';
});

handle('file:save', async (text, name, existing) => {
  let p = existing;
  if (!p) {
    const r = await dialog.showSaveDialog(win, { title: 'Save map', defaultPath: path.join(mapsHome(), `${slug(name)}.hbmap`), filters: [{ name: 'Builderballin map', extensions: ['hbmap'] }] });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath;
  }
  fs.writeFileSync(p, text);
  remember(p);
  return p;
});
handle('file:open', async (p) => {
  if (!p) {
    const r = await dialog.showOpenDialog(win, { title: 'Open map', defaultPath: mapsHome(), properties: ['openFile'], filters: [{ name: 'Builderballin map', extensions: ['hbmap', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    p = r.filePaths[0];
  }
  const text = fs.readFileSync(p, 'utf8');
  remember(p);
  return { path: p, text };
});
handle('file:recent', () => recentList());
handle('file:forget', (p) => {
  store.recent = store.recent.filter((x) => x !== p);
  saveStore();
  return recentList();
});
handle('file:reveal', (p) => shell.showItemInFolder(p));
handle('file:sendToHyperboi', (text, name) => {
  const h = layout();
  if (!h || !exists(h.mod)) throw new Error('Set up the game first, Hyperboi reads maps from the same place.');
  fs.mkdirSync(h.maps, { recursive: true });
  const file = `${slug(name)}.hbmap`;
  fs.writeFileSync(path.join(h.maps, file), text);
  writeIndex(h.maps);
  return file;
});

handle('search', async (source, q, cursor) => {
  if (source === 'polyhaven') return { items: await searchPolyHaven(q || ''), next: null };
  return searchSketchfab(q || '', cursor);
});
handle('search:get', async (source, id) => {
  const prog = (p) => send('fetch', { id, p });
  if (source === 'polyhaven') return fetchPolyHaven(id, prog);
  return fetchSketchfab(id, prog);
});
handle('search:token', (t) => {
  store.sketchfabToken = String(t || '').trim();
  saveStore();
  return info();
});
handle('web:open', (url) => {
  if (!/^https:\/\//.test(url)) throw new Error('Bad link');
  openWeb(url);
});
handle('external', (url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

function fileArg(argv) {
  return (argv || []).find((a) => /\.hbmap$/i.test(a) && exists(a)) || null;
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const f = fileArg(argv);
  if (f) send('openFile', f);
});

app.whenReady().then(() => {
  loadStore();
  if (!store.gameDir) {
    const w = autoFind();
    if (w) {
      store.gameDir = w;
      saveStore();
    }
  }
  try {
    syncMod();
  } catch {}
  watchDownloads();
  createWindow();
  checkProcess();
  setInterval(checkProcess, 2500);
  setInterval(pollState, 400);
});

app.on('window-all-closed', () => app.quit());
