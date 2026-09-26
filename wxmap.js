/* The Race App — own wind map (MapLibre + OpenFreeMap base + Open-Meteo grid) */
(function () {
  'use strict';
  var STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
  var STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/positron';
  var GRID_N = 11, SPAN_LAT = 0.14; // ±0.14° lat ≈ ±15 km
  var STOPS = [[0, [7, 58, 71]], [6, [10, 85, 102]], [10, [0, 224, 198]], [15, [155, 59, 255]], [20, [255, 46, 147]], [28, [255, 31, 210]]];

  function color(kn) {
    if (kn <= STOPS[0][0]) return STOPS[0][1];
    for (var i = 1; i < STOPS.length; i++) {
      if (kn <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i], t = (kn - a[0]) / (b[0] - a[0]);
        return [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t];
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    return new Promise(function (res, rej) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'lib/maplibre-gl.css'; document.head.appendChild(l);
      var s = document.createElement('script'); s.src = 'lib/maplibre-gl.js'; s.onload = res; s.onerror = function () { rej(new Error('map library failed to load')); };
      document.head.appendChild(s);
    });
  }

  var M = { map: null, box: null, loc: null, model: 'best_match', data: null, hour: 0, field: null, fc: null, pc: null, parts: [], raf: 0, key: '', onStatus: function () {} };

  function gridDef(loc) {
    var spanLon = SPAN_LAT / Math.cos(loc.lat * Math.PI / 180), lats = [], lons = [];
    for (var j = 0; j < GRID_N; j++) for (var i = 0; i < GRID_N; i++) {
      lats.push((loc.lat - SPAN_LAT + 2 * SPAN_LAT * j / (GRID_N - 1)).toFixed(4));
      lons.push((loc.lon - spanLon + 2 * spanLon * i / (GRID_N - 1)).toFixed(4));
    }
    return { lat0: loc.lat - SPAN_LAT, lat1: loc.lat + SPAN_LAT, lon0: loc.lon - spanLon, lon1: loc.lon + spanLon, lats: lats, lons: lons };
  }
  function cacheGet(k) { try { var v = JSON.parse(localStorage.getItem('ra.wxGrid')); return v && v.k === k ? v : null; } catch (e) { return null; } }
  function cacheSet(v) { try { localStorage.setItem('ra.wxGrid', JSON.stringify(v)); } catch (e) {} }

  function fetchGrid() {
    var g = gridDef(M.loc), k = M.loc.lat.toFixed(3) + ',' + M.loc.lon.toFixed(3) + '|' + M.model;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + g.lats.join(',') + '&longitude=' + g.lons.join(',') +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&timezone=auto&forecast_hours=24' +
      (M.model !== 'best_match' ? '&models=' + M.model : '');
    var cached = cacheGet(k);
    if (cached) { M.data = cached; M.onStatus('cached'); rebuild(); }
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var arr = Array.isArray(j) ? j : [j];
      if (!arr.length || arr[0].error || !arr[0].hourly) throw new Error((arr[0] && arr[0].reason) || 'no data');
      var pick = function (h, n) { if (h[n]) return h[n]; for (var x in h) if (x.indexOf(n + '_') === 0) return h[x]; return []; };
      var d = { k: k, g: { lat0: g.lat0, lat1: g.lat1, lon0: g.lon0, lon1: g.lon1 }, times: arr[0].hourly.time, s: [], dir: [], gu: [], at: Date.now() };
      arr.forEach(function (p) { d.s.push(pick(p.hourly, 'wind_speed_10m')); d.dir.push(pick(p.hourly, 'wind_direction_10m')); d.gu.push(pick(p.hourly, 'wind_gusts_10m')); });
      M.data = d; cacheSet(d); M.onStatus('ok'); rebuild();
    }).catch(function (e) { M.onStatus(M.data ? 'offline' : 'error', e.message); });
  }

  // value at lat/lon for current hour: returns {u,v,s,g} (kn)
  function sample(lat, lon) {
    var d = M.data; if (!d) return null;
    var fx = (lon - d.g.lon0) / (d.g.lon1 - d.g.lon0) * (GRID_N - 1), fy = (lat - d.g.lat0) / (d.g.lat1 - d.g.lat0) * (GRID_N - 1);
    if (fx < 0 || fy < 0 || fx > GRID_N - 1 || fy > GRID_N - 1) return null;
    var x0 = Math.min(GRID_N - 2, Math.floor(fx)), y0 = Math.min(GRID_N - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0, h = M.hour;
    var acc = { u: 0, v: 0, s: 0, g: 0 };
    [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]].forEach(function (c) {
      var idx = (y0 + c[1]) * GRID_N + (x0 + c[0]);
      var s = (d.s[idx] || [])[h], dr = (d.dir[idx] || [])[h], gu = (d.gu[idx] || [])[h];
      if (s === null || s === undefined || dr === null || dr === undefined) return;
      var r = dr * Math.PI / 180;
      acc.u += -s * Math.sin(r) * c[2]; acc.v += -s * Math.cos(r) * c[2]; acc.s += s * c[2]; acc.g += (gu || s) * c[2];
    });
    return acc;
  }

  function sizeCanvas(c) {
    var r = M.box.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height };
  }

  // build screen-space vector field (step px) + draw color field and labels
  function rebuild() {
    if (!M.map || !M.data) return;
    var STEP = 8, sz = sizeCanvas(M.fc), ctx = M.fc.getContext('2d');
    ctx.clearRect(0, 0, sz.w, sz.h);
    var cols = Math.ceil(sz.w / STEP) + 1, rows = Math.ceil(sz.h / STEP) + 1, F = new Float32Array(cols * rows * 3);
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var ll = M.map.unproject([x * STEP, y * STEP]), v = sample(ll.lat, ll.lng), o = (y * cols + x) * 3;
      if (v) { F[o] = v.u; F[o + 1] = v.v; F[o + 2] = v.s; } else { F[o] = NaN; }
    }
    M.field = { F: F, cols: cols, rows: rows, step: STEP, w: sz.w, h: sz.h };
    var off = document.createElement('canvas'); off.width = cols; off.height = rows;
    var oc = off.getContext('2d'), img = oc.createImageData(cols, rows);
    for (y = 0; y < rows; y++) for (x = 0; x < cols; x++) {
      o = (y * cols + x) * 3; var q = (y * cols + x) * 4;
      if (isNaN(F[o])) { img.data[q + 3] = 0; continue; }
      var c = color(F[o + 2]);
      img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 92;
    }
    oc.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, -STEP / 2, -STEP / 2, cols * STEP, rows * STEP);
    sizeCanvas(M.pc); seedParticles();
  }
  function at(px, py) {
    var f = M.field; if (!f) return null;
    var gx = px / f.step, gy = py / f.step, x0 = Math.floor(gx), y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 >= f.cols - 1 || y0 >= f.rows - 1) return null;
    var tx = gx - x0, ty = gy - y0, r = { u: 0, v: 0, s: 0 }, ok = true;
    [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]].forEach(function (c) {
      var o = ((y0 + c[1]) * f.cols + x0 + c[0]) * 3;
      if (isNaN(f.F[o])) { ok = false; return; }
      r.u += f.F[o] * c[2]; r.v += f.F[o + 1] * c[2]; r.s += f.F[o + 2] * c[2];
    });
    return ok ? r : null;
  }

  // particles
  function seedParticles() {
    var f = M.field; if (!f) return;
    var n = Math.round(f.w * f.h / 700); M.parts = [];
    for (var i = 0; i < n; i++) M.parts.push(newPart(f));
    var ctx = M.pc.getContext('2d'); ctx.clearRect(0, 0, f.w, f.h);
  }
  function newPart(f) { return { x: Math.random() * f.w, y: Math.random() * f.h, age: Math.random() * 80 | 0 }; }
  function frame() {
    M.raf = requestAnimationFrame(frame);
    var f = M.field; if (!f || !M.parts.length || document.hidden) return;
    var ctx = M.pc.getContext('2d');
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(0, 0, f.w, f.h);
    ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(238,243,245,0.6)'; ctx.beginPath();
    var K = 0.11;
    for (var i = 0; i < M.parts.length; i++) {
      var p = M.parts[i], v = at(p.x, p.y);
      if (!v || p.age > 90) { M.parts[i] = newPart(f); M.parts[i].age = 0; continue; }
      var nx = p.x + v.u * K, ny = p.y - v.v * K;
      ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); p.x = nx; p.y = ny; p.age++;
    }
    ctx.stroke();
  }

  function clearDyn() { if (M.pc) { var c = M.pc.getContext('2d'); c.clearRect(0, 0, M.pc.width, M.pc.height); } }

  window.WindMap = {
    open: function (box, loc, model, onStatus) {
      M.box = box; M.onStatus = onStatus || M.onStatus;
      var key = loc.lat.toFixed(3) + ',' + loc.lon.toFixed(3) + '|' + model;
      M.loc = loc; M.model = model;
      if (M.map && M.key === key) { M.map.resize(); rebuild(); return Promise.resolve(); }
      M.key = key;
      return loadLib().then(function () {
        if (!M.map) {
          box.innerHTML = '';
          var mdiv = document.createElement('div'); mdiv.className = 'wm-map'; box.appendChild(mdiv);
          M.fc = document.createElement('canvas'); M.fc.className = 'wm-layer';
          M.pc = document.createElement('canvas'); M.pc.className = 'wm-layer';
          var ui = document.createElement('div'); ui.className = 'wm-ui';
          ui.innerHTML = '<div class="wm-read" id="wmRead">Tap the map for wind at a point</div>' +
            '<div class="wm-time"><span id="wmT"></span><input type="range" id="wmSlider" min="0" max="23" value="0"></div>' +
            '<div class="wm-legend"><i></i><span>0</span><span>6</span><span>10</span><span>15</span><span>20</span><span>28 kn</span></div>';
          box.appendChild(M.fc); box.appendChild(M.pc); box.appendChild(ui);
          var styleTried = false;
          M.map = new maplibregl.Map({ container: mdiv, style: STYLE_DARK, center: [loc.lon, loc.lat], zoom: 11, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
          M.map.touchZoomRotate.disableRotation();
          M.map.on('error', function (e) {
            if (!styleTried && e && e.error && /style/i.test(String(e.error.message || ''))) { styleTried = true; M.map.setStyle(STYLE_FALLBACK); }
          });
          M.map.on('movestart', clearDyn);
          M.map.on('moveend', rebuild);
          M.map.on('resize', rebuild);
          M.map.on('click', function (e) {
            var s = sample(e.lngLat.lat, e.lngLat.lng), el = document.getElementById('wmRead');
            if (!s) { el.textContent = 'Outside forecast area'; return; }
            var dir = (Math.atan2(-s.u, -s.v) * 180 / Math.PI + 360) % 360;
            el.innerHTML = '<b>' + Math.round(s.s) + '</b> kn · gust <b>' + Math.round(s.g) + '</b> · <b>' + ('00' + Math.round(dir) % 360).slice(-3) + '°</b>';
          });
          document.getElementById('wmSlider').addEventListener('input', function (e) { M.hour = +e.target.value; timeLabel(); rebuild(); });
          M.marker = new maplibregl.Marker({ element: dot() }).setLngLat([loc.lon, loc.lat]).addTo(M.map);
          cancelAnimationFrame(M.raf); frame();
        } else {
          M.map.jumpTo({ center: [loc.lon, loc.lat], zoom: 11 });
          M.marker.setLngLat([loc.lon, loc.lat]);
        }
        M.data = null; M.hour = 0; document.getElementById('wmSlider').value = 0;
        return fetchGrid().then(timeLabel);
      });
    },
    resize: function () { if (M.map) M.map.resize(); }
  };
  function dot() { var d = document.createElement('div'); d.className = 'wm-dot'; return d; }
  function timeLabel() {
    var el = document.getElementById('wmT'); if (!el || !M.data || !M.data.times) return;
    var t = M.data.times[M.hour] || ''; el.textContent = t ? t.slice(8, 10) + '.' + t.slice(5, 7) + '. ' + t.slice(11, 16) : '';
  }
})();
