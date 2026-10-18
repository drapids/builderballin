const LAG_FACES = 150000;
const HEAVY_FACES = 600000;

const MC_SITES = [
  { name: 'Planet Minecraft', url: (q) => `https://www.planetminecraft.com/projects/?keywords=${encodeURIComponent(q || 'house')}&share=schematic&order=order_popularity`, signup: false, note: 'Biggest pile of builds. Open one, hit Download Schematic.' },
  { name: 'Minecraft Schematics', url: (q) => `https://www.minecraft-schematics.com/search/?q=${encodeURIComponent(q || 'house')}`, signup: true, note: 'Lots of houses and castles. You need an account to download.' }
];

async function webSketchfab(q, cursor) {
  const u = new URL('https://api.sketchfab.com/v3/search');
  u.searchParams.set('type', 'models');
  u.searchParams.set('downloadable', 'true');
  u.searchParams.set('count', '24');
  u.searchParams.set('sort_by', '-likeCount');
  if (q) u.searchParams.set('q', q);
  if (cursor) u.searchParams.set('cursor', cursor);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Sketchfab said ${r.status}`);
  const d = await r.json();
  return {
    items: (d.results || [])
      .filter((m) => m.isDownloadable !== false && !(m.price > 0))
      .map((m) => {
        const imgs = ((m.thumbnails && m.thumbnails.images) || []).filter((i) => i.width >= 200).sort((a, b) => a.width - b.width);
        const glb = m.archives && m.archives.glb;
        return { source: 'sketchfab', id: m.uid, name: m.name, by: (m.user && (m.user.displayName || m.user.username)) || '', thumb: imgs[0] ? imgs[0].url : '', page: m.viewerUrl, license: (m.license && (m.license.label || m.license)) || '', faces: (glb && glb.faceCount) || m.faceCount || 0, size: (glb && glb.size) || 0, signup: true, free: true };
      }),
    next: d.cursors && d.cursors.next
  };
}

let polyAll = null;
async function webPolyHaven(q) {
  if (!polyAll) {
    const r = await fetch('https://api.polyhaven.com/assets?type=models');
    if (!r.ok) throw new Error(`Poly Haven said ${r.status}`);
    polyAll = Object.entries(await r.json()).map(([id, a]) => ({ id, name: a.name || id, tags: [...(a.tags || []), ...(a.categories || [])].map(String), downloads: a.download_count || 0, polycount: a.polycount || 0 }));
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    items: polyAll
      .filter((a) => !words.length || words.every((w) => a.name.toLowerCase().includes(w) || a.tags.some((t) => t.toLowerCase().includes(w))))
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 24)
      .map((a) => ({ source: 'polyhaven', id: a.id, name: a.name, by: 'Poly Haven', thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${a.id}.png?width=320&height=240`, page: `https://polyhaven.com/a/${a.id}`, license: 'CC0', faces: a.polycount, signup: false, free: true })),
    next: null
  };
}

async function webPolyFiles(id) {
  const r = await fetch(`https://api.polyhaven.com/files/${id}`);
  const files = await r.json();
  const g = files.gltf || {};
  const res = g['1k'] || g['2k'] || Object.values(g)[0];
  if (!res || !res.gltf) throw new Error('No glTF version of that one.');
  const list = [{ url: res.gltf.url, name: res.gltf.url.split('/').pop() }, ...Object.entries(res.gltf.include || {}).map(([rel, f]) => ({ url: f.url, name: rel.split('/').pop() }))];
  const out = [];
  for (const f of list) {
    const rr = await fetch(f.url);
    out.push(new File([await rr.arrayBuffer()], f.name));
  }
  return out;
}

function sizeText(b) {
  if (!b) return '';
  return b > 1e6 ? `${(b / 1e6).toFixed(b > 1e7 ? 0 : 1)} MB` : `${Math.round(b / 1e3)} KB`;
}

