/* The Race App — vetar na Race Map (prognoza Open-Meteo po mreži preko cele staze) + idealna ruta (izohrone)
   Grid: 11×11 tačaka preko granica staze, satno 72 h, model iz Weather strane (ra.wxModel).
   Ruta: za svaku etapu (tačka → tačka, uključujući via tačke) izohrone na 5 min; brzina iz polara klase,
   ugao u orcu ne oštriji od cilja iz North Sails tabele; kazna za okret/halzu; kopno iz vodenih poligona mape. */
(function () {
  'use strict';
  var GN = 11, STOPS = [[0, [7, 58, 71]], [6, [10, 85, 102]], [10, [0, 224, 198]], [15, [155, 59, 255]], [20, [255, 46, 147]], [28, [255, 31, 210]]];
  function rad(d) { return d * Math.PI / 180; }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function color(kn) {
    if (kn <= STOPS[0][0]) return STOPS[0][1];
    for (var i = 1; i < STOPS.length; i++) if (kn <= STOPS[i][0]) { var a = STOPS[i - 1], b = STOPS[i], t = (kn - a[0]) / (b[0] - a[0]); return [0, 1, 2].map(function (k) { return a[1][k] + (b[1][k] - a[1][k]) * t; }); }
    return STOPS[STOPS.length - 1][1];
  }

  /* ---- prognoza po mreži ---- */
  function bbox(pts) {
    var la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
    pts.forEach(function (p) { la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat); lo0 = Math.min(lo0, p.lon); lo1 = Math.max(lo1, p.lon); });
    var pl = Math.max(0.06, (la1 - la0) * 0.2), po = Math.max(0.08, (lo1 - lo0) * 0.2);
    return { lat0: la0 - pl, lat1: la1 + pl, lon0: lo0 - po, lon1: lo1 + po };
  }
  function fetchGrid(pts, model) {
    var g = bbox(pts), lats = [], lons = [];
    for (var j = 0; j < GN; j++) for (var i = 0; i < GN; i++) { lats.push((g.lat0 + (g.lat1 - g.lat0) * j / (GN - 1)).toFixed(4)); lons.push((g.lon0 + (g.lon1 - g.lon0) * i / (GN - 1)).toFixed(4)); }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') + '&longitude=' + lons.join(',') +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&timezone=GMT&forecast_hours=72' + (model && model !== 'best_match' ? '&models=' + model : '');
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var arr = Array.isArray(j) ? j : [j];
      if (!arr.length || arr[0].error || !arr[0].hourly) throw new Error((arr[0] && arr[0].reason) || 'no forecast');
      var pick = function (h, n) { if (h[n]) return h[n]; for (var x in h) if (x.indexOf(n + '_') === 0) return h[x]; return []; };
      var d = { g: g, model: model || 'best_match', t: arr[0].hourly.time.map(function (s) { return Date.parse(s + ':00Z'); }), s: [], dir: [], gu: [], at: Date.now() };
      arr.forEach(function (p) { d.s.push(pick(p.hourly, 'wind_speed_10m')); d.dir.push(pick(p.hourly, 'wind_direction_10m')); d.gu.push(pick(p.hourly, 'wind_gusts_10m')); });
      return d;
    });
  }
  // vetar u tački i trenutku (ms): {u, v, s, g, dir} — u/v = kuda duva (kn)
  function sample(d, lat, lon, tms) {
    if (!d) return null;
    var fx = (lon - d.g.lon0) / (d.g.lon1 - d.g.lon0) * (GN - 1), fy = (lat - d.g.lat0) / (d.g.lat1 - d.g.lat0) * (GN - 1);
    if (fx < -0.5 || fy < -0.5 || fx > GN - 0.5 || fy > GN - 0.5) return null;
    fx = Math.max(0, Math.min(GN - 1, fx)); fy = Math.max(0, Math.min(GN - 1, fy));
    var T = d.t, h = 0; while (h < T.length - 2 && T[h + 1] <= tms) h++;
    var ft = Math.max(0, Math.min(1, (tms - T[h]) / (T[h + 1] - T[h] || 1)));
    var x0 = Math.min(GN - 2, Math.floor(fx)), y0 = Math.min(GN - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0, acc = { u: 0, v: 0, s: 0, g: 0 }, wsum = 0;
    [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]].forEach(function (c) {
      var idx = (y0 + c[1]) * GN + x0 + c[0];
      [[h, 1 - ft], [h + 1, ft]].forEach(function (q) {
        var s = (d.s[idx] || [])[q[0]], dr = (d.dir[idx] || [])[q[0]], gu = (d.gu[idx] || [])[q[0]], w = c[2] * q[1];
        if (s === null || s === undefined || dr === null || dr === undefined || !w) return;
        var r = rad(dr); acc.u += -s * Math.sin(r) * w; acc.v += -s * Math.cos(r) * w; acc.s += s * w; acc.g += (gu || s) * w; wsum += w;
      });
    });
    if (!wsum) return null;
    acc.u /= wsum; acc.v /= wsum; acc.s /= wsum; acc.g /= wsum;
    acc.dir = (Math.atan2(-acc.u, -acc.v) * 180 / Math.PI + 360) % 360; // odakle duva
    return acc;
  }

  /* ---- sloj vetra na mapi (boja = jačina, čestice = smer) ---- */
  function Layer(map, box) {
    var L = { map: map, box: box, d: null, t: 0, f: null, parts: [], raf: 0 };
    L.fc = document.createElement('canvas'); L.fc.className = 'wm-layer';
    L.pc = document.createElement('canvas'); L.pc.className = 'wm-layer';
    box.appendChild(L.fc); box.appendChild(L.pc);
    function size(c) { var r = box.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); return { w: r.width, h: r.height }; }
    function rebuild() {
      if (!L.d) return; var ST = 8, sz = size(L.fc), ctx = L.fc.getContext('2d'); ctx.clearRect(0, 0, sz.w, sz.h);
      var cols = Math.ceil(sz.w / ST) + 1, rows = Math.ceil(sz.h / ST) + 1, F = new Float32Array(cols * rows * 3);
      for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) { var ll = map.unproject([x * ST, y * ST]), v = sample(L.d, ll.lat, ll.lng, L.t), o = (y * cols + x) * 3; if (v) { F[o] = v.u; F[o + 1] = v.v; F[o + 2] = v.s; } else F[o] = NaN; }
      L.f = { F: F, cols: cols, rows: rows, st: ST, w: sz.w, h: sz.h };
      var off = document.createElement('canvas'); off.width = cols; off.height = rows; var oc = off.getContext('2d'), img = oc.createImageData(cols, rows);
      for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) { o = (y * cols + x) * 3; var q = (y * cols + x) * 4; if (isNaN(F[o])) { img.data[q + 3] = 0; continue; } var c = color(F[o + 2]); img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 88; }
      oc.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(off, -ST / 2, -ST / 2, cols * ST, rows * ST);
      size(L.pc); var n = Math.round(sz.w * sz.h / 700); L.parts = []; for (var i = 0; i < n; i++) L.parts.push(np());
    }
    function np() { return { x: Math.random() * L.f.w, y: Math.random() * L.f.h, age: Math.random() * 80 | 0 }; }
    function at(px, py) {
      var f = L.f; if (!f) return null; var gx = px / f.st, gy = py / f.st, x0 = Math.floor(gx), y0 = Math.floor(gy);
      if (x0 < 0 || y0 < 0 || x0 >= f.cols - 1 || y0 >= f.rows - 1) return null;
      var o = (y0 * f.cols + x0) * 3; return isNaN(f.F[o]) ? null : { u: f.F[o], v: f.F[o + 1] };
    }
    function frame() {
      L.raf = requestAnimationFrame(frame); var f = L.f; if (!f || !L.parts.length || document.hidden) return;
      var ctx = L.pc.getContext('2d'); ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(0, 0, f.w, f.h);
      ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(238,243,245,0.6)'; ctx.beginPath();
      for (var i = 0; i < L.parts.length; i++) { var p = L.parts[i], v = at(p.x, p.y); if (!v || p.age > 90) { L.parts[i] = np(); L.parts[i].age = 0; continue; } var nx = p.x + v.u * 0.11, ny = p.y - v.v * 0.11; ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); p.x = nx; p.y = ny; p.age++; }
      ctx.stroke();
    }
    function clr() { var c = L.pc.getContext('2d'); c.clearRect(0, 0, L.pc.width, L.pc.height); }
    map.on('movestart', clr); map.on('moveend', rebuild); map.on('resize', rebuild);
    frame();
    return { set: function (d, t) { L.d = d; L.t = t; rebuild(); }, destroy: function () { cancelAnimationFrame(L.raf); map.off('movestart', clr); map.off('moveend', rebuild); map.off('resize', rebuild); L.fc.remove(); L.pc.remove(); } };
  }

  /* ---- kopno: vodeni poligoni iz vektorskih pločica mape → raster maska ---- */
  function waterMask(map, pts, feats) {
    var g = bbox(pts), W = 900, kx = Math.cos(rad((g.lat0 + g.lat1) / 2)), H = Math.max(200, Math.round(W * (g.lat1 - g.lat0) / ((g.lon1 - g.lon0) * kx)));
    if (H > 1400) { W = Math.round(W * 1400 / H); H = 1400; }
    if (!feats) { feats = []; try { var src = Object.keys(map.getStyle().sources).filter(function (k) { return map.getStyle().sources[k].type === 'vector'; })[0]; if (src) feats = map.querySourceFeatures(src, { sourceLayer: 'water' }); } catch (e) { feats = []; } }
    feats = feats.filter(function (f) { return f.geometry && /Polygon/.test(f.geometry.type); });
    if (!feats.length) return null;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var c = cv.getContext('2d');
    var X = function (lon) { return (lon - g.lon0) / (g.lon1 - g.lon0) * W; }, Y = function (lat) { return (g.lat1 - lat) / (g.lat1 - g.lat0) * H; };
    c.fillStyle = '#fff';
    feats.forEach(function (f) {
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(function (rings) { c.beginPath(); rings.forEach(function (r) { r.forEach(function (p, i) { if (i) c.lineTo(X(p[0]), Y(p[1])); else c.moveTo(X(p[0]), Y(p[1])); }); c.closePath(); }); c.fill('evenodd'); });
    });
    var px = c.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
    for (var i = 0; i < W * H; i++) m[i] = px[i * 4 + 3] > 100 ? 1 : 0;
    return { wet: function (lat, lon) { var x = Math.floor(X(lon)), y = Math.floor(Y(lat)); if (x < 0 || y < 0 || x >= W || y >= H) return true; return m[y * W + x] === 1; }, n: feats.length };
  }

  /* ---- idealna ruta: izohrone po etapama ---- */
  function route(opts) {
    // opts: { pts:[{lat,lon,name}], t0 (ms), wind (grid), P (polar), upMin (°), mask, tackS, gybeS }
    var pts = opts.pts, t = opts.t0, out = [[pts[0].lon, pts[0].lat]], tl = [t], legs = [];
    for (var k = 1; k < pts.length; k++) {
      var r = leg(pts[k - 1], pts[k], t, opts);
      if (!r) return { ok: false, failAt: k, line: out, tl: tl, legs: legs };
      r.path.slice(1).forEach(function (p, i) { out.push(p); tl.push(r.times[i + 1]); });
      legs.push({ to: k, t: r.t, tacks: r.tacks, i: out.length - 1 }); t = r.t;
    }
    return { ok: true, line: out, tl: tl, legs: legs, t0: opts.t0, t1: t };
  }
  function leg(A, B, t0, o) {
    var kx = Math.cos(rad(A.lat)) * 111320, ky = 110540, bx = (B.lon - A.lon) * kx, by = (B.lat - A.lat) * ky, D = Math.hypot(bx, by);
    if (D < 20) return { t: t0, path: [[A.lon, A.lat], [B.lon, B.lat]], times: [t0, t0], tacks: 0 };
    var dt = D > 30000 ? 600 : 300, SEC = 180, maxSteps = Math.ceil(48 * 3600 / dt);
    var toLL = function (x, y) { return { lat: A.lat + y / ky, lon: A.lon + x / kx }; };
    // oznake su često na stenama / hridima (npr. "isolated danger") ili uz obalu: oko početka i cilja etape (300 m) kopno se ne proverava
    var END = 300, clear = function (x1, y1, x2, y2) { if (!o.mask) return true; var n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 60)); for (var i = 1; i <= n; i++) { var x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n; if (Math.hypot(x, y) < END || Math.hypot(bx - x, by - y) < END) continue; var ll = toLL(x, y); if (!o.mask.wet(ll.lat, ll.lon)) return false; } return true; };
    var front = [{ x: 0, y: 0, t: t0, side: 0, tk: 0, par: null }], best = null;
    for (var step = 0; step < maxSteps && front.length; step++) {
      var next = new Array(SEC), arrivals = [];
      front.forEach(function (n) {
        var ll = toLL(n.x, n.y), w = sample(o.wind, ll.lat, ll.lon, n.t); if (!w || w.s < 0.5) return;
        // pravo na tačku, ako je stižemo u ovom koraku
        var dB = Math.hypot(bx - n.x, by - n.y), hb = (Math.atan2(bx - n.x, by - n.y) * 180 / Math.PI + 360) % 360, tb = nrm(hb - w.dir), twb = Math.abs(tb);
        if (dB < 60) arrivals.push({ x: bx, y: by, t: n.t + dB / 2 * 1000, side: n.side, tk: n.tk, par: n });
        else if (twb >= o.upMin) { var bsb = o.speed(w.s, twb); if (bsb && bsb > 0.3) { var sB = tb >= 0 ? 1 : -1, pB = n.side && sB !== n.side ? (twb < 90 ? o.tackS : o.gybeS) : 0; if (dB <= bsb * 0.5144 * (dt - pB) && clear(n.x, n.y, bx, by)) arrivals.push({ x: bx, y: by, t: n.t + (pB + dB / (bsb * 0.5144)) * 1000, side: sB, tk: n.tk + (pB ? 1 : 0), par: n }); } }
        for (var h = 0; h < 360; h += 5) {
          var twa = nrm(h - w.dir), a = Math.abs(twa); if (a < o.upMin) continue;
          var bs = o.speed(w.s, a); if (!bs || bs < 0.3) continue;
          var side = twa >= 0 ? 1 : -1, pen = n.side && side !== n.side ? (a < 90 ? o.tackS : o.gybeS) : 0, ds = bs * 0.5144 * Math.max(0, dt - pen);
          var nx = n.x + Math.sin(rad(h)) * ds, ny = n.y + Math.cos(rad(h)) * ds;
          if (!clear(n.x, n.y, nx, ny)) continue;
          var node = { x: nx, y: ny, t: n.t + dt * 1000, side: side, tk: n.tk + (pen ? 1 : 0), par: n };
          var sec = Math.round(((Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360) / (360 / SEC)) % SEC, r = Math.hypot(nx, ny), dn = Math.hypot(bx - nx, by - ny);
          if (dn > D * 2.5 + 3000) continue;
          var score = r - dn * 0.15;
          if (!next[sec] || score > next[sec].sc) { node.sc = score; next[sec] = node; }
        }
      });
      if (arrivals.length) { arrivals.forEach(function (a) { if (!best || a.t < best.t) best = a; }); break; }
      front = next.filter(Boolean);
    }
    if (!best) return null;
    var path = [], times = [], q = best; while (q) { var L = toLL(q.x, q.y); path.unshift([L.lon, L.lat]); times.unshift(q.t); q = q.par; }
    return { t: best.t, path: path, times: times, tacks: best.tk };
  }

  window.WxRoute = { fetchGrid: fetchGrid, sample: sample, Layer: Layer, waterMask: waterMask, route: route, model: function () { return sget('wxModel', 'best_match'); } };
})();
