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

  const G = window.HB_GUY;
  const zbuf = new Float32Array(W * H);
  const mask = new Uint8Array(W * H);
  const RAMP = [C.g5, C.g4, C.g3, C.g2, C.g1];
  const SCALE = 0.27;
  const FEET = { x: 72, y: GROUND - 1 };
  const YAW = -0.38;
  const cy = Math.cos(YAW);
  const sy = Math.sin(YAW);
  const LIGHT = (() => {
    const v = [0.55, -0.55, 0.62];
    const l = Math.hypot(v[0], v[1], v[2]);
    return v.map((k) => k / l);
  })();
  let posed = G ? new Float32Array(G.count * 3) : null;
  let proj = G ? new Float32Array(G.count * 3) : null;
  const project = (x, y, z, out, o) => {
    const rx = x * cy - y * sy;
    const ry = x * sy + y * cy;
    out[o] = FEET.x + ry * SCALE;
    out[o + 1] = FEET.y - z * SCALE;
    out[o + 2] = -rx;
  };
  const tmp = new Float32Array(3);
  const toScreen = (p) => {
    project(p[0], p[1], p[2], tmp, 0);
    return [tmp[0], tmp[1]];
  };
  const raster = (pose) => {
    G.pose(pose, posed);
    for (let v = 0; v < G.count; v++) project(posed[v * 3], posed[v * 3 + 1], posed[v * 3 + 2], proj, v * 3);
    zbuf.fill(Infinity);
    mask.fill(0);
    const idx = G.index;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      const ux = posed[b] - posed[a], uy = posed[b + 1] - posed[a + 1], uz = posed[b + 2] - posed[a + 2];
      const vx = posed[c] - posed[a], vy = posed[c + 1] - posed[a + 1], vz = posed[c + 2] - posed[a + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const cx2 = nx * cy - ny * sy;
      if (cx2 < -0.05) continue;
      const lit = Math.max(0, cx2 * LIGHT[0] + (nx * sy + ny * cy) * LIGHT[1] + nz * LIGHT[2]);
      const shade = Math.min(0.999, 0.04 + lit * 0.9);
      const x0 = proj[a], y0 = proj[a + 1], z0 = proj[a + 2];
      const x1 = proj[b], y1 = proj[b + 1], z1 = proj[b + 2];
      const x2 = proj[c], y2 = proj[c + 1], z2 = proj[c + 2];
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-6) continue;
      const minx = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const miny = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let py = miny; py <= maxy; py++)
        for (let px2 = minx; px2 <= maxx; px2++) {
          const qx = px2 + 0.5;
          const qy = py + 0.5;
          const w0 = ((x1 - qx) * (y2 - qy) - (x2 - qx) * (y1 - qy)) / area;
          const w1 = ((x2 - qx) * (y0 - qy) - (x0 - qx) * (y2 - qy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * z0 + w1 * z1 + w2 * z2;
          const k = py * W + px2;
          if (z >= zbuf[k]) continue;
          zbuf[k] = z;
          mask[k] = 1;
          const lv = shade * 4;
          const lo = Math.floor(lv);
          px[k] = dith(px2, py, lv - lo) ? RAMP[Math.min(4, lo + 1)] : RAMP[lo];
        }
    }
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (mask[k]) continue;
        if (mask[k - 1] || mask[k + 1] || mask[k - W] || mask[k + W]) px[k] = C.eye;
      }
  };

  const guy = (t, ang) => {
    if (!G) return;
    const sq = squash > 0 ? squash : 0;
    const breathe = Math.sin(t * 5.2) * 0.5 + 0.5;
    const pose = {
      lDown: 1.25,
      rDown: 1.18,
      lElbow: 0.35 + breathe * 0.08,
      rElbow: 0.25,
      lSwing: 0.15 - sq * 0.1,
      rSwing: Math.PI / 2 - ang - 0.25,
      lHip: -0.22,
      rHip: 0.26,
      lKnee: 0.22 + sq * 0.25,
      rKnee: 0.12 + sq * 0.2,
      lean: 0.06 + (ang > -0.6 ? 0.08 : -0.03) + sq * 0.06,
      lift: -sq * 5 - breathe * 1.2
    };
    raster(pose);
    const hand = toScreen(G.hand(pose, 1));
    const sh = toScreen([18, 0, 150 + pose.lift]);
    let dx = hand[0] - sh[0];
    let dy = hand[1] - sh[1];
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const ex = hand[0] + dx * 24;
    const ey = hand[1] + dy * 24;
    line(hand[0] - dx * 3, hand[1] - dy * 3, ex, ey, C.wood, 2);
    rect(Math.round(hand[0]) - 1, Math.round(hand[1]) - 1, 3, 3, C.g2);
    const nx = -dy;
    const ny = dx;
    const head = [
      [ex - nx * 5 - dx * 2, ey - ny * 5 - dy * 2],
      [ex + nx * 5 - dx * 2, ey + ny * 5 - dy * 2],
      [ex + nx * 5 + dx * 4, ey + ny * 5 + dy * 4],
      [ex - nx * 5 + dx * 4, ey - ny * 5 + dy * 4]
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