export function openSearch(ui, startQuery = '') {
  const { modal, html, esc, toast, importFiles, desk, animate, SPRINGS } = ui;
  const state = { q: startQuery, source: 'all', hideSignup: false, hideLag: false, items: [], next: null, busy: false, token: false };
  const body = html(`<div class="find">
    <form class="find-bar"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input name="q" placeholder="Search for a house, a car, de_dust2, a castle" autocomplete="off" spellcheck="false"><button class="btn primary small" type="submit">Search</button></form>
    <div class="find-row">
      <div class="chips find-src"></div>
      <span class="find-gap"></span>
      <label class="mini-toggle"><input type="checkbox" data-f="hideSignup"> Hide sign up required</label>
      <label class="mini-toggle"><input type="checkbox" data-f="hideLag"> Hide could lag</label>
    </div>
    <div class="find-note"></div>
    <div class="find-grid"></div>
    <div class="find-more"></div>
    ${desk ? '<details class="find-token"><summary>One click Sketchfab imports</summary><p>Sketchfab makes you sign in to download. Paste your API token from sketchfab.com/settings/password and Builderballin grabs models for you instead.</p><form class="find-token-form"><input class="field" name="t" placeholder="API token" autocomplete="off" spellcheck="false"><button class="btn small line" type="submit">Save</button></form></details>' : ''}
  </div>`);
  const grid = body.querySelector('.find-grid');
  const note = body.querySelector('.find-note');
  const more = body.querySelector('.find-more');
  const input = body.querySelector('input[name=q]');
  input.value = state.q;
  const sources = [
    ['all', 'Everything'],
    ['sketchfab', 'Sketchfab'],
    ['polyhaven', 'Poly Haven'],
    ['minecraft', 'Minecraft builds']
  ];
  const srcBox = body.querySelector('.find-src');
  srcBox.innerHTML = sources.map(([v, l]) => `<button type="button" class="chip ${v === state.source ? 'on' : ''}" data-v="${v}">${l}</button>`).join('');
  srcBox.querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      state.source = b.dataset.v;
      srcBox.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
      run();
    })
  );
  body.querySelectorAll('[data-f]').forEach((c) =>
    c.addEventListener('change', () => {
      state[c.dataset.f] = c.checked;
      render();
    })
  );
  const tokenForm = body.querySelector('.find-token-form');
  if (tokenForm)
    tokenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const inf = await desk.search.token(tokenForm.t.value);
        state.token = !!inf.sketchfab;
        toast(state.token ? 'Saved. Sketchfab imports are one click now.' : 'Token cleared');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  body.querySelector('.find-bar').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = input.value.trim();
    run();
  });

  const tagsFor = (it) => {
    const t = ['<span class="tag free">Free</span>'];
    if (it.signup) t.push('<span class="tag signup">Sign up required</span>');
    if (it.faces > HEAVY_FACES) t.push('<span class="tag lag">Will lag</span>');
    else if (it.faces > LAG_FACES) t.push('<span class="tag lag">Could lag</span>');
    return t.join('');
  };

  const card = (it) => {
    const facts = [it.by, it.license, it.faces ? `${it.faces >= 1000 ? Math.round(it.faces / 1000) + 'k' : it.faces} faces` : '', sizeText(it.size)].filter(Boolean).join(' · ');
    return `<article class="find-card" data-src="${it.source}" data-id="${esc(it.id)}">
      <div class="find-thumb">${it.thumb ? `<img loading="lazy" alt="" src="${esc(it.thumb)}">` : ''}<div class="find-tags">${tagsFor(it)}</div></div>
      <div class="find-meta"><b title="${esc(it.name)}">${esc(it.name)}</b><span>${esc(facts)}</span></div>
      <div class="find-acts"><button class="btn small primary" data-act="get">${it.signup && !(it.source === 'sketchfab' && state.token) ? 'Open and download' : 'Import'}</button><button class="btn small ghost" data-act="page">Page</button></div>
    </article>`;
  };

  const minecraftView = () => {
    grid.innerHTML = MC_SITES.map(
      (s, i) => `<article class="find-site"><div><b>${esc(s.name)}</b><p>${esc(s.note)}</p><div class="find-tags inline">${s.signup ? '<span class="tag signup">Sign up required</span>' : '<span class="tag free">Free</span>'}</div></div><button class="btn small primary" data-site="${i}">${desk ? 'Browse here' : 'Open site'}</button></article>`
    ).join('');
    note.textContent = desk ? 'Browse in the window that opens. Anything you download there (.schem, .schematic, .litematic, .nbt or a zip) comes straight into the importer.' : 'Download a .schem, .schematic, .litematic or .nbt file, then drop it onto the map.';
    more.innerHTML = '';
    grid.querySelectorAll('[data-site]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = MC_SITES[+b.dataset.site];
        const url = s.url(state.q);
        if (desk) desk.web(url);
        else window.open(url, '_blank', 'noopener');
      })
    );
  };

  const render = () => {
    if (state.source === 'minecraft') return minecraftView();
    const list = state.items.filter((it) => !(state.hideSignup && it.signup && !(it.source === 'sketchfab' && state.token)) && !(state.hideLag && it.faces > LAG_FACES));
    if (state.busy && !state.items.length) {
      grid.innerHTML = Array.from({ length: 8 }, () => '<div class="find-card ghost"></div>').join('');
      note.textContent = 'Looking';
      return;
    }
    if (!list.length) {
      grid.innerHTML = `<p class="find-empty">${state.items.length ? 'Everything here got filtered out. Loosen the filters above.' : state.q ? `Nothing came up for "${esc(state.q)}".` : 'Search for anything. Houses, cars, trees, whole maps.'}</p>`;
      more.innerHTML = '';
      return;
    }
    const hidden = state.items.length - list.length;
    note.textContent = `${list.length} free result${list.length === 1 ? '' : 's'}${hidden ? `, ${hidden} hidden by filters` : ''}. Paid models are never shown.${!state.token && list.some((x) => x.source === 'sketchfab') ? ' Sketchfab needs a free account to download.' : ''}`;
    grid.innerHTML = list.map(card).join('');
    grid.querySelectorAll('.find-card').forEach((el, i) => {
      if (animate) animate(el, { opacity: [0, 1], transform: ['translateY(8px)', 'none'] }, { spring: SPRINGS.gentle, delay: Math.min(i, 12) * 18 });
      const it = list[i];
      el.querySelector('[data-act=page]').addEventListener('click', () => (desk ? desk.web(it.page) : window.open(it.page, '_blank', 'noopener')));
      el.querySelector('[data-act=get]').addEventListener('click', () => grab(it, el));
    });
    more.innerHTML = state.next ? '<button class="btn line">Show more</button>' : '';
    if (state.next) more.querySelector('button').addEventListener('click', () => run(true));
  };

  const grab = async (it, el) => {
    const btn = el.querySelector('[data-act=get]');
    if (it.source === 'sketchfab' && !state.token) {
      if (desk) {
        desk.web(it.page);
        toast('Sign in on Sketchfab, then press Download and pick glTF or GLB. It comes right back here.');
      } else window.open(it.page, '_blank', 'noopener');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Getting it';
    try {
      let files;
      if (desk) files = (await desk.search.get(it.source, it.id)).map((f) => new File([f.data], f.name));
      else files = await webPolyFiles(it.id);
      ui.close();
      importFiles(files, it.name);
    } catch (e) {
      toast(e.message || "Couldn't get that one.", true);
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  };

  const find = async (source, cursor) => {
    if (desk) return desk.search.find(source, state.q, cursor);
    return source === 'polyhaven' ? webPolyHaven(state.q) : webSketchfab(state.q, cursor);
  };

  let ticket = 0;
  const run = async (append = false) => {
    if (state.source === 'minecraft') return render();
    const my = ++ticket;
    state.busy = true;
    if (!append) {
      state.items = [];
      state.next = null;
    }
    render();
    try {
      if (state.source === 'all' && !append) {
        const [a, b] = await Promise.allSettled([find('sketchfab'), find('polyhaven')]);
        if (my !== ticket) return;
        const sk = a.status === 'fulfilled' ? a.value : { items: [], next: null };
        const ph = b.status === 'fulfilled' ? b.value : { items: [] };
        const mixed = [];
        for (let i = 0; i < Math.max(sk.items.length, ph.items.length); i++) {
          if (ph.items[i]) mixed.push(ph.items[i]);
          if (sk.items[i]) mixed.push(sk.items[i]);
        }
        state.items = mixed;
        state.next = sk.next;
        if (a.status === 'rejected' && b.status === 'rejected') throw a.reason;
      } else {
        const src = state.source === 'all' ? 'sketchfab' : state.source;
        const r = await find(src, append ? state.next : null);
        if (my !== ticket) return;
        state.items = append ? state.items.concat(r.items) : r.items;
        state.next = r.next;
      }
    } catch (e) {
      if (my !== ticket) return;
      note.textContent = `${e.message || 'Search failed'}. Check your internet and try again.`;
    }
    state.busy = false;
    render();
  };

  const m = modal({
    title: 'Find something to import',
    body,
    wide: true,
    onMount: async (el) => {
      el.classList.add('find-modal');
      if (desk) {
        try {
          const inf = await desk.info();
          state.token = !!inf.sketchfab;
        } catch {}
      }
      run();
    }
  });
  ui.close = m.close;
  return m;
}
