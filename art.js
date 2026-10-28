/* Exodus art: the pixel world behind the board. Vanilla JS, no dependencies (Motion is used when present, never required).
 *
 * Everything is drawn procedurally at a low resolution (one art pixel = 3-4 CSS px, scaled with image-rendering: pixelated):
 *   sky      ImageData, ordered (Bayer) dithering between gradient bands. Night: a Starry Night sky of short brush strokes along
 *            a flow field (wind band, a double spiral, curls round haloed stars and a crescent moon). Dusk: a lit cumulus tower over a burning horizon. Day: cumulus clouds and a sun.
 *   far      two ranges of Alps with snow caps, lit from the side of the sun or moon.
 *   city     a European waterfront: canal houses with bell and step gables, copper domes, clock towers, trees on the quay,
 *            one building per application (the skyline grows with every application), mirrored in the canal.
 *   fx       canvas particles: fireflies, falling petals, birds, water glints, a rare meteor (30 fps, paused off-screen).
 *   bats     CSS box-shadow sprites flapping with steps().
 *   globe    the planet: an orthographic Earth from a hand-made coastline set, destinations lit, a flight arc per country,
 *            a plane that lands on every offer.
 * Day/dusk/night follows the viewer's local clock (?phase=day|dusk|night overrides it for previews).
 * prefers-reduced-motion: the scene is drawn once; no parallax, particles, bats or bursts.
 */
