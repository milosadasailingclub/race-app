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
      rec.points.push([f.t, +f.lat.toFixed(6), +f.lon.toFixed(6), f.sog === null ? null : +f.sog.toFixed(2), f.cog === null || f.cog === undefined ? null : Math.round(f.cog), f.heel === null || f.heel === undefined ? null : +f.heel.toFixed(1), f.acc === null ? null : Math.round(f.acc)]);
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
      $('trkLSog').textContent = f ? kn(f.sog) : '–.–'; $('trkLCog').textContent = f ? d3(f.cog) : '–––'; $('trkLHeel').textContent = f ? heelTxt(f.heel) : '–';
      $('trkLDist').textContent = rec ? stats(rec.points).dist.toFixed(2) : '0.00';
    }
    if (!live.map || !f) return;
    live.marker.setLngLat([f.lon, f.lat]);
    if (live.ready && live.map.getSource('live') && rec && rec.points.length > 1) live.map.getSource('live').setData(lineGeo(rec.points));
    if (live.follow) live.map.easeTo({ center: [f.lon, f.lat], duration: 600 });
  }
  function renderRecBtn() {
    var b = $('trkRecBtn'); if (!b) return;
    b.classList.toggle('on', !!rec); b.querySelector('span').textContent = rec ? 'STOP TRACK' : 'START TRACK';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#trkRecBtn'); if (!b) return;
    if (rec) toast('Stop and save this track?', 'Stop', stopRec, 4000); else { live.follow = true; startRec(false); }
  });

  /* ---- list + replay ---- */
  var view = { id: null, map: null, pts: null, i: 0, playing: false, timer: null, speed: 10 };
  function openList() {
    stopPlay(); view.id = null; $('trkTitle').textContent = 'TRACKING'; $('trkMore').classList.add('hidden');
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
      $('trkTitle').textContent = 'REPLAY'; $('trkMore').classList.remove('hidden');
      var st = t.stats || stats(t.points);
      $('trkBody').innerHTML = '<div class="trk-name"><b>' + esc(t.name) + '</b><span>' + st.dist.toFixed(2) + ' NM · ' + fmtDur(st.dur) + ' · avg ' + st.avg.toFixed(1) + ' · max ' + st.max.toFixed(1) + ' kn</span></div>' +
        '<div class="trk-map" id="trkMap"></div>' +
        '<div class="trk-tele"><div><em>TIME</em><b id="rpT">0:00</b></div><div><em>SOG kn</em><b id="rpS">–.–</b></div><div><em>COG</em><b id="rpC">–––</b></div><div><em>HEEL</em><b id="rpH">–</b></div></div>' +
        '<div class="heel trk-heel" id="rpHeel"></div>' +
        '<div class="trk-ctrl"><button class="icon-btn" id="rpPlay">▶</button><input type="range" id="rpSlider" min="0" max="' + (t.points.length - 1) + '" value="0"><button class="icon-btn" id="rpSpeed">×10</button></div>' +
        '<div class="wm-legend trk-legend"><i style="background:linear-gradient(90deg,#0a5566,#00b3a4 25%,#00e0c6 42%,#9b3bff 58%,#ff2e93 75%,#ff1fd2)"></i><span>0</span><span>3</span><span>5</span><span>7</span><span>9</span><span>12 kn</span></div>' +
        '<div class="row"><button class="btn" id="rpRename">Rename</button><button class="btn" id="rpGpx">Export GPX</button><button class="btn danger" id="rpDel">Delete</button></div>';
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
        });
        view.marker = new maplibregl.Marker({ element: dotEl('trk-boat') }).setLngLat([p[0][2], p[0][1]]).addTo(view.map);
        setIdx(0);
      }).catch(function () { $('trkMap').innerHTML = '<p class="small" style="padding:16px">Map needs internet.</p>'; setIdx(0); });
      $('rpSlider').addEventListener('input', function (e) { stopPlay(); setIdx(+e.target.value); });
      $('rpPlay').addEventListener('click', function () { if (view.playing) stopPlay(); else play(); });
      $('rpSpeed').addEventListener('click', function () { view.speed = view.speed === 10 ? 30 : view.speed === 30 ? 1 : 10; $('rpSpeed').textContent = '×' + view.speed; });
      $('rpRename').addEventListener('click', function () { var n = prompt('Track name', t.name); if (n && n.trim()) { t.name = n.trim(); putTrack(t).then(function () { openTrack(id); }); } });
      $('rpGpx').addEventListener('click', function () { gpx(t); });
      $('rpDel').addEventListener('click', function () { toast('Delete this track?', 'Delete', function () { delTrack(id).then(openList); }, 4000); });
    });
  }
  function setIdx(i) {
    var p = view.pts; if (!p) return; i = Math.max(0, Math.min(p.length - 1, i)); view.i = i;
    var q = p[i];
    $('rpT').textContent = fmtDur((q[0] - p[0][0]) / 1000); $('rpS').textContent = kn(q[3]); $('rpC').textContent = d3(q[4]); $('rpH').textContent = heelTxt(q[5]);
    $('rpHeel').innerHTML = heelBar(q[5]); $('rpSlider').value = i;
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
