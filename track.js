/* The Race App — Tracking: record GPS + telemetry, live map, saved tracks, replay, GPX */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var R = function () { return window.RA; };
  function toast(m, a, f, ms) { if (R()) R().toast(m, a, f, ms); }
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var STYLE = 'https://tiles.openfreemap.org/styles/dark', STYLE2 = 'https://tiles.openfreemap.org/styles/positron';
  var FREE_LIMIT = 3;

  /* ---- storage (IndexedDB) ---- */
  var dbP;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var r = indexedDB.open('raTracks', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('tracks', { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  function tx(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('tracks', mode), out = fn(t.objectStore('tracks')); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); }; }); }); }
  function allTracks() { return tx('readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return y.start - x.start; }); }); }
  function getTrack(id) { return tx('readonly', function (s) { return s.get(id); }); }
  function putTrack(t) { return tx('readwrite', function (s) { s.put(t); }); }
  function delTrack(id) { return tx('readwrite', function (s) { s.delete(id); }); }

  /* ---- geo helpers ---- */
  function rad(d) { return d * Math.PI / 180; }
  function dist(a, b) { var R6 = 6371000, dLa = rad(b[1] - a[1]), dLo = rad(b[2] - a[2]); var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R6 * Math.asin(Math.sqrt(x)); }
  // point: [t(ms), lat, lon, sog(kn), cog(deg), heel(deg), acc(m)]
  function stats(p) {
    var d = 0, mx = 0, s = 0, n = 0;
    for (var i = 0; i < p.length; i++) { if (i) d += dist(p[i - 1], p[i]); if (p[i][3] !== null) { mx = Math.max(mx, p[i][3]); s += p[i][3]; n++; } }
    return { dist: d / 1852, max: mx, avg: n ? s / n : 0, dur: p.length ? (p[p.length - 1][0] - p[0][0]) / 1000 : 0, n: p.length };
  }
  function fmtDur(s) { s = Math.round(s); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (ss < 10 ? '0' : '') + ss; }
  function d3(v) { return v === null || v === undefined || isNaN(v) ? '–––' : ('00' + Math.round(v) % 360).slice(-3); }
  function kn(v) { return v === null || v === undefined || isNaN(v) ? '–.–' : v.toFixed(1); }
  function heelTxt(v) { return v === null || v === undefined || isNaN(v) ? '–' : (v > 0 ? 'S ' : v < 0 ? 'P ' : '') + Math.abs(Math.round(v)) + '°'; }

  /* ---- recording ---- */
  var rec = null, lastSave = 0;
  function startRec(auto) {
    if (rec) return;
    var now = Date.now();
    rec = { id: 't' + now, name: (auto ? 'Race ' : 'Track ') + new Date(now).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), start: now, points: [], auto: !!auto };
    putTrack(rec); renderRecBtn(); toast(auto ? 'Race start: track recording' : 'Track recording started');
    allTracks().then(function (a) { if (a.length > FREE_LIMIT) toast('Free keeps ' + FREE_LIMIT + ' tracks. Pro: unlimited (unlocked for testing).', null, null, 4000); });
  }
  function stopRec() {
    if (!rec) return;
    var t = rec; rec = null; t.end = Date.now(); t.stats = stats(t.points);
    putTrack(t).then(function () { renderRecBtn(); toast('Track saved: ' + t.stats.dist.toFixed(2) + ' NM, ' + fmtDur(t.stats.dur)); });
  }
  function onFix(f) {
    live.last = f;
    if (rec && !f.sim) {
      rec.points.push([f.t, +f.lat.toFixed(6), +f.lon.toFixed(6), f.sog === null ? null : +f.sog.toFixed(2), f.cog === null || f.cog === undefined ? null : Math.round(f.cog), f.heel === null || f.heel === undefined ? null : +f.heel.toFixed(1), f.acc === null ? null : Math.round(f.acc), f.x || null]);
      if (Date.now() - lastSave > 15000) { lastSave = Date.now(); rec.stats = stats(rec.points); putTrack(rec); }
    }
    updateLive();
  }

  /* ---- map loader ---- */
  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    return new Promise(function (res, rej) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'lib/maplibre-gl.css'; document.head.appendChild(l);
      var s = document.createElement('script'); s.src = 'lib/maplibre-gl.js'; s.onload = res; s.onerror = function () { rej(new Error('map failed to load')); }; document.head.appendChild(s);
    });
  }
  function makeMap(el, center) {
    var tried = false, m = new maplibregl.Map({ container: el, style: STYLE, center: center, zoom: 14, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
    m.touchZoomRotate.disableRotation();
    m.on('error', function (e) { if (!tried && e && e.error && /style/i.test(String(e.error.message || ''))) { tried = true; m.setStyle(STYLE2); } });
    return m;
  }
  function dotEl(cls) { var d = document.createElement('div'); d.className = cls; return d; }

  /* ---- live page ---- */
  var live = { map: null, marker: null, last: null, ready: false, follow: true };
  function lineGeo(pts) { return { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(function (p) { return [p[2], p[1]]; }) } }; }
  function showLive() {
    var el = $('trkLiveMap'); if (!el) return;
    loadLib().then(function () {
      if (!live.map) {
        var c = live.last ? [live.last.lon, live.last.lat] : [20.3985, 44.7872];
        live.map = makeMap(el, c);
        live.marker = new maplibregl.Marker({ element: dotEl('trk-boat') }).setLngLat(c).addTo(live.map);
        live.map.on('dragstart', function () { live.follow = false; });
        live.map.on('style.load', addLiveLayers);
      } else live.map.resize();
      updateLive();
    }).catch(function () { el.innerHTML = '<p class="small" style="padding:16px">Map needs internet the first time.</p>'; });
  }
  function addLiveLayers() {
    var m = live.map; live.ready = true;
    if (m.getSource('live')) return;
    m.addSource('live', { type: 'geojson', lineMetrics: true, data: lineGeo(rec ? rec.points : []) });
    m.addLayer({ id: 'live', type: 'line', source: 'live', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 4, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#0a5566', 0.6, '#00b3a4', 1, '#b8fff5'] } });
  }
  function updateLive() {
    var f = live.last;
    if ($('trkLSog')) {
      $('trkLSog').textContent = f ? kn(f.sog) : '–.–'; $('trkLCog').textContent = f ? d3(f.cog) : '–––';
    }
    if (!live.map || !f) return;
    live.marker.setLngLat([f.lon, f.lat]);
    if (live.ready && live.map.getSource('live') && rec && rec.points.length > 1) live.map.getSource('live').setData(lineGeo(rec.points));
    if (live.follow) live.map.easeTo({ center: [f.lon, f.lat], duration: 600 });
    drawTactics(f);
  }
  /* ---- Taktika L1: bove, layline-ovi, povoljna strana ---- */
  function rad(d) { return d * Math.PI / 180; }
  function off(o, brg, m) { return [o.lon + m * Math.sin(rad(brg)) / (111195 * Math.cos(rad(o.lat))), o.lat + m * Math.cos(rad(brg)) / 111195]; }
  function lxy(o, p) { return { x: rad(p.lon - o.lon) * 6371000 * Math.cos(rad(o.lat)), y: rad(p.lat - o.lat) * 6371000 }; }
  function brgTo(a, b) { var v = lxy(a, b); return (Math.atan2(v.x, v.y) * 180 / Math.PI + 360) % 360; }
  function rayToLine(o, mk, dirLine, hdg) {
    // udaljenost od broda (o) duž kursa hdg do linije kroz mk u pravcu dirLine
    var p = lxy(mk, o), d = { x: Math.sin(rad(dirLine)), y: Math.cos(rad(dirLine)) }, h = { x: Math.sin(rad(hdg)), y: Math.cos(rad(hdg)) };
    var den = h.x * d.y - h.y * d.x; if (Math.abs(den) < 1e-6) return null;
    var tt = (p.y * d.x - p.x * d.y) / den; // p + h*tt na liniji
    return tt;
  }
  var TAC_EMPTY = { type: 'FeatureCollection', features: [] };
  function drawTactics(f) {
    var m = live.map, box = $('tacInfo'); if (!m || !live.ready || !window.RA || !window.RA.tac) return;
    var ti = window.RA.tac(), mk = ti.marks || {}, feats = [], area = [], info = '';
    ['top', 'bottom'].forEach(function (k) { if (mk[k]) feats.push({ type: 'Feature', properties: { k: k === 'top' ? 'W' : 'L', kind: 'mark' }, geometry: { type: 'Point', coordinates: [mk[k].lon, mk[k].lat] } }); });
    var target = ti.leg === 'up' ? mk.top : mk.bottom;
    if (target && f) {
      var dm = Math.sqrt(Math.pow(lxy(f, target).x, 2) + Math.pow(lxy(f, target).y, 2));
      info = (ti.leg === 'up' ? 'WINDWARD MARK ' : 'LEEWARD MARK ') + Math.round(dm) + ' m · ' + ('00' + Math.round(brgTo(f, target)) % 360).slice(-3) + '°';
    }
    if (ti.leg === 'up' && mk.top && ti.axis !== null && ti.ta) {
      var dS = (ti.axis - ti.ta / 2 + 180 + 360) % 360, dP = (ti.axis + ti.ta / 2 + 180) % 360, R = 2500;
      var eS = off(mk.top, dS, R), eP = off(mk.top, dP, R), eC = off(mk.top, (ti.axis + 180) % 360, R * Math.cos(rad(ti.ta / 2))), c0 = [mk.top.lon, mk.top.lat];
      feats.push({ type: 'Feature', properties: { kind: 'lay', s: 'stbd' }, geometry: { type: 'LineString', coordinates: [c0, eS] } });
      feats.push({ type: 'Feature', properties: { kind: 'lay', s: 'port' }, geometry: { type: 'LineString', coordinates: [c0, eP] } });
      if (ti.shift !== null && Math.abs(ti.shift) >= 4) {
        var right = ti.shift > 0; // veer (desni šift) -> desna strana (gledano uz vetar) povoljna
        area.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[c0, right ? eS : eP, eC, c0]] } });
        info += (info ? ' · ' : '') + (right ? 'RIGHT' : 'LEFT') + ' +' + Math.round(Math.abs(ti.shift)) + '°';
      }
      if (f && f.cog !== null && f.cog !== undefined && ti.side) {
        var lay = ti.side === 'stbd' ? dP : dS, dist = rayToLine(f, mk.top, lay, f.cog);
        if (dist !== null && dist > 0 && dist < 5000) info += (info ? ' · ' : '') + 'LAYLINE ' + Math.round(dist) + ' m';
        else if (dist !== null && dist <= 0) info += (info ? ' · ' : '') + 'PAST LAYLINE';
      }
    }
    if (!m.getSource('tac')) {
      m.addSource('tacA', { type: 'geojson', data: TAC_EMPTY });
      m.addLayer({ id: 'tacA', type: 'fill', source: 'tacA', paint: { 'fill-color': '#00e0c6', 'fill-opacity': 0.14 } }, m.getLayer('live') ? 'live' : undefined);
      m.addSource('tac', { type: 'geojson', data: TAC_EMPTY });
      m.addLayer({ id: 'tacL', type: 'line', source: 'tac', filter: ['==', ['get', 'kind'], 'lay'], paint: { 'line-color': ['match', ['get', 's'], 'stbd', '#00e0c6', '#ff2e93'], 'line-width': 2, 'line-dasharray': [2, 2] } });
      m.addLayer({ id: 'tacM', type: 'circle', source: 'tac', filter: ['==', ['get', 'kind'], 'mark'], paint: { 'circle-radius': 9, 'circle-color': '#ffb300', 'circle-stroke-width': 2, 'circle-stroke-color': '#05070a' } });
    }
    m.getSource('tac').setData({ type: 'FeatureCollection', features: feats });
    m.getSource('tacA').setData({ type: 'FeatureCollection', features: area });
    if (box) box.textContent = info || (ti.leg === 'up' ? 'Windward mark is learned at your first bear-away, or tap MARK when rounding.' : 'Leeward mark is learned at your first round-up, or tap MARK when rounding.');
  }
  function renderRecBtn() {
    var b = $('trkRecBtn'); if (!b) return;
    b.classList.toggle('on', !!rec); b.querySelector('span').textContent = rec ? 'STOP TRACK' : 'START TRACK';
  }
  document.addEventListener('click', function (e) {
    var mb = e.target.closest && e.target.closest('#tacMark'); if (mb) { if (window.RA && window.RA.setMark) window.RA.setMark(); if (live.last) drawTactics(live.last); return; }
    var b = e.target.closest && e.target.closest('#trkRecBtn'); if (!b) return;
    if (rec) toast('Stop and save this track?', 'Stop', stopRec, 4000); else { live.follow = true; startRec(false); }
  });

  /* ---- list + replay ---- */
  var view = { id: null, map: null, pts: null, i: 0, playing: false, timer: null, speed: 10 };
  function openList() {
    stopPlay(); document.body.classList.remove('trk-fs-on'); var sf = document.querySelector('body > #rpStage'); if (sf) sf.remove(); view.id = null; $('trkTitle').textContent = 'TRACKING'; $('trkMore').classList.add('hidden');
    allTracks().then(function (a) {
      var h = '';
      if (rec) h += '<div class="trk-recnow"><i></i> Recording: ' + esc(rec.name) + ' · ' + rec.points.length + ' points</div>';
      h += '<p class="small">Free keeps ' + FREE_LIMIT + ' tracks · <span class="pro">PRO</span> unlimited (unlocked for testing). Tracks start automatically at the race gun, or with START TRACK on the Live tracking screen.</p>';
      if (!a.length) h += '<p class="small">No tracks yet.</p>';
      a.forEach(function (t) {
        var st = t.stats || stats(t.points || []);
        h += '<button class="cl-card" data-trk="' + t.id + '"><span class="cl-name">' + esc(t.name) + '</span><span class="cl-meta">' + st.dist.toFixed(2) + ' NM</span>' +
          '<span class="trk-meta">' + fmtDur(st.dur) + ' · avg ' + st.avg.toFixed(1) + ' kn · max ' + st.max.toFixed(1) + ' kn' + (rec && rec.id === t.id ? ' · recording' : '') + '</span></button>';
      });
      $('trkBody').innerHTML = h;
    });
  }
  var SPD = [[0, '#0a5566'], [3, '#00b3a4'], [5, '#00e0c6'], [7, '#9b3bff'], [9, '#ff2e93'], [12, '#ff1fd2']];
  function segGeo(p) {
    var f = [];
    for (var i = 1; i < p.length; i++) f.push({ type: 'Feature', properties: { s: p[i][3] || 0 }, geometry: { type: 'LineString', coordinates: [[p[i - 1][2], p[i - 1][1]], [p[i][2], p[i][1]]] } });
    return { type: 'FeatureCollection', features: f };
  }
  function heelBar(v) {
    var h = '', n = v === null || v === undefined ? null : Math.min(6, Math.round(Math.abs(v) / 3)), side = v > 0 ? 1 : -1;
    for (var k = -6; k <= 6; k++) {
      var c = '';
      if (n !== null) { if (k === 0 && n === 0) c = 'g'; else if (k && Math.sign(k) === side && Math.abs(k) <= n) c = Math.abs(k) <= 2 ? 'g' : Math.abs(k) <= 4 ? 'w' : 'b'; }
      h += '<i class="' + (k === 0 ? 'c ' : '') + c + '"></i>';
    }
    return h;
  }
  function openTrack(id) {
    getTrack(id).then(function (t) {
      if (!t || !t.points || !t.points.length) { toast('Empty track'); return; }
      view.id = id; view.pts = t.points; view.i = 0; view.t = t;
      view.mnv = window.Maneuvers ? window.Maneuvers.analyze(t.points) : null;
      view.cum = [0]; for (var ci = 1; ci < t.points.length; ci++) view.cum.push(view.cum[ci - 1] + dist(t.points[ci - 1], t.points[ci]) / 1852);
      $('trkTitle').textContent = 'REPLAY'; $('trkMore').classList.remove('hidden');
      var st = t.stats || stats(t.points);
      $('trkBody').innerHTML = '<div class="trk-name"><b>' + esc(t.name) + '</b><span>' + st.dist.toFixed(2) + ' NM · ' + fmtDur(st.dur) + ' · avg ' + st.avg.toFixed(1) + ' · max ' + st.max.toFixed(1) + ' kn</span></div>' +
        '<div class="trk-stage" id="rpStage">' +
          '<div class="trk-map" id="trkMap"><div class="trk-fsbtns"><button class="icon-btn trk-zin" id="rpZin" aria-label="Zoom in">+</button><button class="icon-btn trk-zin" id="rpZout" aria-label="Zoom out">−</button><button class="icon-btn" id="rpFs" aria-label="Full screen">⛶</button></div></div>' +
          '<div class="trk-ctrl"><button class="icon-btn" id="rpPlay">▶</button><input type="range" id="rpSlider" min="0" max="' + (t.points.length - 1) + '" value="0"><button class="icon-btn" id="rpSpeed">×10</button></div>' +
          '<div class="trk-tele"><div><em>TIME</em><b id="rpT">0:00</b></div><div><em>SOG kn</em><b id="rpS">–.–</b></div><div><em>COG</em><b id="rpC">–––</b></div><div><em>HEEL</em><b id="rpH">–</b></div><div><em>DIST NM</em><b id="rpD">0.00</b></div></div>' +
          '<div class="heel trk-heel" id="rpHeel"></div>' +
        '</div>' +
        '<div class="mnv" id="rpMnv"></div>' +
        '<div class="wm-legend trk-legend"><i style="background:linear-gradient(90deg,#0a5566,#00b3a4 25%,#00e0c6 42%,#9b3bff 58%,#ff2e93 75%,#ff1fd2)"></i><span>0</span><span>3</span><span>5</span><span>7</span><span>9</span><span>12 kn</span></div>' +
        '<div class="row"><button class="btn" id="rpRename">Rename</button><button class="btn" id="rpGpx">Export GPX</button><button class="btn" id="rpCsv">Export CSV</button><button class="btn danger" id="rpDel">Delete</button></div>';
      loadLib().then(function () {
        if (view.map) { view.map.remove(); view.map = null; }
        var p = t.points, b = new maplibregl.LngLatBounds();
        p.forEach(function (q) { b.extend([q[2], q[1]]); });
        view.map = makeMap($('trkMap'), [p[0][2], p[0][1]]);
        view.map.on('load', function () { view.map.fitBounds(b, { padding: 30, duration: 0, maxZoom: 16 }); });
        view.map.on('style.load', function () {
          if (view.map.getSource('trk')) return;
          view.map.addSource('trk', { type: 'geojson', data: segGeo(p) });
          var col = ['interpolate', ['linear'], ['get', 's']]; SPD.forEach(function (x) { col.push(x[0], x[1]); });
          view.map.addLayer({ id: 'trk', type: 'line', source: 'trk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 4, 'line-color': col } });
          if (view.mnv && view.mnv.list.length) {
            view.map.addSource('mnv', { type: 'geojson', data: { type: 'FeatureCollection', features: view.mnv.list.map(function (m, k) { return { type: 'Feature', properties: { c: lossCls(m), k: k + 1 }, geometry: { type: 'Point', coordinates: [m.lon, m.lat] } }; }) } });
            view.map.addLayer({ id: 'mnv', type: 'circle', source: 'mnv', paint: { 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#05070a',
              'circle-color': ['match', ['get', 'c'], 'good', '#00e0c6', 'ok', '#9b3bff', 'bad', '#ff2e93', '#8a969d'] } });
          }
        });
        view.marker = new maplibregl.Marker({ element: dotEl('trk-boat') }).setLngLat([p[0][2], p[0][1]]).addTo(view.map);
        setIdx(0);
      }).catch(function () { $('trkMap').innerHTML = '<p class="small" style="padding:16px">Map needs internet.</p>'; setIdx(0); });
      renderMnv();
      $('rpSlider').addEventListener('input', function (e) { stopPlay(); setIdx(+e.target.value); });
      $('rpPlay').addEventListener('click', function () { if (view.playing) stopPlay(); else play(); });
      // full screen: mapa + play/timeline + telemetrija, zum prstima ili +/−
      function setFs(on) {
        var stg = $('rpStage'); if (!stg) return;
        // prebaci u body (roditelj ekrana ima transform, pa fixed ne bi pokrio ceo ekran)
        if (on && stg.parentNode !== document.body) { var ph = document.createElement('div'); ph.id = 'rpStagePh'; stg.parentNode.insertBefore(ph, stg); document.body.appendChild(stg); }
        if (!on && $('rpStagePh')) { var ph2 = $('rpStagePh'); ph2.parentNode.insertBefore(stg, ph2); ph2.remove(); }
        stg.classList.toggle('fs', on); $('rpFs').textContent = on ? '✕' : '⛶';
        document.body.classList.toggle('trk-fs-on', on);
        setTimeout(function () { if (view.map) view.map.resize(); }, 60);
      }
      view.setFs = setFs;
      $('rpFs').addEventListener('click', function (e) { e.stopPropagation(); setFs(!$('rpStage').classList.contains('fs')); });
      $('rpZin').addEventListener('click', function (e) { e.stopPropagation(); if (view.map) view.map.zoomIn(); });
      $('rpZout').addEventListener('click', function (e) { e.stopPropagation(); if (view.map) view.map.zoomOut(); });
      $('rpSpeed').addEventListener('click', function () { view.speed = view.speed === 10 ? 30 : view.speed === 30 ? 1 : 10; $('rpSpeed').textContent = '×' + view.speed; });
      $('rpRename').addEventListener('click', function () { var n = prompt('Track name', t.name); if (n && n.trim()) { t.name = n.trim(); putTrack(t).then(function () { openTrack(id); }); } });
      $('rpGpx').addEventListener('click', function () { gpx(t); });
      $('rpCsv').addEventListener('click', function () { csv(t); });
      $('rpDel').addEventListener('click', function () { toast('Delete this track?', 'Delete', function () { delTrack(id).then(openList); }, 4000); });
    });
  }
  var KIND = { tack: 'TACK', gybe: 'GYBE', bearaway: 'BEAR AWAY', roundup: 'ROUND UP', turn: 'TURN' };
  function lossCls(m) { return m.loss === null ? 'none' : m.loss < 3 ? 'good' : m.loss <= 8 ? 'ok' : 'bad'; }
  function lossTxt(m) { if (m.loss === null) return ''; var v = Math.round(m.loss); return v > 0 ? '−' + v + ' m' : '+' + Math.abs(v) + ' m'; }
  function renderMnv() {
    var box = $('rpMnv'), r = view.mnv; if (!box) return;
    if (!r || !r.list.length) { box.innerHTML = '<p class="small">No maneuvers found in this track.</p>'; return; }
    var p0 = view.pts[0][0], S = r.summary || {}, h = '<div class="mnv-head">MANEUVERS' + (r.axis !== null ? '<span>wind ~' + d3(r.axis) + '°</span>' : '') + '</div>';
    function sm(k, lbl) { var x = S[k]; if (!x) return ''; return '<div class="mnv-sum"><b>' + lbl + ' ' + x.n + '</b><span>avg ' + (x.avgLoss > 0 ? '−' : '+') + Math.abs(Math.round(x.avgLoss)) + ' m' + (x.avgRec ? ' · back to speed ' + Math.round(x.avgRec) + ' s' : '') + '</span></div>'; }
    h += '<div class="mnv-sums">' + sm('tack', 'TACKS') + sm('gybe', 'GYBES') + '</div>';
    h += '<p class="small">Meters lost (−) or gained (+) against sailing on at the same VMG. Speeds: in → lowest → out.</p>';
    r.list.forEach(function (m, k) {
      h += '<button class="mnv-row ' + lossCls(m) + '" data-mt="' + m.t + '"><span class="mnv-k">' + (k + 1) + '</span><span class="mnv-main"><b>' + KIND[m.kind] + '</b> ' + fmtDur((m.t - p0) / 1000) + ' · ' + Math.round(m.turn) + '°' +
        '<em>' + (m.vIn ? m.vIn.toFixed(1) : '–') + ' → ' + (m.vMin !== null ? m.vMin.toFixed(1) : '–') + ' → ' + (m.vOut ? m.vOut.toFixed(1) : '–') + ' kn' + (m.rec !== null ? ' · ' + Math.round(m.rec) + ' s' : '') + '</em></span><span class="mnv-loss">' + lossTxt(m) + '</span></button>';
    });
    box.innerHTML = h;
    box.querySelectorAll('[data-mt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tt = +b.getAttribute('data-mt') - 8000, p = view.pts, j = 0; while (j < p.length - 1 && p[j][0] < tt) j++;
        stopPlay(); setIdx(j); if (view.map) view.map.easeTo({ center: [p[j][2], p[j][1]], zoom: Math.max(view.map.getZoom(), 16), duration: 500 });
        var mp = $('trkMap'); if (mp && mp.scrollIntoView) mp.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }
  function setIdx(i) {
    var p = view.pts; if (!p) return; i = Math.max(0, Math.min(p.length - 1, i)); view.i = i;
    var q = p[i];
    $('rpT').textContent = fmtDur((q[0] - p[0][0]) / 1000); $('rpS').textContent = kn(q[3]); $('rpC').textContent = d3(q[4]); $('rpH').textContent = heelTxt(q[5]);
    $('rpHeel').innerHTML = heelBar(q[5]); $('rpSlider').value = i; $('rpD').textContent = (view.cum ? view.cum[i] : 0).toFixed(2);
    if (view.marker) view.marker.setLngLat([q[2], q[1]]);
  }
  function play() {
    if (!view.pts) return; view.playing = true; $('rpPlay').textContent = '❚❚';
    if (view.i >= view.pts.length - 1) view.i = 0;
    var tick = function () {
      if (!view.playing) return;
      var p = view.pts, cur = p[view.i], target = cur[0] + 200 * view.speed, j = view.i;
      while (j < p.length - 1 && p[j + 1][0] <= target) j++;
      if (j === view.i) j++;
      if (j >= p.length) { stopPlay(); return; }
      setIdx(j); view.timer = setTimeout(tick, 200);
    };
    tick();
  }
  function stopPlay() { view.playing = false; clearTimeout(view.timer); if ($('rpPlay')) $('rpPlay').textContent = '▶'; }
  function gpx(t) {
    var p = t.points, x = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="The Race App" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ra="https://milosadasailingclub.github.io/race-app/gpx">\n<trk><name>' + esc(t.name) + '</name><trkseg>\n';
    p.forEach(function (q) {
      x += '<trkpt lat="' + q[1] + '" lon="' + q[2] + '"><time>' + new Date(q[0]).toISOString() + '</time><extensions>' +
        (q[3] !== null ? '<ra:sog_kn>' + q[3] + '</ra:sog_kn>' : '') + (q[4] !== null ? '<ra:cog>' + q[4] + '</ra:cog>' : '') + (q[5] !== null ? '<ra:heel>' + q[5] + '</ra:heel>' : '') + '</extensions></trkpt>\n';
    });
    x += '</trkseg></trk>\n</gpx>\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([x], { type: 'application/gpx+xml' }));
    a.download = t.name.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') + '.gpx'; document.body.appendChild(a); a.click(); a.remove();
    toast('GPX saved to Downloads');
  }
  function csv(t) {
    var x = 'time,lat,lon,sog_kn,cog,heel,acc_m,lift_phase,leg,side,ref,lift_deg,wind_axis,lift_mode,ref_src,timer\n';
    t.points.forEach(function (q) { var d = q[7] || []; x += [new Date(q[0]).toISOString(), q[1], q[2], q[3] === null ? '' : q[3], q[4] === null ? '' : q[4], q[5] === null ? '' : q[5], q[6] === null ? '' : q[6]].concat(d.length ? d : ['', '', '', '', '', '', '', '', '']).join(',') + '\n'; });
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([x], { type: 'text/csv' }));
    a.download = t.name.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    toast('CSV saved to Downloads');
  }
  document.addEventListener('click', function (e) {
    if (!$('tracking') || !$('tracking').classList.contains('active')) return;
    var c = e.target.closest && e.target.closest('[data-trk]'); if (c) openTrack(c.dataset.trk);
  });
  $('trkBack').addEventListener('click', function () { if (view.id) openList(); else R().show('menu'); });
  $('trkMore').addEventListener('click', function () { if (view.t) gpx(view.t); });

  // resume an interrupted recording (page reload)
  allTracks().then(function (a) {
    a.filter(function (t) { return !t.end && t.points; }).forEach(function (t, k) {
      var last = t.points.length ? t.points[t.points.length - 1][0] : t.start;
      if (k === 0 && Date.now() - last < 30 * 60000) { rec = t; renderRecBtn(); }
      else { t.end = last; t.stats = stats(t.points); putTrack(t); }
    });
  });
  setTimeout(renderRecBtn, 0);

  window.Track = { onFix: onFix, autoStart: function () { startRec(true); }, stop: stopRec, showLive: showLive, openList: openList, _stats: stats, _rec: function () { return rec; } };
})();
