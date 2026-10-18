const DIFF_COLORS = { Chill: '#9dffca', Easy: '#5fc8ff', Medium: '#fff600', Hard: '#ff8165', Brutal: '#ff5a4a', Fever: '#e400db' };

const ICONS = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  cube: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  find: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  dot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>'
};

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function createHome(ui) {
  const { html, esc, toast, animate, SPRINGS, desk } = ui;
  let el = null;
  let info = null;
  const thumbCache = new Map();

  const gameRows = () => {
    if (!desk) {
      return `<div class="h-game web"><h3>Play in the game</h3><p>The desktop app sets up the game for you and launches your map straight into Hyperballin. In the browser, export the map and drop it into Hyperboi.</p><a class="btn line small" href="https://github.com/drapids/Builderballin" target="_blank" rel="noopener">Get the desktop app</a></div>`;
    }
    const i = info || {};
    const row = (ok, title, sub, act) => `<li class="${ok ? 'ok' : ''}"><span class="h-state">${ok ? ICONS.check : ICONS.dot}</span><div><b>${title}</b><span>${sub}</span></div>${act || ''}</li>`;
    return `<div class="h-game"><h3>Game</h3><ul>
      ${row(!!i.gameDir, 'Hyperballin', i.gameDir ? esc(i.gameDir.replace(/\\Windows\\project_garden\\Binaries\\Win64$/i, '')) : 'Not found yet', i.gameDir ? '' : '<button class="btn small line" data-g="detect">Find it</button>')}
      ${row(i.ready, 'Map loader', i.ready ? `Installed${i.running ? ', game is running' : ''}` : i.gameDir ? 'Needs installing once' : 'Find the game first', i.gameDir && !i.ready ? '<button class="btn small primary" data-g="setup">Set up</button>' : '')}
      ${i.hyperboi ? row(true, 'Hyperboi', 'Also installed. It shares the same loader and map list.') : ''}
    </ul></div>`;
  };

  const templateCards = () =>
    ui.TEMPLATES.map((t) => {
      const m = t.make();
      const d = m.meta.difficulty;
      const counts = ui.countMap(m);
      return `<button class="h-tpl" data-tpl="${t.id}"><div class="h-thumb">${thumbCache.has(t.id) ? `<img alt="" src="${thumbCache.get(t.id)}">` : ''}</div><div class="h-tpl-body"><div class="h-tpl-top"><b>${esc(t.name)}</b>${t.id === 'blank' ? '' : `<span class="h-diff" style="--d:${DIFF_COLORS[d] || '#aaa6d8'}">${esc(d)}</span>`}</div><p>${esc(t.blurb)}</p><span class="h-count">${counts.spawners ? `Up to ${counts.total} marbles at once` : `${counts.marbles} marbles`}</span></div></button>`;
    }).join('');

  const recentRows = async () => {
    if (!desk) {
      const cur = ui.savedName();
      return cur ? `<button class="h-row" data-continue><div><b>${esc(cur)}</b><span>Saved in this browser</span></div><span class="h-row-go">Continue</span></button>` : '<p class="h-empty">Maps you make save in this browser as you go.</p>';
    }
    let list = [];
    try {
      list = await desk.file.recent();
    } catch {}
    if (!list.length) return '<p class="h-empty">Nothing saved yet. Press Ctrl+S in the editor and your maps show up here.</p>';
    return list
      .slice(0, 12)
      .map((r) => `<div class="h-row" data-path="${esc(r.path)}"><div><b>${esc(r.name)}</b><span>${[r.difficulty, r.marbles ? `${r.marbles} marbles` : '', ago(r.updated)].filter(Boolean).join(' · ')}</span></div><button class="h-row-x" data-reveal title="Show in folder">Folder</button><button class="h-row-x" data-forget title="Remove from this list">Remove</button></div>`)
      .join('');
  };

  const bind = () => {
    el.querySelector('[data-act=new]').addEventListener('click', () => pick(() => ui.startTemplate('blank')));
    el.querySelector('[data-act=open]').addEventListener('click', () => ui.openAny().then((ok) => ok && close()));
    el.querySelector('[data-act=import]').addEventListener('click', () => {
      close();
      ui.pickImport();
    });
    el.querySelector('[data-act=find]').addEventListener('click', () => {
      close();
      ui.openSearch();
    });
    const cont = el.querySelector('[data-act=continue]');
    if (cont) cont.addEventListener('click', () => close());
    el.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => pick(() => ui.startTemplate(b.dataset.tpl))));
  };

  const bindRecents = () => {
    el.querySelectorAll('.h-row[data-path]').forEach((r) => {
      r.addEventListener('click', async (e) => {
        if (e.target.closest('[data-forget]')) {
          await desk.file.forget(r.dataset.path);
          el.querySelector('.h-recent').innerHTML = await recentRows();
          bindRecents();
          return;
        }
        if (e.target.closest('[data-reveal]')) return desk.file.reveal(r.dataset.path);
        if (await ui.openPath(r.dataset.path)) close();
      });
    });
    const c = el.querySelector('[data-continue]');
    if (c) c.addEventListener('click', () => close());
  };

  const refreshGame = async () => {
    if (!el) return;
    if (desk) {
      try {
        info = await desk.info();
      } catch {}
    }
    const g = el.querySelector('.h-game-slot');
    g.innerHTML = gameRows();
    g.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => (b.dataset.g === 'detect' ? detect() : ui.openSetup().then(refreshGame))));
  };

  const detect = async () => {
    try {
      info = await desk.game.detect();
      toast('Found Hyperballin');
    } catch {
      try {
        info = await desk.game.pick();
      } catch (err) {
        toast(err.message, true);
      }
    }
    refreshGame();
  };

  const pick = (fn) => {
    fn();
    close();
  };

  const fillThumbs = () => {
    const queue = ui.TEMPLATES.filter((t) => !thumbCache.has(t.id));
    const next = () => {
      const t = queue.shift();
      if (!t || !el) return;
      const url = ui.mapThumb(t.make(), 480, 300);
      thumbCache.set(t.id, url);
      const slot = el.querySelector(`[data-tpl="${t.id}"] .h-thumb`);
      if (slot) {
        const img = html(`<img alt="" src="${url}">`);
        slot.appendChild(img);
        animate(img, { opacity: [0, 1] }, { spring: SPRINGS.gentle });
      }
      setTimeout(next, 30);
    };
    setTimeout(next, 60);
  };

  async function open({ first = false } = {}) {
    if (el) return;
    if (desk) {
      try {
        info = await desk.info();
      } catch {}
    }
    const cur = ui.savedName();
    el = html(`<section class="home ${desk ? 'desktop' : ''}" aria-label="Start">
      <div class="h-top"><div class="brand big"><span class="brand-marble" aria-hidden="true"></span><span class="brand-text"><span class="brand-name">BUILDERBALLIN'</span><span class="brand-kana" lang="ja">ビルダーボーリン</span></span></div>${first ? '' : '<button class="btn ghost h-back" data-act="continue">Back to the editor</button>'}</div>
      <div class="h-body">
        <aside class="h-side">
          <nav class="h-actions">
            <button data-act="new">${ICONS.plus}<span><b>New map</b><small>Start, a few marbles, the Dominus</small></span></button>
            <button data-act="open">${ICONS.open}<span><b>Open a map</b><small>.hbmap files from here or Hyperboi</small></span></button>
            <button data-act="import">${ICONS.cube}<span><b>Import</b><small>PNG, Minecraft build, model, .bsp map</small></span></button>
            <button data-act="find">${ICONS.find}<span><b>Find models online</b><small>Free 3D models and builds</small></span></button>
          </nav>
          ${cur && first ? `<button class="h-continue" data-act="continue"><span>Keep going on</span><b>${esc(cur)}</b></button>` : ''}
          <div class="h-game-slot">${gameRows()}</div>
        </aside>
        <main class="h-main">
          <h2>Start from a map</h2>
          <div class="h-tpls">${templateCards()}</div>
          <h2>${desk ? 'Your maps' : 'In this browser'}</h2>
          <div class="h-recent">${await recentRows()}</div>
        </main>
      </div>
    </section>`);
    document.body.appendChild(el);
    bind();
    bindRecents();
    refreshGame();
    animate(el, { opacity: [0, 1] }, { spring: SPRINGS.gentle });
    el.querySelectorAll('.h-actions button, .h-tpl').forEach((b, i) => animate(b, { opacity: [0, 1], transform: ['translateY(10px)', 'none'] }, { spring: SPRINGS.gentle, delay: 60 + i * 28 }));
    document.addEventListener('keydown', onKey, true);
    fillThumbs();
  }

  function onKey(e) {
    if (e.key === 'Escape' && el && !document.querySelector('#modalRoot').children.length) {
      e.stopPropagation();
      close();
    }
  }

  function close() {
    if (!el) return;
    const node = el;
    el = null;
    document.removeEventListener('keydown', onKey, true);
    const a = node.animate({ opacity: [1, 0], transform: ['none', 'scale(1.01)'] }, { duration: 200, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => node.remove();
    ui.onHomeClosed && ui.onHomeClosed();
  }

  return { open, close, isOpen: () => !!el, refresh: refreshGame };
}

export function createGame(ui) {
  const { html, esc, toast, modal, desk } = ui;
  let last = null;
  let pill = null;
  let info = null;

  const label = (s) => {
    if (!info || !info.gameDir) return ['off', 'Game not set up'];
    if (!info.ready) return ['off', 'Loader not installed'];
    if (!info.running) return ['idle', 'Game closed'];
    if (!s || !s.fresh) return ['wait', 'Game starting'];
    const st = s.map_status || 'none';
    if (st.startsWith('loading')) {
      const m = st.match(/(\d+)\/(\d+)/);
      const pct = m ? Math.round((+m[1] / Math.max(1, +m[2])) * 100) : 0;
      return ['busy', `Loading ${s.map_name || 'map'} ${pct}%`];
    }
    if (st === 'waiting') return ['busy', 'Map waiting for the level'];
    if (st === 'loaded') return ['live', s.map_finish ? `Finished in ${(+s.map_finish).toFixed(2)} s` : `Playing ${s.map_name || ''}`];
    if (st === 'error') return ['bad', s.map_error || 'Map failed'];
    return ['live', s.status === 'menu' ? 'In the main menu' : 'Game running'];
  };

  const paint = () => {
    if (!pill) return;
    const [k, text] = label(last);
    pill.dataset.k = k;
    pill.querySelector('span').textContent = text;
  };

  async function refresh() {
    try {
      info = await desk.info();
    } catch {}
    paint();
    return info;
  }

  function mount(slot) {
    pill = html('<button class="game-pill" title="Game and loader"><i></i><span>Game</span></button>');
    slot.appendChild(pill);
    pill.addEventListener('click', () => openSetup());
    desk.on('info', (i) => {
      info = i;
      paint();
    });
    desk.on('game', (s) => {
      last = s;
      paint();
    });
    refresh();
    setInterval(() => {
      if (last && last.fresh) last.fresh = false;
    }, 4000);
  }

  function openSetup() {
    return new Promise((resolve) => {
      const body = html('<div class="setup"></div>');
      const draw = () => {
        const i = info || {};
        body.innerHTML = `<ol class="setup-steps">
          <li class="${i.gameDir ? 'done' : 'now'}"><div><b>Find Hyperballin</b><p>${i.gameDir ? esc(i.gameDir) : 'Builderballin looks in Downloads, Desktop, Documents and itch first.'}</p></div><div class="setup-acts">${i.gameDir ? '<button class="btn small ghost" data-s="pick">Change</button>' : '<button class="btn small primary" data-s="detect">Find it</button><button class="btn small ghost" data-s="pick">Browse</button>'}</div></li>
          <li class="${i.ready ? 'done' : i.gameDir ? 'now' : ''}"><div><b>Install the map loader</b><p>${i.ready ? `Installed. Loader version ${i.mod}.` : 'Puts UE4SS and the map loader into the game folder. You only do this once, and it is the same loader Hyperboi uses.'}</p><div class="setup-bar" hidden><i></i><span></span></div></div><div class="setup-acts">${i.gameDir && !i.ready ? '<button class="btn small primary" data-s="install">Install</button>' : i.ready ? '<button class="btn small ghost" data-s="install">Reinstall</button>' : ''}</div></li>
          <li class="${i.ready ? 'now' : ''}"><div><b>Play</b><p>Press Play in game in the editor. If the game is closed it opens, and your map loads right after the main menu with a loading screen. Big maps take a moment.</p></div></li>
        </ol>
        <details class="setup-log"><summary>What the game says</summary><pre>Open this after you play a map.</pre></details>`;
        body.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => act(b.dataset.s, b)));
        const lg = body.querySelector('.setup-log');
        lg.addEventListener('toggle', async () => {
          if (lg.open) lg.querySelector('pre').textContent = await desk.game.log().catch((e) => e.message);
        });
      };
      const act = async (what, btn) => {
        try {
          if (what === 'detect') {
            try {
              info = await desk.game.detect();
            } catch {
              info = await desk.game.pick();
            }
          } else if (what === 'pick') info = await desk.game.pick();
          else if (what === 'install') {
            btn.disabled = true;
            const bar = body.querySelector('.setup-bar');
            bar.hidden = false;
            const off = desk.on('install', (d) => {
              bar.querySelector('i').style.width = `${Math.round(d.p * 100)}%`;
              bar.querySelector('span').textContent = d.msg;
            });
            try {
              info = await desk.game.install();
              toast('Loader installed');
            } finally {
              off();
            }
          }
        } catch (e) {
          toast(e.message, true);
        }
        paint();
        draw();
      };
      refresh().then(draw);
      modal({ title: 'Set up the game', body, foot: '<button class="btn primary" data-close>Done</button>', onClose: () => resolve(info) });
    });
  }

  async function play() {
    const i = await refresh();
    if (!i || !i.ready) {
      const after = await openSetup();
      if (!after || !after.ready) return;
    }
    const issues = ui.validate(ui.state.map).filter((x) => x.level === 'bad');
    if (issues.length) toast(issues[0].text + ' Playing anyway.', true);
    try {
      const r = await desk.game.play(ui.exportMap(ui.state.map), ui.state.map.meta.name);
      toast(r.launched ? 'Opening Hyperballin. Your map loads after the main menu.' : 'Sent to the game. Loading it now.');
      last = { fresh: true, map_status: 'waiting', map_name: ui.state.map.meta.name };
      paint();
    } catch (e) {
      toast(e.message, true);
    }
  }

  return { mount, play, openSetup, refresh };
}
