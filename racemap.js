/* The Race App — RACE MAP: navigacione trke. Ruta (waypointi, strana obilaska) pripada eventu sa NoR / SI strane.
   Dokumenti se uploaduju na NoR / SI kao i do sada; ovde se samo povezuju. Waypointi: ručni unos / izmena
   (i kasnije AI čitanje iz SI-ja). Na vodi: sledeća tačka, smer, razdaljina, VMC, ETA, strana obilaska, auto-prelazak. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) {} }
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rad(d) { return d * Math.PI / 180; }
  function d3(v) { return ('00' + Math.round(((v % 360) + 360) % 360)).slice(-3); }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function distNm(a, b) { var R = 3440.065, la1 = rad(a.lat), la2 = rad(b.lat), dla = la2 - la1, dlo = rad(b.lon - a.lon), h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) * Math.sin(dlo / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function brg(a, b) { var la1 = rad(a.lat), la2 = rad(b.lat), dlo = rad(b.lon - a.lon), y = Math.sin(dlo) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function fmtLL(v, pos, neg) { var a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return d + '°' + m.toFixed(3) + '′' + (v >= 0 ? pos : neg); }

  /* ---- koordinate: 45.123456 · 45 7.407 N · 45°07.407'N · 45°07'24.4"N · N45 07.407 · i par "lat, lon" ---- */
  function parseOne(s, isLon) {
    s = String(s || '').trim().toUpperCase().replace(/,/g, '.'); if (!s) return null;
    var hemi = (s.match(/[NSEW]/) || [null])[0]; s = s.replace(/[NSEW]/g, ' ');
    var nums = s.replace(/[°º'′"″]/g, ' ').trim().split(/\s+/).map(parseFloat).filter(function (x) { return !isNaN(x); });
    if (!nums.length) return null;
    var v = Math.abs(nums[0]) + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600; if (nums[0] < 0) v = -v;
    if (hemi === 'S' || hemi === 'W') v = -Math.abs(v);
    if (isLon ? Math.abs(v) > 180 : Math.abs(v) > 90) return null;
    return v;
  }
  function parsePair(s) {
    s = String(s || '').trim(); if (!s) return null;
    var m = s.toUpperCase().match(/^(.*?[NS])\s*[,;\s]\s*(.*[EW])$/) || s.toUpperCase().match(/^([NS].*?)\s*[,;\s]\s*([EW].*)$/);
    if (m) { var a = parseOne(m[1], false), b = parseOne(m[2], true); return a !== null && b !== null ? { lat: a, lon: b } : null; }
    var p = s.split(/\s*[;,]\s*|\s+(?=-?\d+\.\d+$)/); if (p.length === 2) { var x = parseOne(p[0], false), y = parseOne(p[1], true); return x !== null && y !== null ? { lat: x, lon: y } : null; }
    return null;
  }

  /* ---- event i ruta ---- */
  function events() { return sget('norEvents', []); }
  function curEv() { var id = sget('norCur', null), e = events(); return e.filter(function (x) { return x.id === id; })[0] || e[0] || null; }
  function saveEv(ev) { sset('norEvents', events().map(function (x) { return x.id === ev.id ? ev : x; })); }
  function route(ev) { ev.route = ev.route || { wps: [], k: 0, r: 50 }; return ev.route; }
  var S = { map: null, ready: false, edit: false, timer: null, boat: null, near: false, minD: null };

  function docsOf(ev) {
    return new Promise(function (res) {
      try { var rq = indexedDB.open('raNor', 1); rq.onupgradeneeded = function () { rq.result.createObjectStore('docs', { keyPath: 'id' }); }; rq.onsuccess = function () { try { var db = rq.result, tx = db.transaction('docs', 'readonly'), st = tx.objectStore('docs'), g = st.getAll(); g.onsuccess = function () { res((g.result || []).filter(function (d) { return d.eventId === ev.id && d.kind !== 'diagram'; })); }; g.onerror = function () { res([]); }; } catch (e) { res([]); } }; rq.onerror = function () { res([]); }; } catch (e) { res([]); }
    });
  }

  function render() {
    var box = $('rmBody'); if (!box) return;
    var ev = curEv();
    if (!ev) { box.innerHTML = '<div class="nor-empty"><h2>RACE MAP</h2><p>For distance races with waypoints. Add the event and its SI on the <b>NOR / SI</b> page, then come back here.</p></div>'; return; }
    var R = route(ev), w = R.wps;
    var h = '<div class="nor-title"><b>RACE MAP</b><span>' + esc((ev.summary && ev.summary.event) || ev.name) + '</span></div>';
    h += '<div class="rm-docs" id="rmDocs"><span class="small">Documents from this event…</span></div>';
    if (w.length) {
      h += '<div class="rm-nav" id="rmNav"></div>';
      h += '<div class="rm-map" id="rmMap"></div>';
    } else h += '<p class="small">No waypoints yet. Add them below (from the SI), or read them from the SI when AI reading is ready.</p>';
    h += '<div class="rm-sec"><div class="rm-head"><h3>ROUTE · ' + w.length + ' point' + (w.length === 1 ? '' : 's') + '</h3><button class="btn sm" id="rmEdit">' + (S.edit ? 'Done' : 'Edit') + '</button></div>';
    h += w.map(function (p, i) {
      var side = p.side === 'P' ? '<b class="rm-side p">PORT</b>' : p.side === 'S' ? '<b class="rm-side s">STBD</b>' : '<b class="rm-side">PASS</b>';
      if (!S.edit) return '<div class="rm-wp' + (i === R.k ? ' on' : '') + '" data-go="' + i + '"><span class="rm-n">' + (i + 1) + '</span><span class="rm-nm">' + esc(p.name || 'WP ' + (i + 1)) + '<small>' + fmtLL(p.lat, 'N', 'S') + ' ' + fmtLL(p.lon, 'E', 'W') + '</small></span>' + side + '</div>';
      return '<div class="rm-wp ed" data-i="' + i + '"><span class="rm-n">' + (i + 1) + '</span><div class="rm-edf"><input class="rm-in" data-f="name" value="' + esc(p.name || '') + '" placeholder="Name"><input class="rm-in" data-f="ll" value="' + esc(fmtLL(p.lat, 'N', 'S') + ' ' + fmtLL(p.lon, 'E', 'W')) + '" placeholder="45°07.407′N 13°36.200′E">' +
        '<div class="row"><select class="rm-in" data-f="side"><option value="P"' + (p.side === 'P' ? ' selected' : '') + '>Leave to PORT</option><option value="S"' + (p.side === 'S' ? ' selected' : '') + '>Leave to STARBOARD</option><option value=""' + (!p.side ? ' selected' : '') + '>Pass (no rounding)</option></select>' +
        '<button class="icon-btn" data-mv="-1">↑</button><button class="icon-btn" data-mv="1">↓</button><button class="cl-del" data-del="' + i + '">✕</button></div></div></div>';
    }).join('');
    if (S.edit) h += '<div class="rm-add"><input id="rmNewName" placeholder="Name (e.g. Mark 3)"><input id="rmNewLL" placeholder="Coordinates, e.g. 45 07.407 N 13 36.200 E"><div class="row"><select id="rmNewSide"><option value="P">Leave to PORT</option><option value="S">Leave to STARBOARD</option><option value="">Pass</option></select><button class="btn" id="rmHere">📍 Here</button><button class="btn primary" id="rmAdd">+ Add</button></div><p class="small" id="rmMsg">Tip: you can also tap the map to place a point while editing.</p>' +
      '<label class="small">Rounding radius <input id="rmRad" type="number" min="15" max="300" step="5" value="' + R.r + '" style="width:70px"> m (when you are this close the next point is selected)</label></div>';
    h += '</div>';
    box.innerHTML = h;
    docsOf(ev).then(function (d) {
      var el = $('rmDocs'); if (!el) return;
      var si = d.filter(function (x) { return /\bsi\b|sailing.?instr|upute|instruc/i.test(x.name || ''); });
      el.innerHTML = d.length ? '<span class="small">Documents in this event: ' + d.map(function (x) { return '<b>' + esc(x.name) + '</b>'; }).join(', ') + '.</span> <button class="btn sm" disabled title="Coming with the first SI test">Read waypoints from SI (AI) · soon</button>' :
        '<span class="small">No documents in this event yet. Add the SI on the <b>NOR / SI</b> page (it is linked here), or enter the waypoints by hand.</span>';
      if (si.length) el.querySelector('button').title = 'SI found: ' + si[0].name;
    });
    if (w.length) { drawMap(ev); tick(); }
  }

  /* ---- mapa ---- */
  function fc(ev) {
    var w = route(ev).wps, k = route(ev).k;
    return { line: { type: 'Feature', geometry: { type: 'LineString', coordinates: w.map(function (p) { return [p.lon, p.lat]; }) } },
      pts: { type: 'FeatureCollection', features: w.map(function (p, i) { return { type: 'Feature', properties: { n: String(i + 1), s: p.side || '', on: i === k ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }; }) } };
  }
  function drawMap(ev) {
    if (!window.Track || !$('rmMap')) return;
    if (S.map) { try { S.map.remove(); } catch (e) {} S.map = null; S.ready = false; }
    window.Track.lib().then(function () {
      var w = route(ev).wps, b = new maplibregl.LngLatBounds(); w.forEach(function (p) { b.extend([p.lon, p.lat]); });
      var m = window.Track.makeMap($('rmMap'), b.getCenter().toArray()); S.map = m;
      m.on('load', function () { m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 15 }); });
      m.on('style.load', function () {
        if (m.getSource('rl')) return; var F = fc(ev);
        m.addSource('rl', { type: 'geojson', data: F.line }); m.addLayer({ id: 'rl', type: 'line', source: 'rl', paint: { 'line-color': '#00e0c6', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 } });
        m.addSource('rp', { type: 'geojson', data: F.pts });
        m.addLayer({ id: 'rp', type: 'circle', source: 'rp', paint: { 'circle-radius': ['case', ['==', ['get', 'on'], 1], 11, 8], 'circle-color': ['match', ['get', 's'], 'P', '#e8413a', 'S', '#2bbf5a', '#c8c8c8'], 'circle-stroke-width': ['case', ['==', ['get', 'on'], 1], 3, 1.5], 'circle-stroke-color': ['case', ['==', ['get', 'on'], 1], '#ffffff', '#05070a'] } });
        m.addLayer({ id: 'rpn', type: 'symbol', source: 'rp', layout: { 'text-field': ['get', 'n'], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#05070a' } });
        m.addSource('bt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'btl', type: 'line', source: 'bt', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.7 } });
        m.addLayer({ id: 'bt', type: 'circle', source: 'bt', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#05070a' } });
        S.ready = true; tick();
      });
      m.on('click', function (e) {
        if (!S.edit) return; var ll = $('rmNewLL'); if (!ll) return;
        ll.value = fmtLL(e.lngLat.lat, 'N', 'S') + ' ' + fmtLL(e.lngLat.lng, 'E', 'W'); $('rmMsg').textContent = 'Point placed from the map. Name it and tap + Add.';
      });
    }).catch(function () { var el = $('rmMap'); if (el) el.innerHTML = '<p class="small" style="padding:12px">Map needs internet.</p>'; });
  }

  /* ---- navigacija ---- */
  function tick() {
    var ev = curEv(); if (!ev) return; var R = route(ev), w = R.wps, nav = $('rmNav'); if (!nav || !w.length) return;
    var me = window.RA && window.RA.nav ? window.RA.nav() : null, T = w[Math.min(R.k, w.length - 1)];
    var side = T.side === 'P' ? '<b class="rm-side p big">LEAVE TO PORT</b>' : T.side === 'S' ? '<b class="rm-side s big">LEAVE TO STARBOARD</b>' : '<b class="rm-side big">PASS</b>';
    var h = '<div class="rm-next"><span class="rm-k">' + (R.k + 1) + '/' + w.length + '</span><b class="rm-tn">' + esc(T.name || 'WP ' + (R.k + 1)) + '</b>' + side + '</div>';
    if (me && me.lat) {
      var d = distNm(me, T), b = brg(me, T), vmc = me.sog !== null && me.hdg !== null ? me.sog * Math.cos(rad(nrm(me.hdg - b))) : null, eta = vmc && vmc > 0.3 ? d / vmc * 3600 : null;
      h += '<div class="rm-nums"><div><span>BRG</span><b>' + d3(b) + '°</b></div><div><span>DST nm</span><b>' + (d < 10 ? d.toFixed(2) : d.toFixed(1)) + '</b></div><div><span>VMC kn</span><b>' + (vmc === null ? '–' : vmc.toFixed(1)) + '</b></div><div><span>ETA</span><b>' + (eta === null ? '–' : (eta >= 3600 ? Math.floor(eta / 3600) + 'h' + ('0' + Math.floor(eta % 3600 / 60)).slice(-2) : Math.floor(eta / 60) + ':' + ('0' + Math.round(eta % 60)).slice(-2))) + '</b></div></div>';
      // auto-prelazak: ušao u krug obilaska, pa počeo da se udaljava
      var dm = d * 1852;
      if (dm <= R.r) { S.near = true; S.minD = S.minD === null ? dm : Math.min(S.minD, dm); }
      else if (S.near && dm > R.r * 1.3 && R.k < w.length - 1) { S.near = false; S.minD = null; R.k++; saveEv(ev); if (window.RA && window.RA.toast) window.RA.toast('Next: ' + (w[R.k].name || 'WP ' + (R.k + 1))); return render(); }
      if (S.map && S.ready) { var bt = S.boat = S.boat || []; bt.push([me.lon, me.lat]); if (bt.length > 600) bt.shift(); S.map.getSource('bt').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: bt.length > 1 ? bt : [[me.lon, me.lat], [me.lon, me.lat]] } }, { type: 'Feature', geometry: { type: 'Point', coordinates: [me.lon, me.lat] } }] }); }
    } else h += '<p class="small">Waiting for GPS…</p>';
    h += '<div class="row rm-step"><button class="btn sm" id="rmPrev">◀ Prev</button><button class="btn sm" id="rmNext">Next ▶</button></div>';
    nav.innerHTML = h;
  }
  function setK(k) { var ev = curEv(); if (!ev) return; var R = route(ev); R.k = Math.max(0, Math.min(R.wps.length - 1, k)); S.near = false; S.minD = null; saveEv(ev); render(); }

  /* ---- događaji ---- */
  function bind() {
    var box = $('rmBody'); if (!box) return;
    box.addEventListener('click', function (e) {
      var t = e.target, ev = curEv(); if (!ev) return; var R = route(ev);
      if (t.id === 'rmEdit') { S.edit = !S.edit; render(); return; }
      if (t.id === 'rmPrev') { setK(R.k - 1); return; }
      if (t.id === 'rmNext') { setK(R.k + 1); return; }
      if (t.id === 'rmHere') { var me = window.RA && window.RA.nav ? window.RA.nav() : null; if (me && me.lat) $('rmNewLL').value = fmtLL(me.lat, 'N', 'S') + ' ' + fmtLL(me.lon, 'E', 'W'); else $('rmMsg').textContent = 'No GPS position yet.'; return; }
      if (t.id === 'rmAdd') {
        var p = parsePair($('rmNewLL').value); if (!p) { $('rmMsg').textContent = 'Could not read the coordinates. Example: 45 07.407 N 13 36.200 E, or 45.12345, 13.60333'; return; }
        R.wps.push({ name: $('rmNewName').value.trim() || 'WP ' + (R.wps.length + 1), lat: p.lat, lon: p.lon, side: $('rmNewSide').value }); saveEv(ev); render(); return;
      }
      if (t.hasAttribute('data-del')) { R.wps.splice(+t.getAttribute('data-del'), 1); if (R.k >= R.wps.length) R.k = Math.max(0, R.wps.length - 1); saveEv(ev); render(); return; }
      if (t.hasAttribute('data-mv')) { var i = +t.closest('[data-i]').getAttribute('data-i'), j = i + (+t.getAttribute('data-mv')); if (j < 0 || j >= R.wps.length) return; var x = R.wps[i]; R.wps[i] = R.wps[j]; R.wps[j] = x; saveEv(ev); render(); return; }
      var g = t.closest('[data-go]'); if (g && !S.edit) setK(+g.getAttribute('data-go'));
    });
    box.addEventListener('change', function (e) {
      var t = e.target, ev = curEv(); if (!ev) return; var R = route(ev);
      if (t.id === 'rmRad') { R.r = Math.max(15, Math.min(300, +t.value || 50)); saveEv(ev); return; }
      var row = t.closest('[data-i]'); if (!row || !t.getAttribute('data-f')) return; var p = R.wps[+row.getAttribute('data-i')], f = t.getAttribute('data-f');
      if (f === 'name') p.name = t.value.trim();
      if (f === 'side') p.side = t.value;
      if (f === 'll') { var q = parsePair(t.value); if (!q) { t.classList.add('bad'); return; } t.classList.remove('bad'); p.lat = q.lat; p.lon = q.lon; }
      saveEv(ev); if (f !== 'name') { var c = fc(ev); if (S.map && S.ready) { S.map.getSource('rl').setData(c.line); S.map.getSource('rp').setData(c.pts); } }
    });
    S.timer = setInterval(function () { var pg = $('p-map'); if (pg && pg.getBoundingClientRect().left > -10 && pg.getBoundingClientRect().left < 10) tick(); }, 1000);
  }
  window.RaceMap = { render: render, parsePair: parsePair, parseOne: parseOne };
  if (document.readyState !== 'loading') { bind(); render(); } else document.addEventListener('DOMContentLoaded', function () { bind(); render(); });
})();
