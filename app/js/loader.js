(() => {
  const root = document.getElementById('loader');
  const cv = document.getElementById('loaderCanvas');
  if (!root || !cv) return;
  const W = cv.width;
  const H = cv.height;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  const bar = document.getElementById('loaderBar');
  const hexc = (h) => {
    const n = parseInt(h.slice(1), 16);
    return (255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255);
  };
  const C = Object.fromEntries(
    Object.entries({
      bg: '#14132a', bg2: '#1b1934', floor: '#221f3d', floor2: '#2d2a4c', line: '#403b68',
      anvil: '#2d2a4c', anvilHi: '#4b4578', anvilLo: '#16142a', anvilEdge: '#0f0e1f',
      g1: '#e6fbff', g2: '#8fdcff', g3: '#5fc8ff', g4: '#2a7cff', g5: '#1b4fd6', eye: '#0b1233',
      wood: '#a8703f', woodLo: '#6b4424', steel: '#c9c4ee', steelLo: '#78739f',
      m0: '#78739f', m1: '#ff8165', m2: '#ffb4a3', m3: '#2d2c1d', mHi: '#fff1ec',
      s1: '#fff600', s2: '#ffffff', s3: '#ffb21a', glow: '#ff8165'
    }).map(([k, v]) => [k, hexc(v)])
  );
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const dith = (x, y, t) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < t;
  const put = (x, y, c) => {
    x |= 0;
    y |= 0;
    if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = c;
  };
  const rect = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c);
  };
  const poly = (pts, c, shade) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
    for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) put(x, y, shade ? shade(x, y) : c);
    }
  };
  const disc = (cx, cy, r, fn) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) fn(cx + x, cy + y, x, y);
  };
  const line = (x0, y0, x1, y1, c, w = 1) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      rect(Math.round(x0 + (x1 - x0) * t - (w - 1) / 2), Math.round(y0 + (y1 - y0) * t - (w - 1) / 2), w, w, c);
    }
  };

  const GROUND = 98;
  const ANVIL_X = 112;
  const MARBLE = { x: 114, y: 63, r: 6 };
  const PIVOT = { x: 74, y: 62 };
  const UP = -2.55;
  const DOWN = -0.12;
  const CYCLE = 0.86;
  let hits = 0;
  let sparks = [];
  let shake = 0;
  let flash = 0;
  let squash = 0;
  let lastPhase = 0;
  let done = null;
  let finishing = 0;
  let born = performance.now();
  let progress = 0;

  const ease = (t) => t * t * (3 - 2 * t);
  const swing = (ph) => {
    if (ph < 0.42) return DOWN + (UP - DOWN) * ease(ph / 0.42);
    if (ph < 0.6) return UP + Math.sin(((ph - 0.42) / 0.18) * Math.PI) * -0.08;
    if (ph < 0.7) {
      const t = (ph - 0.6) / 0.1;
      return UP + (DOWN - UP) * t * t;
    }
    if (ph < 0.8) return DOWN - Math.sin(((ph - 0.7) / 0.1) * Math.PI) * 0.22;
    return DOWN;
  };

  const strike = (big) => {
    hits++;
    shake = big ? 3 : 1.6;
    flash = big ? 6 : 2;
    squash = 1;
    const n = big ? 34 : 14;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.08 + Math.random() * 0.84);
      const v = (big ? 70 : 42) + Math.random() * (big ? 90 : 60);
      sparks.push({ x: MARBLE.x - 2, y: MARBLE.y - MARBLE.r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * (big ? 0.6 : 0.35), c: [C.s1, C.s2, C.s3][i % 3] });
    }
  };

  const bg = () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let c;
        if (y >= GROUND) {
          const edge = Math.min(x, W - 1 - x) / 46;
          const depth = 1 - (y - GROUND) / (H - GROUND);
          const keep = Math.min(1, edge) * (0.35 + depth * 0.65);
          c = !dith(x, y, keep) ? C.bg : dith(x + 2, y + 1, (y - GROUND) / (H - GROUND)) ? C.floor2 : C.floor;
        }
        else {
          const dx = (x - ANVIL_X) / W;
          const dy = (y - 60) / H;
          const r = Math.sqrt(dx * dx * 1.4 + dy * dy * 2.2);
          c = dith(x, y, 1 - r * 2.1) ? C.bg2 : C.bg;
        }
        px[y * W + x] = c;
      }
    }
    for (let x = 0; x < W; x++) if (dith(x, GROUND, Math.min(1, Math.min(x, W - 1 - x) / 40))) put(x, GROUND, C.line);
  };

  const glowAt = (cx, cy, rad, strength) => {
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++) {
        const d = Math.sqrt(x * x + y * y) / rad;
        if (d <= 1 && dith(cx + x, cy + y, (1 - d) * strength)) put(cx + x, cy + y, C.glow);
      }
  };

  const anvil = () => {
    const x = ANVIL_X;
    const shadeTop = (px2, py2) => (py2 < 71 ? C.anvilHi : dith(px2, py2, 0.5) ? C.anvil : C.anvilHi);
    poly([[x - 30, 70], [x - 20, 70], [x - 20, 75], [x - 26, 74]], C.anvil);
    poly([[x - 20, 69], [x + 16, 69], [x + 16, 76], [x - 20, 76]], 0, shadeTop);
    poly([[x - 9, 76], [x + 7, 76], [x + 5, 86], [x - 7, 86]], C.anvilLo);
    poly([[x - 15, 86], [x + 13, 86], [x + 16, 97], [x - 18, 97]], C.anvil);
    for (let i = x - 18; i < x + 16; i++) put(i, 97, C.anvilEdge);
    for (let i = x - 20; i < x + 16; i++) put(i, 76, C.anvilEdge);
  };

  const marble = (form) => {
    const { x, y, r } = MARBLE;
    disc(x, y, r, (px2, py2, dx, dy) => {
      let c;
      if (flash > 0) c = C.s2;
      else {
        const ring = Math.sqrt(dx * dx * 1 + (dy * 1.5) ** 2);
        const band = Math.floor(ring * 1.4) % 3;
        const formed = dith(px2, py2, form);
        c = formed ? (band === 0 ? C.m3 : band === 1 ? C.m1 : C.m2) : C.m0;
        if (dx < -2 && dy < -2) c = formed ? C.mHi : C.steel;
        if (dx + dy > 5 && formed) c = C.m3;
      }
      put(px2, py2, c);
    });
  };

  const guy = (t, ang) => {
    const bob = Math.round(Math.sin(t * 5.2) * 0.6);
    const sq = squash > 0 ? Math.round(squash * 2) : 0;
    const cx = 64;
    const top = 50 + bob + sq;
    const mid = 68 + bob;
    const bot = 86;
    const hw = 12 + (sq ? 1 : 0);
    line(cx - 4, bot - 1, cx - 5, GROUND - 1, C.g5, 2);
    line(cx + 4, bot - 1, cx + 5, GROUND - 1, C.g5, 2);
    rect(cx - 8, GROUND - 1, 5, 1, C.eye);
    rect(cx + 4, GROUND - 1, 5, 1, C.eye);
    poly([[cx, top], [cx + hw, mid], [cx, bot], [cx - hw, mid]], 0, (x, y) => {
      const left = x < cx;
      const upper = y < mid;
      if (upper) return left ? (dith(x, y, (mid - y) / (mid - top)) ? C.g1 : C.g2) : C.g3;
      return left ? C.g4 : dith(x, y, (y - mid) / (bot - mid)) ? C.g5 : C.g4;
    });
    poly([[cx - 4, top + 7], [cx + 4, top + 7], [cx, top + 1]], C.g1);
    rect(cx - 1, mid - 1, 3, 1, C.g2);
    const blink = Math.sin(t * 1.7) > 0.985;
    rect(cx + 1, mid - 6, 2, blink ? 1 : 3, C.eye);
    rect(cx + 6, mid - 6, 2, blink ? 1 : 3, C.eye);
    line(cx - 9, mid + 2, cx - 13, mid + 7, C.g4, 2);
    const hx = PIVOT.x + Math.cos(ang) * 9;
    const hy = PIVOT.y + bob + Math.sin(ang) * 9;
    line(cx + 7, mid - 2, hx, hy, C.g4, 2);
    const ex = PIVOT.x + Math.cos(ang) * 37;
    const ey = PIVOT.y + bob + Math.sin(ang) * 37;
    line(hx, hy, ex, ey, C.wood, 2);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const fx = Math.cos(ang);
    const fy = Math.sin(ang);
    const head = [
      [ex - nx * 5 - fx * 2, ey - ny * 5 - fy * 2],
      [ex + nx * 5 - fx * 2, ey + ny * 5 - fy * 2],
      [ex + nx * 5 + fx * 4, ey + ny * 5 + fy * 4],
      [ex - nx * 5 + fx * 4, ey - ny * 5 + fy * 4]
    ];
    poly(head, 0, (x, y) => (((x - ex) * nx + (y - ey) * ny) < 0 ? C.steel : C.steelLo));
  };

  const drawSparks = (dt) => {
    sparks = sparks.filter((s) => (s.life -= dt) > 0);
    for (const s of sparks) {
      s.vy += 260 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y > GROUND - 1) {
        s.y = GROUND - 1;
        s.vy *= -0.35;
        s.vx *= 0.6;
      }
      put(s.x, s.y, s.c);
      if (s.life > 0.25) put(s.x - s.vx * 0.012, s.y - s.vy * 0.012, C.s3);
    }
  };

  let prev = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    const t = (now - born) / 1000;
    const ph = (t % CYCLE) / CYCLE;
    if (lastPhase < 0.7 && ph >= 0.7) strike(!!done && hits >= 1);
    lastPhase = ph;
    const form = Math.min(1, hits / 4);
    progress += ((done ? 1 : Math.min(0.9, 0.18 + hits * 0.17)) - progress) * Math.min(1, dt * 6);
    if (bar) bar.style.transform = `scaleX(${progress.toFixed(3)})`;
    shake = Math.max(0, shake - dt * 14);
    flash = Math.max(0, flash - 1);
    squash = Math.max(0, squash - dt * 7);
    bg();
    if (hits) glowAt(MARBLE.x, MARBLE.y, 10 + Math.round(form * 4), 0.16 + form * 0.18 + (flash ? 0.35 : 0));
    anvil();
    marble(done && hits >= 2 ? 1 : form);
    guy(t, swing(ph));
    drawSparks(dt);
    const sx = shake ? Math.round((Math.random() - 0.5) * shake) : 0;
    const sy = shake ? Math.round((Math.random() - 0.5) * shake) : 0;
    g.putImageData(img, sx, sy);
    if (done && !finishing && hits >= 2 && ph > 0.82 && now - born > 1500) {
      finishing = now;
      root.classList.add('out');
      setTimeout(() => {
        root.remove();
        done();
      }, 420);
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.__loaderDone = (cb) => {
    done = cb || (() => {});
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.remove();
      done();
    }
  };
})();