'use strict';
(() => {
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
  const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sm = t => t * t * (3 - 2 * t);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * sm(fx) + (c - a) * sm(fy) + (a - b - c + d) * sm(fx) * sm(fy); };
  const fbm = (x, y) => noise(x, y) * .55 + noise(x * 2.1 + 7, y * 2.1 + 3) * .3 + noise(x * 4.3 + 11, y * 4.3 + 5) * .15;

  function phase() {
    const q = (location.search.match(/[?&]phase=(day|dusk|night)/) || [])[1];
    if (q) return q;
    const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    if (h >= 7 && h < 17) return 'day';
    if ((h >= 17 && h < 20.5) || (h >= 5 && h < 7)) return 'dusk';
    return 'night';
  }

  const PAL = {
    night: { sky: ['#070d24', '#0c1a45', '#13275e', '#1c3a7a', '#29508f'], swirl: ['#2f5fb3', '#5b8fe0', '#a9c8ff', '#f1e6a6'],
      far: ['#1a2a55', '#22356a', '#2c4480'], snow: ['#9fb6e8', '#c9d8ff'], near: ['#101a3c', '#16234d'], water: '#0a1430',
      bricks: ['#4a2a3a', '#3a2d4f', '#2f3a5a', '#523a3a', '#3d4a4a'], roof: '#1b1530', win: '#ffd36b', winOff: '#1a1830', tree: '#10301f', copper: '#2d6a62', quay: '#1d1a33' },
    dusk: { sky: ['#1b1f4a', '#3b2a66', '#7d3c74', '#d0566a', '#f58a4b', '#ffc56b'], cloud: ['#3b2a55', '#7a3b4a', '#c95a2c', '#ff9a3c', '#ffd27a', '#fff1b8'],
      far: ['#4a3060', '#5d3a6e', '#74467a'], snow: ['#f3a7a0', '#ffd9c2'], near: ['#2b1d3f', '#38254d'], water: '#2a1a40',
      bricks: ['#8a3a3a', '#a0573a', '#7a4a5a', '#b5743f', '#5a4a6a'], roof: '#3a2440', win: '#ffd36b', winOff: '#3a2440', tree: '#2a3a2a', copper: '#4f8f7c', quay: '#3b2a3f' },
    day: { sky: ['#2b78b5', '#3f8fc8', '#64aad8', '#93c8e4', '#c9e6ee'], cloud: ['#8fa6c0', '#c6d6e6', '#eef4fa', '#ffffff'],
      far: ['#5f7fa6', '#7393b7', '#89a8c8'], snow: ['#e8f2ff', '#ffffff'], near: ['#4a6a7a', '#5a7a8a'], water: '#2f6f9a',
      bricks: ['#a5423a', '#c46a3c', '#d9b07a', '#3f7a7a', '#e8d6b0', '#8a5a7a'], roof: '#5a3a3a', win: '#2a3d5a', winOff: '#2a3d5a', tree: '#3e7a3a', copper: '#5fae95', quay: '#6b6470' },
  };

  function makeCanvas(cls, w, h) { const c = document.createElement('canvas'); c.className = 'art-layer ' + cls; c.width = w; c.height = h; c.setAttribute('aria-hidden', 'true'); return c; }
  const idle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 16));

  // ------------------------------------------------------------------ sky
  function drawSky(c, ph) {
    const w = c.width, h = c.height, ctx = c.getContext('2d'), img = ctx.createImageData(w, h), px = img.data, P = PAL[ph];
    const stops = P.sky.map(hex), horizon = h * .86;
    const put = (x, y, rgb) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255; };
    // the gradient is quantised into many close shades; Bayer dithering only ever mixes two neighbouring shades (soft bands)
    const LEVELS = 6 * (stops.length - 1);
    const shade = q => { const t = q / LEVELS * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)), f = t - i, a = stops[i], b = stops[i + 1]; return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f)); };
    const shades = Array.from({ length: LEVELS + 1 }, (_, q) => shade(q));
    for (let y = 0; y < h; y++) {
      const t = Math.min(1, y / horizon) * LEVELS, q = Math.min(LEVELS - 1, Math.floor(t)), f = t - q;
      for (let x = 0; x < w; x++) put(x, y, f > bayer(x, y) ? shades[q + 1] : shades[q]);
    }
    const R = rng(strHash(ph) + w);
    if (ph === 'night') {
      // Starry Night: the sky is short brush strokes laid along a flow field (a westerly wind that undulates, one big double
      // spiral, a curl round every star and the moon). Light strokes gather in the spiral, the wind band and the halos; the
      // left side stays dark so the title and the header line read over it.
      const sw = P.swirl.map(hex), deep = P.sky.map(hex), gold = ['#e0a92e', '#f3c94a', '#ffe27a', '#fff3b0'].map(hex);
      const S = Math.min(w, h * 4), sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
      const spirals = [[w * .52, h * .36, S * .12, 1], [w * .64, h * .5, S * .06, -1]];   // cx, cy, radius, turn
      const sr = Math.max(2, S * .011), stars = [[.47, .12, 1], [.6, .16, .8], [.36, .3, .7], [.7, .62, .9], [.93, .1, .8], [.16, .14, .55], [.82, .36, .7], [.28, .55, .5]]
        .map(([fx, fy, k]) => [w * fx, h * fy, sr * k]);
      const moon = [w * .71, h * .16, Math.max(4, S * .026)];
      const curls = stars.map(([x, y, r]) => [x, y, r * 3.2, 1]).concat([[moon[0], moon[1], moon[2] * 2.4, 1]]);
      const band = x => h * .5 + Math.sin(x / w * 9) * h * .07 + Math.sin(x / w * 23 + 1) * h * .025;
      const swirl = (x, y, out) => {   // flow angle + how much light this spot gathers (0..1) + whether it is a gold halo
        let vx = 1, vy = Math.cos(x / w * 9) * .55, glow = Math.exp(-(((y - band(x)) / (h * .07)) ** 2)) * .75, halo = 0;
        for (const [cx, cy, r, d] of spirals.concat(curls)) {
          const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy) || 1, k = Math.exp(-((dist / r) ** 2)) * 3;
          vx += (-dy / dist * d - dx / dist * .28) * k; vy += (dx / dist * d - dy / dist * .28) * k;
          if (d === 1 && r < S * .05) halo = Math.max(halo, 1 - dist / r);   // 1 at the star, 0 at the halo's edge
          else glow = Math.max(glow, Math.exp(-((dist / r) ** 2)) * (.6 + .4 * Math.cos(dist / r * 9 - Math.atan2(dy, dx) * d) ** 2));
        }
        out[0] = Math.atan2(vy, vx); out[1] = glow * (.35 + .65 * sm(w * .2, w * .44, x)); out[2] = halo;
      };
      const f = [0, 0, 0], step = 2;
      for (let gy = 0; gy < horizon * .97; gy += step) for (let gx = -2; gx < w + 2; gx += step) {
        if (R() < .12) continue;
        const x0 = gx + R() * step, y0 = gy + R() * step; swirl(x0, y0, f);
        const v = Math.min(.999, Math.max(0, f[1] + (fbm(x0 * .08, y0 * .08) - .5) * .5 + (R() - .5) * .25));
        const col = f[2] > .55 ? gold[3] : f[2] > .3 ? gold[1 + (R() < .3)] : f[2] > .08 ? (R() < .6 ? sw[2] : gold[0])
          : v > .72 ? sw[R() < .3 ? 3 : 2] : v > .45 ? sw[1] : v > .2 ? sw[0] : deep[2 + Math.floor(R() * 2)];
        if (v <= .2 && f[2] <= .08 && R() < .5) continue;   // the dark sky shows between sparse dark strokes
        const L = 2 + R() * 3, ca = Math.cos(f[0]), sa = Math.sin(f[0]);
        for (let s = -L / 2; s <= L / 2; s += .7) put(Math.round(x0 + ca * s), Math.round(y0 + sa * s), col);
      }
      for (const [cx, cy, r] of stars) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y); if (d <= r) put(Math.round(cx + x), Math.round(cy + y), hex(d < r * .45 ? '#ffffff' : d < r * .8 ? '#fff6c8' : '#ffe27a'));
      }
      const n = Math.round(w * h / 3000);
      for (let i = 0; i < n; i++) put(Math.floor(R() * w), Math.floor(R() * horizon * .8), hex(R() < .5 ? '#fff6c8' : '#c9d8ff'));
      // crescent moon over its gold halo
      const [mx, my, mr] = moon.map(Math.round);
      for (let y = -mr; y <= mr; y++) for (let x = -mr; x <= mr; x++) {
        const r = Math.hypot(x, y), r2 = Math.hypot(x + mr * .5, y + mr * .3);
        if (r <= mr && r2 > mr * .78) put(mx + x, my + y, hex(r < mr * .7 ? '#fff3b0' : '#ffd84a'));
      }
    } else {
      // cumulus: noise blobs lit from the sun side (dusk: a tower lit from below-right; day: soft white clouds)
      const cl = P.cloud.map(hex), clouds = ph === 'dusk' ? [[w * .3, h * .36, w * .22, h * .32, 1]] .concat([[w * .75, h * .18, w * .14, h * .1, .6]])
        : [[w * .2, h * .25, w * .14, h * .12, .8], [w * .62, h * .16, w * .18, h * .1, .7], [w * .9, h * .38, w * .1, h * .07, .6]];
      for (const [cx, cy, rx, ry, k] of clouds) {
        for (let y = Math.floor(cy - ry * 1.3); y < cy + ry * 1.2; y++) for (let x = Math.floor(cx - rx * 1.3); x < cx + rx * 1.3; x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry, fall = 1 - Math.min(1, Math.hypot(dx, dy * (dy < 0 ? .85 : 1.3)));
          const v = fbm(x * .09, y * .09) * .8 + fall * k; if (v < .62) continue;
          const lit = ph === 'dusk' ? (dx * .55 + dy * .6) : (-dy * .7 - dx * .2), shade = (v - .62) * 2.4 + lit * .9 + (bayer(x, y) - .5) * .35;
          const idx = Math.max(0, Math.min(cl.length - 1, Math.floor((shade + .55) * cl.length / 1.6)));
          put(x, y, cl[idx]);
        }
      }
      // sun: at the horizon at dusk, high at day
      const sx = Math.round(w * (ph === 'dusk' ? .8 : .86)), sy = Math.round(h * (ph === 'dusk' ? .66 : .16)), sr = Math.max(5, Math.round(w * (ph === 'dusk' ? .04 : .026)));
      for (let y = -sr * 3; y <= sr * 3; y++) for (let x = -sr * 3; x <= sr * 3; x++) {
        const r = Math.hypot(x, y);
        if (r <= sr && !(ph === 'dusk' && y > 0 && (y % 3 === 0))) put(sx + x, sy + y, hex(r < sr * .6 ? '#fff6c8' : '#ffd25a'));
        else if (r <= sr * 1.7 && bayer(sx + x, sy + y) < .35) put(sx + x, sy + y, hex(ph === 'dusk' ? '#ffb347' : '#fff1a8'));
      }
      if (ph === 'dusk') for (let i = 0; i < 9; i++) { const y = Math.round(h * (.55 + R() * .25)), x0 = Math.floor(R() * w), len = 10 + Math.floor(R() * w * .2); for (let x = x0; x < x0 + len; x++) if (bayer(x, y) < .8) put(x, y, cl[3 + (i % 2)]); }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------------ Alps
  function ridge(w, seed, peaks, hBase, hAmp) {
    const R = rng(seed), P = Array.from({ length: peaks }, (_, i) => [((i + R() * .8) / peaks) * w, hBase + hAmp * (.5 + R() * .5), .7 + R() * .8]);
    return x => { let m = 0; for (const [px, ph, s] of P) m = Math.max(m, ph - Math.abs(x - px) * s); return m + (noise(x * .15, seed) - .5) * 7 + (noise(x * .6, seed + 3) - .5) * 2.5; };
  }
  function drawFar(c, ph) {
    const w = c.width, h = c.height, ctx = c.getContext('2d'), P = PAL[ph], ground = h * .8;
    const lightLeft = ph !== 'dusk';   // dusk: the sun sits right
    const ranges = [[ridge(w, 11, Math.max(5, Math.round(w / 55)), h * .33, h * .17), 0], [ridge(w, 29, Math.max(6, Math.round(w / 40)), h * .2, h * .13), 1]];
    for (const [rf, layer] of ranges) {
      for (let x = 0; x < w; x++) {
        const top = Math.round(ground - rf(x)), slope = rf(x + 1) - rf(x - 1), lit = lightLeft ? slope > 0 : slope < 0;
        for (let y = Math.max(0, top); y < ground; y++) {
          const depth = y - top, snowLine = (ground - top) * (.35 + noise(x * .3, y * .1) * .12);
          let col;
          if (depth < snowLine && ground - top > h * .2) col = P.snow[lit ? 1 : 0];
          else col = P.far[Math.min(2, (lit ? 1 : 0) + layer)];
          if (depth >= snowLine && noise(x * .9, y * .25) > .72) col = P.far[layer === 0 ? 0 : 1];   // rock strata, not a halftone
          ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  // ------------------------------------------------------------------ the city (one building per application) + canal
  function drawCity(c, ph, buildings, far) {
    const w = c.width, h = c.height, ctx = c.getContext('2d'), P = PAL[ph], ground = Math.round(h * .8);
    const lit = ph !== 'day';
    const rect = (x, y, ww, hh, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(ww), Math.round(hh)); };
    const windows = (x, y, ww, hh, seed, step = 3) => {
      const R = rng(seed);
      for (let wy = y + 2; wy < y + hh - 3; wy += step) for (let wx = x + 2; wx < x + ww - 2; wx += 3) rect(wx, wy, 1, 2, lit ? (R() < .55 ? P.win : P.winOff) : P.win);
    };
    function building(x, b, back) {
      const R = rng(strHash(b.id || String(x))), type = b.type || ['gable', 'gable', 'bell', 'block', 'tower', 'dome'][Math.floor(R() * 6)];
      const ww = type === 'tower' ? 6 + Math.floor(R() * 3) : type === 'dome' ? 13 + Math.floor(R() * 4) : 7 + Math.floor(R() * 6);
      const hh = (type === 'tower' ? 26 : type === 'dome' ? 18 : type === 'block' ? 18 : 13) + Math.floor(R() * (type === 'tower' ? 18 : 12));
      const base = back ? ground - 6 : ground, top = base - hh;
      const col = back ? P.near[1] : P.bricks[Math.floor(R() * P.bricks.length)];
      rect(x, top, ww, hh, col);
      if (!back) {
        if (type === 'gable' || type === 'bell') {     // stepped / bell gable of a canal house
          for (let s = 0; s < Math.ceil(ww / 2); s++) { const inset = type === 'gable' ? Math.floor(s / 1) : Math.round(Math.sqrt(s) * 1.6); rect(x + inset, top - s - 1, ww - inset * 2, 1, col); }
          rect(x + Math.floor(ww / 2) - 1, top - Math.ceil(ww / 2) - 1, 2, 1, P.roof);
          windows(x, top, ww, hh - 3, strHash(b.id + 'w'));
          rect(x + Math.floor(ww / 2) - 1, base - 3, 2, 3, P.roof);
        } else if (type === 'block') {
          rect(x - 1, top - 1, ww + 2, 1, P.roof); windows(x, top, ww, hh, strHash(b.id + 'w'));
        } else if (type === 'tower') {                 // clock tower with a spire
          const sp = 8 + Math.floor(R() * 6);
          for (let s = 0; s < sp; s++) { const half = Math.max(0, Math.round((ww / 2) * (1 - s / sp))); rect(x + ww / 2 - half, top - s - 1, half * 2 || 1, 1, P.roof); }
          rect(x + ww / 2 - 1, top - sp - 3, 1, 3, P.roof);
          rect(x + 1, top + 3, ww - 2, ww - 2, lit ? '#fff3c4' : '#f4ead2'); rect(x + ww / 2 - .5, top + 4, 1, (ww - 2) / 2, '#2a2030');
          windows(x, top + ww + 1, ww, hh - ww - 1, strHash(b.id + 'w'), 4);
        } else {                                        // church with a copper dome and lantern
          const r = Math.floor(ww / 2) - 1;
          for (let y = 0; y <= r; y++) { const half = Math.round(Math.sqrt(r * r - y * y)); rect(x + ww / 2 - half, top - y - 1, half * 2, 1, y > r * .6 ? P.copper : (y % 2 ? P.copper : '#3f8a74')); }
          rect(x + ww / 2 - 1, top - r - 4, 2, 3, P.copper); rect(x + ww / 2 - .5, top - r - 6, 1, 2, '#ffd36b');
          windows(x, top + 2, ww, hh - 2, strHash(b.id + 'w'), 4);
        }
        if (b.offer) { rect(x + ww - 1, top - 12, 1, 10, '#e8ebe6'); rect(x + ww, top - 12, 5, 3, '#ffcf4a'); }
        if (b.boss) rect(x + Math.floor(ww / 2), top - 3, 1, 1, '#ff5c5c');
      }
      return ww;
    }
    // back row first: leftover buildings past the width stand behind, darker
    const front = [], backRow = [];
    let used = 4;
    for (const b of buildings) { const est = 12; if (used + est < w - 4) { front.push(b); used += est; } else backRow.push(b); }
    let bx = 6; for (const b of backRow) { bx += building(bx, b, true) + 1; if (bx > w) bx = 10; }
    let x = Math.max(4, Math.round((w - used) / 2));
    const R = rng(7);
    for (const b of front) {
      x += building(x, b, false) + 1;
      if (R() < .35) { const tr = 2 + Math.floor(R() * 2); for (let y = 0; y < tr * 2; y++) rect(x + 1 - (y > 0 && y < tr * 2 - 1 ? 1 : 0), ground - 2 - y, tr + (y > 0 && y < tr * 2 - 1 ? 2 : 0), 1, P.tree); rect(x + 2, ground - 2, 1, 2, P.roof); x += tr + 3; }
    }
    if (!buildings.length) {                          // empty plot: a crane waits for the first application
      const cx = Math.round(w * .5);
      rect(cx, ground - 30, 1, 30, '#ffcf4a'); rect(cx - 10, ground - 30, 26, 1, '#ffcf4a'); rect(cx + 12, ground - 29, 1, 8, '#8f958d'); rect(cx + 11, ground - 21, 3, 2, '#8f958d');
    }
    rect(0, ground, w, 2, P.quay);
    // canal with the reflection of the city and the Alps (rippled rows)
    rect(0, ground + 2, w, h - ground - 2, P.water);
    ctx.save(); ctx.globalAlpha = .42;
    for (let k = 0; ground + 2 + k < h; k++) {
      const src = ground - 1 - k * 1.25; if (src < 0) break;
      const off = Math.round(Math.sin(k * .9) * (1 + k * .05));
      if (far) ctx.drawImage(far, 0, src, w, 1, off, ground + 2 + k, w, 1);
      ctx.drawImage(c, 0, src, w, 1, off, ground + 2 + k, w, 1);
    }
    ctx.restore();
    ctx.fillStyle = P.water; ctx.globalAlpha = .35; ctx.fillRect(0, ground + 2, w, h - ground - 2); ctx.globalAlpha = 1;
    const RR = rng(99); for (let i = 0; i < w / 6; i++) { const y = ground + 4 + Math.floor(RR() * (h - ground - 5)), x0 = Math.floor(RR() * w); rect(x0, y, 2 + Math.floor(RR() * 4), 1, ph === 'day' ? '#9fd3ff' : '#6f8fd6'); }
    return { ground };
  }

  // ------------------------------------------------------------------ particles
  function Particles(c, ph, ground) {
    const ctx = c.getContext('2d'), w = c.width, h = c.height, R = Math.random;
    const flies = ph === 'day' ? [] : Array.from({ length: Math.round(w / 30) }, () => ({ x: R() * w, y: ground - 10 + R() * 22, p: R() * 6.28, s: .2 + R() * .3 }));
    const petals = Array.from({ length: ph === 'night' ? 4 : Math.round(w / 40) }, () => ({ x: R() * w, y: R() * h, vx: .25 + R() * .3, vy: .15 + R() * .2, f: R() * 4 }));
    const birds = ph === 'night' ? [] : Array.from({ length: 4 }, (_, i) => ({ x: w + i * 30 + R() * 60, y: h * (.15 + R() * .25), v: .25 + R() * .15, f: R() * 4 }));
    const glints = Array.from({ length: Math.round(w / 25) }, () => ({ x: R() * w, y: ground + 4 + R() * (h - ground - 6), t: R() * 6 }));
    let meteor = null, t = 0;
    return function frame() {
      t++; ctx.clearRect(0, 0, w, h);
      for (const f of flies) { f.p += .05; f.x += Math.sin(f.p * .7) * f.s; f.y += Math.cos(f.p) * .15; const a = (Math.sin(f.p * 2) + 1) / 2;
        if (a > .3) { ctx.fillStyle = `rgba(214,255,120,${a})`; ctx.fillRect(f.x | 0, f.y | 0, 1, 1); if (a > .8) { ctx.fillStyle = 'rgba(214,255,120,.35)'; ctx.fillRect((f.x | 0) - 1, f.y | 0, 3, 1); ctx.fillRect(f.x | 0, (f.y | 0) - 1, 1, 3); } } }
      for (const p of petals) { p.x += p.vx + Math.sin((t + p.f * 40) * .03) * .2; p.y += p.vy; p.f += .08; if (p.y > h || p.x > w) { p.y = -2; p.x = R() * w * .8; }
        ctx.fillStyle = (Math.floor(p.f) % 2) ? '#ffb7d0' : '#ff8fb8'; ctx.fillRect(p.x | 0, p.y | 0, (Math.floor(p.f) % 2) ? 2 : 1, 1); }
      ctx.fillStyle = ph === 'day' ? '#1b2a3a' : '#2a1a2a';
      for (const b of birds) { b.x -= b.v; b.f += .12; if (b.x < -6) { b.x = w + R() * 80; b.y = h * (.12 + R() * .25); }
        const up = Math.floor(b.f) % 2, x = b.x | 0, y = b.y | 0; ctx.fillRect(x, y, 1, 1); ctx.fillRect(x - 1, y - up, 1, 1); ctx.fillRect(x + 1, y - up, 1, 1); ctx.fillRect(x - 2, y - 1 + up, 1, 1); ctx.fillRect(x + 2, y - 1 + up, 1, 1); }
      for (const g of glints) { g.t += .04; const a = Math.max(0, Math.sin(g.t)); if (a > .5) { ctx.fillStyle = `rgba(255,236,170,${a * .8})`; ctx.fillRect(g.x | 0, g.y | 0, 2, 1); } }
      if (ph === 'night') {
        if (!meteor && R() < .004) meteor = { x: R() * w * .7 + w * .2, y: R() * h * .25, l: 0 };
        if (meteor) { meteor.l++; for (let i = 0; i < 8; i++) { ctx.fillStyle = `rgba(255,250,220,${1 - i / 8})`; ctx.fillRect((meteor.x - meteor.l * 2 + i * 2) | 0, (meteor.y + meteor.l - i) | 0, 1, 1); } if (meteor.l > 30) meteor = null; }
      }
    };
  }

  // ------------------------------------------------------------------ bats (CSS box-shadow sprites, steps())
  const BAT = [['....k...k....', '.k..kk.kk..k.', 'kk.kkkkkkk.kk', 'kkkkkkkkkkkkk', '.kkk.kkk.kkk.', '..k..k.k..k..', '.............'],
    ['.............', '.....k.k.....', '....kkkkk....', '.kkkkkkkkkkk.', 'kkk.kkkkk.kkk', 'k.....k.....k', '.............']];
  let batStyle = false;
  function installBats(host, ph) {
    if (RM || ph === 'day') return;
    if (!batStyle) {
      const u = 3, sh = rows => rows.flatMap((r, y) => [...r].map((ch, x) => ch === 'k' ? `${x * u}px ${y * u}px 0 0 #120c1e` : null)).filter(Boolean).join(',');
      const s = document.createElement('style');
      s.textContent = `@keyframes batflap{0%{box-shadow:${sh(BAT[0])}}50%{box-shadow:${sh(BAT[1])}}}`;
      document.head.appendChild(s); batStyle = true;
    }
    for (let i = 0; i < 3; i++) { const b = document.createElement('span'); b.className = 'bat b' + i; b.setAttribute('aria-hidden', 'true'); b.innerHTML = '<i></i>'; host.appendChild(b); }
  }

  // ------------------------------------------------------------------ scene
  function scene(host, opts = {}) {
    const ph = phase(), rect = host.getBoundingClientRect();
    const W = Math.max(320, rect.width || innerWidth), H = Math.max(200, rect.height || 360), P = W < 700 ? 3 : 4;
    const cw = Math.ceil(W / P), ch = Math.ceil(H / P);
    host.dataset.phase = ph; host.classList.add('ph-' + ph);
    host.querySelectorAll('.art-layer, .bat').forEach(n => n.remove());
    const sky = makeCanvas('sky', cw, ch), far = makeCanvas('far', cw, ch), city = makeCanvas('city', cw, ch), fx = makeCanvas('fx', cw, ch);
    [sky, far, city, fx].filter(Boolean).forEach(c => host.appendChild(c));
    drawSky(sky, ph);
    let ground = Math.round(ch * .8), frame = null, raf = 0, visible = true, last = 0, stopped = false;
    const finish = () => {
      if (stopped) return;
      drawFar(far, ph);
      const r = drawCity(city, ph, opts.buildings || [], far); ground = r.ground;
      if (!RM && opts.particles !== false) {
        frame = Particles(fx, ph, ground);
        const loop = ts => { if (stopped) return; raf = requestAnimationFrame(loop); if (!visible || document.hidden || ts - last < 33) return; last = ts; frame(); };
        raf = requestAnimationFrame(loop);
      }
      installBats(host, ph);
    };
    idle(finish);
    let io = null;
    if ('IntersectionObserver' in window) { io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }); io.observe(host); }
    // parallax: transform only, rAF-throttled, off under reduced motion
    const layers = [[sky, .05], [far, .18], [city, .32], [fx, .32]].filter(l => l[0]);
    let px = 0, sy = 0, ticking = false;
    const apply = () => { ticking = false; for (const [el, f] of layers) el.style.transform = `translate3d(${(px * f * 30).toFixed(1)}px, ${(sy * f).toFixed(1)}px, 0)`; };
    const onScroll = () => { if (!visible) return; sy = Math.min(H, scrollY); if (!ticking) { ticking = true; requestAnimationFrame(apply); } };
    const onMove = e => { px = (e.clientX / innerWidth - .5); if (!ticking) { ticking = true; requestAnimationFrame(apply); } };
    if (!RM && opts.parallax !== false) { addEventListener('scroll', onScroll, { passive: true }); if (matchMedia('(pointer: fine)').matches) addEventListener('pointermove', onMove, { passive: true }); }
    return {
      phase: ph,
      destroy() { stopped = true; cancelAnimationFrame(raf); if (io) io.disconnect(); removeEventListener('scroll', onScroll); removeEventListener('pointermove', onMove); host.querySelectorAll('.art-layer, .bat').forEach(n => n.remove()); },
    };
  }

  // ------------------------------------------------------------------ globe
  // Coastlines: hand-placed [lon, lat] outlines, coarse on purpose (one art pixel is several degrees).
  const LAND = [
    [[-168, 66], [-156, 71], [-130, 70], [-110, 73], [-90, 70], [-80, 63], [-65, 60], [-56, 52], [-66, 45], [-75, 38], [-81, 31], [-80, 25], [-84, 30], [-90, 29], [-97, 26], [-97, 21], [-90, 21], [-87, 15], [-83, 9], [-78, 8], [-80, 7], [-86, 12], [-92, 14], [-105, 20], [-110, 24], [-114, 31], [-118, 34], [-124, 40], [-124, 48], [-130, 55], [-140, 60], [-152, 58], [-165, 55], [-160, 60]],
    [[-55, 60], [-43, 60], [-20, 70], [-18, 77], [-30, 83], [-60, 82], [-70, 77], [-55, 70]],
    [[-78, 8], [-60, 10], [-50, 0], [-35, -5], [-39, -15], [-48, -26], [-58, -35], [-65, -42], [-68, -52], [-73, -50], [-73, -40], [-71, -30], [-70, -18], [-76, -12], [-81, -5], [-80, 0], [-77, 6]],
    [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [5, 53], [8, 55], [10, 57], [12, 56], [11, 54], [14, 54], [20, 55], [24, 58], [22, 60], [22, 65], [18, 63], [17, 60], [11, 58], [6, 58], [5, 62], [12, 66], [18, 70], [28, 71], [40, 68], [33, 66], [40, 64], [45, 68], [60, 70], [60, 55], [50, 46], [40, 47], [38, 45], [30, 46], [28, 41], [26, 40], [24, 38], [22, 37], [20, 40], [19, 42], [16, 45], [13, 45], [12, 44], [16, 41], [18, 40], [16, 38], [12, 38], [15, 40], [10, 44], [7, 44], [3, 43], [3, 42], [0, 39], [-1, 37], [-5, 36]],
    [[-5, 50], [1, 51], [2, 53], [-1, 55], [-2, 57], [-3, 59], [-6, 58], [-5, 55], [-3, 54], [-5, 52]],
    [[-10, 52], [-6, 52], [-6, 55], [-8, 55], [-10, 54]],
    [[-24, 64], [-14, 64], [-13, 66], [-22, 66]],
    [[-17, 15], [-17, 21], [-13, 27], [-10, 30], [-6, 36], [10, 37], [11, 33], [20, 31], [32, 31], [34, 28], [43, 12], [51, 12], [44, 0], [40, -15], [35, -24], [32, -29], [27, -34], [20, -35], [18, -30], [12, -17], [14, -10], [9, -1], [9, 4], [5, 6], [-5, 5], [-12, 7], [-16, 11]],
    [[44, -25], [47, -25], [50, -15], [49, -12], [44, -16]],
    [[26, 40], [36, 36], [35, 32], [34, 28], [39, 21], [43, 13], [52, 16], [57, 19], [60, 22], [57, 25], [51, 24], [48, 30], [56, 27], [62, 25], [67, 25], [72, 21], [73, 16], [77, 8], [80, 10], [80, 15], [85, 20], [92, 22], [94, 17], [98, 16], [98, 8], [100, 4], [104, 1], [103, 8], [100, 13], [105, 9], [109, 12], [108, 21], [115, 22], [121, 28], [122, 31], [119, 35], [122, 40], [126, 38], [129, 35], [130, 43], [140, 48], [142, 53], [136, 55], [143, 59], [156, 57], [160, 62], [178, 65], [180, 69], [150, 71], [130, 72], [110, 77], [90, 76], [70, 73], [60, 70], [60, 55], [50, 46], [40, 47], [38, 45], [30, 46], [28, 41]],
    [[80, 6], [82, 7], [81, 9.5], [80, 9]],
    [[130, 31], [135, 34], [140, 35], [142, 40], [141, 45], [144, 44], [140, 41], [136, 37], [132, 35]],
    [[109, 1], [118, 7], [119, 1], [116, -4], [110, -3]], [[95, 5], [98, 4], [106, -6], [102, -4]], [[105, -6], [114, -7], [114, -8], [106, -7]],
    [[131, -1], [141, -3], [150, -10], [141, -9], [137, -5]],
    [[114, -22], [122, -18], [130, -12], [137, -12], [136, -15], [142, -11], [146, -19], [153, -25], [151, -34], [146, -39], [140, -38], [135, -35], [131, -31], [124, -34], [115, -34], [113, -26]],
    [[172, -35], [178, -38], [174, -42], [167, -46], [171, -44]],
    [[-180, -70], [180, -70], [180, -90], [-180, -90]],
  ];
  const PLACES = { India: [12.97, 77.59], Germany: [51, 10], Austria: [47.5, 14], Switzerland: [46.8, 8.2], Netherlands: [52.2, 5.3], Belgium: [50.6, 4.6],
    Luxembourg: [49.8, 6.1], Sweden: [59.5, 15], Denmark: [56, 10], Finland: [62, 26], Norway: [61, 9], Poland: [52, 19.5], Czechia: [49.8, 15.5],
    Estonia: [58.7, 25.5], Spain: [40.3, -3.7], Portugal: [39.6, -8], Ireland: [53.2, -8], UK: [52.5, -1.5], Australia: [-25, 134], Canada: [56, -100],
    Singapore: [1.35, 103.8], UAE: [24, 54], Japan: [36, 138] };
  let landMask = null;
  function mask() {
    if (landMask) return landMask;
    const c = document.createElement('canvas'); c.width = 360; c.height = 180; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff';
    for (const poly of LAND) { ctx.beginPath(); poly.forEach(([lo, la], i) => ctx[i ? 'lineTo' : 'moveTo'](lo + 180, 90 - la)); ctx.closePath(); ctx.fill(); }
    const d = ctx.getImageData(0, 0, 360, 180).data; landMask = new Uint8Array(360 * 180); for (let i = 0; i < landMask.length; i++) landMask[i] = d[i * 4 + 3] > 100 ? 1 : 0;
    return landMask;
  }
  const isLand = (lat, lon) => { lon = ((lon + 540) % 360) - 180; const x = Math.min(359, Math.max(0, Math.floor(lon + 180))), y = Math.min(179, Math.max(0, Math.floor(90 - lat))); return mask()[y * 360 + x]; };
  const RAD = Math.PI / 180;
  function slerp(a, b, t) {   // great-circle interpolation between [lat, lon] points
    const v = ([la, lo]) => [Math.cos(la * RAD) * Math.cos(lo * RAD), Math.cos(la * RAD) * Math.sin(lo * RAD), Math.sin(la * RAD)];
    const p = v(a), q = v(b), dot = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])), om = Math.acos(dot) || 1e-6;
    const s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om), r = [p[0] * s1 + q[0] * s2, p[1] * s1 + q[1] * s2, p[2] * s1 + q[2] * s2];
    return [Math.asin(r[2]) / RAD, Math.atan2(r[1], r[0]) / RAD];
  }
  function globe(c, opts = {}) {
    const n = c.width, ctx = c.getContext('2d'), img = ctx.createImageData(n, n), px = img.data, R0 = n / 2 - 1;
    const dests = Object.keys(opts.dest || {}).filter(k => PLACES[k]), offers = (opts.offers || []).filter(k => PLACES[k]);
    const sea = ['#0c1413', '#111c1a', '#16241f', '#1d2f28'].map(hex), land = ['#24391a', '#3f6a24', '#7fb83a', '#c8ff5a'].map(hex), ice = ['#7b857b', '#c9d1c6'].map(hex);
    let t = 0, timer = null, visible = true;
    const proj = (lat, lon, lat0, lon0) => {
      const cosc = Math.sin(lat0) * Math.sin(lat * RAD) + Math.cos(lat0) * Math.cos(lat * RAD) * Math.cos(lon * RAD - lon0);
      return { x: n / 2 + R0 * Math.cos(lat * RAD) * Math.sin(lon * RAD - lon0), y: n / 2 - R0 * (Math.cos(lat0) * Math.sin(lat * RAD) - Math.sin(lat0) * Math.cos(lat * RAD) * Math.cos(lon * RAD - lon0)), vis: cosc > 0 };
    };
    function draw() {
      const lon0 = (40 + Math.sin(t) * 22) * RAD, lat0 = 30 * RAD;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4, X = (x + .5 - n / 2) / R0, Y = -(y + .5 - n / 2) / R0, rho = Math.hypot(X, Y);
        if (rho > 1) { px[i + 3] = 0; continue; }
        const cz = Math.asin(rho), sc = Math.sin(cz), cc = Math.cos(cz);
        const lat = Math.asin(cc * Math.sin(lat0) + (rho ? Y * sc * Math.cos(lat0) / rho : 0)) / RAD;
        const lon = (lon0 + Math.atan2(X * sc, rho * cc * Math.cos(lat0) - Y * sc * Math.sin(lat0))) / RAD;
        const Z = Math.sqrt(1 - rho * rho), light = Math.max(0, -X * .55 + Y * .45 + Z * .7) * (1 - rho * rho * .25), d = bayer(x, y) * .22;
        let col;
        if (Math.abs(lat) > 72) col = ice[light + d > .6 ? 1 : 0];
        else if (isLand(lat, lon)) col = land[Math.max(0, Math.min(3, Math.floor((light + d) * 3.4)))];
        else col = sea[Math.max(0, Math.min(3, Math.floor((light + d) * 3.2)))];
        if (rho > .93 && light < .35) col = sea[0];
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const home = PLACES.India;
      for (const k of dests) {                       // flight arcs Bangalore -> each destination
        for (let s = 0; s <= 40; s++) { const [la, lo] = slerp(home, PLACES[k], s / 40), p = proj(la, lo, lat0, lon0);
          if (p.vis && (s + Math.floor(t * 20)) % 3 !== 0) { ctx.fillStyle = offers.includes(k) ? '#ffcf4a' : 'rgba(200,255,90,.85)'; ctx.fillRect(Math.round(p.x), Math.round(p.y - Math.sin(s / 40 * Math.PI) * 3), 1, 1); } }
      }
      for (const k of dests) { const p = proj(...PLACES[k], lat0, lon0); if (!p.vis) continue; const on = (Math.floor(t * 8) + k.length) % 4 !== 0;
        ctx.fillStyle = offers.includes(k) ? '#ffcf4a' : '#c8ff5a'; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2); if (on) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 1, 1); } }
      const h = proj(...home, lat0, lon0); if (h.vis) { ctx.fillStyle = '#ff8a3d'; ctx.fillRect(Math.round(h.x) - 1, Math.round(h.y) - 1, 3, 3); ctx.fillStyle = '#fff3c4'; ctx.fillRect(Math.round(h.x), Math.round(h.y), 1, 1); }
      for (const k of offers) {                      // the plane flies out and lands on every offer
        const cyc = (t * .9) % 1.6, s = Math.min(1, cyc), [la, lo] = slerp(home, PLACES[k], s), p = proj(la, lo, lat0, lon0);
        if (!p.vis) continue; const x = Math.round(p.x), y = Math.round(p.y - Math.sin(s * Math.PI) * 3);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x, y - 2, 1, 5); ctx.fillRect(x - 1, y + 2, 3, 1);
        if (s >= 1) { ctx.fillStyle = 'rgba(255,207,74,.6)'; ctx.fillRect(x - 3, y - 3, 7, 1); ctx.fillRect(x - 3, y + 3, 7, 1); }
      }
    }
    const tick = () => { if (visible && !document.hidden) { t += .012; draw(); } };
    draw();
    if (!RM) {
      timer = setInterval(tick, 90);
      if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(c);
    }
    return { stop() { clearInterval(timer); } };
  }

  // ------------------------------------------------------------------ level-up burst (Motion when vendored, WAAPI otherwise)
  function burst(x, y, label) {
    if (RM) return;
    const M = window.Motion, wrap = document.createElement('div'); wrap.className = 'burst'; wrap.setAttribute('aria-hidden', 'true');
    wrap.style.left = x + 'px'; wrap.style.top = y + 'px';
    const cols = ['#c8ff5a', '#ffcf4a', '#ffffff', '#6ad7e0', '#ff8fb8'];
    const parts = [];
    for (let i = 0; i < 28; i++) { const s = document.createElement('i'); s.style.background = cols[i % cols.length]; wrap.appendChild(s); parts.push(s); }
    const txt = document.createElement('b'); txt.textContent = label || 'LEVEL UP'; wrap.appendChild(txt);
    document.body.appendChild(wrap);
    parts.forEach((s, i) => {
      const a = (i / parts.length) * Math.PI * 2 + Math.random() * .3, r = 60 + Math.random() * 90;
      const kf = { transform: ['translate(0,0) scale(1)', `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r - 30}px) scale(.4)`], opacity: [1, 0] };
      if (M && M.animate) M.animate(s, kf, { duration: .9, ease: 'easeOut' }); else s.animate({ transform: kf.transform, opacity: kf.opacity }, { duration: 900, easing: 'steps(9)', fill: 'forwards' });
    });
    const tk = { transform: ['translate(-50%, 0) scale(.6)', 'translate(-50%, -46px) scale(1.15)', 'translate(-50%, -70px) scale(1)'], opacity: [0, 1, 0] };
    if (M && M.animate) M.animate(txt, tk, { duration: 1.4, ease: 'easeOut' }); else txt.animate(tk, { duration: 1400, easing: 'steps(14)', fill: 'forwards' });
    setTimeout(() => wrap.remove(), 1500);
  }

  // FLIP: the element animates from a previous rectangle into its new place (the REVISE fly-back to the queue head)
  function flyFrom(el, from) {
    if (RM || !el || !from) return;
    const to = el.getBoundingClientRect(), dx = from.left - to.left, dy = from.top - to.top;
    const kf = { transform: [`translate(${dx}px, ${dy}px) rotate(-4deg) scale(1.04)`, `translate(${dx * .4}px, ${dy * .4 - 40}px) rotate(3deg) scale(1.08)`, 'translate(0,0) rotate(0) scale(1)'] };
    el.classList.add('flying');
    const done = () => el.classList.remove('flying');
    if (window.Motion && Motion.animate) Motion.animate(el, kf, { duration: .9, ease: [.2, .8, .2, 1] }).then(done, done);
    else { const a = el.animate(kf, { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' }); a.onfinish = done; }
  }

  window.Art = { phase, scene, globe, burst, flyFrom, reducedMotion: RM, places: PLACES };
})();
