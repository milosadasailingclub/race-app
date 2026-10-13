/* The Race App — replay cele flote za jednu trku.
   Tirkizna osenčena traka = AI idealna linija za izabrani brod (Router), zlatna isprekidana = trag broda koji je leg odjedrio najbrže. */
(function () {
  'use strict';
  var COLORS = ['#9b3bff', '#ff2e93', '#ffb020', '#3da5ff', '#7cfc00', '#ff6b6b', '#c8c8c8', '#00b3a4', '#ffd6e8', '#a0ffa0'];
  var SPEEDS = [1, 5, 10, 20, 30], GOLD = '#ffc83d';
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mmss(s) { s = Math.round(s); var neg = s < 0; s = Math.abs(s); return (neg ? '−' : '') + Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function at(P, t) { var lo = 0, hi = P.length - 1; if (!P.length || t < P[0][0]) return null; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (P[m][0] <= t) lo = m; else hi = m - 1; } return P[lo]; }
  function $(id) { return document.getElementById(id); }
  var S = null;
  function setFs(on) {
    var stg = $('rrStage'); if (!stg) return;
    // prebaci u body (roditelj ekrana ima transform, pa fixed ne bi pokrio ceo ekran)
    if (on && stg.parentNode !== document.body) { var ph = document.createElement('div'); ph.id = 'rrStagePh'; stg.parentNode.insertBefore(ph, stg); document.body.appendChild(stg); }
    if (!on && $('rrStagePh')) { var ph2 = $('rrStagePh'); ph2.parentNode.insertBefore(stg, ph2); ph2.remove(); }
    stg.classList.toggle('fs', on); $('rrFs').textContent = on ? '✕' : '⛶';
    document.body.classList.toggle('trk-fs-on', on);
    setTimeout(function () { if (S && S.map) S.map.resize(); }, 60);
  }
  function close() {
    if (!S) return;
    clearTimeout(S.timer); if ($('rrStage') && $('rrStage').classList.contains('fs')) setFs(false);
    var st = document.querySelector('body > #rrStage'); if (st) st.remove();
    if (S.map) S.map.remove(); S = null;
  }
  function open(el, race, fleet, meta) {
    close();
    var ids = Object.keys(fleet).filter(function (id) { return fleet[id] && fleet[id].length; });
    var me = meta.me, col = {}, ci = 0; ids.forEach(function (id) { col[id] = id === me ? '#ffffff' : COLORS[ci++ % COLORS.length]; });
    var tMin = race.gun - 30000, tMax = Math.max.apply(null, ids.map(function (id) { var p = fleet[id]; return p[p.length - 1][0]; }));
    el.innerHTML = '<div class="rr-stage" id="rrStage"><div class="rr-map" id="rrMap"><div class="rr-leg" id="rrLeg"></div>' +
      '<div class="trk-fsbtns"><button class="icon-btn" id="rrFs" title="Full screen">⛶</button><button class="icon-btn rr-z" id="rrZin">+</button><button class="icon-btn rr-z" id="rrZout">−</button></div></div>' +
      '<div class="trk-ctrl"><button class="icon-btn" id="rrPlay">▶</button><input type="range" id="rrSl" min="' + tMin + '" max="' + tMax + '" step="1000" value="' + race.gun + '"><button class="icon-btn rr-spd" id="rrSpd">×10</button><button class="icon-btn rr-full" id="rrFull" title="Full tracks / last 5 min">5′</button></div>' +
      '<div class="rr-time" id="rrTime"></div><div class="rr-chips">' + ids.map(function (id) { return '<span class="rr-chip' + (id === me ? ' me' : '') + '"><i style="background:' + col[id] + '"></i><b class="rr-sn">' + esc(meta.short(id)) + '</b> ' + esc(meta.label(id)) + '</span>'; }).join('') +
      '<span class="rr-chip rr-key"><i class="rr-lane-i"></i><span id="rrIdN">AI ideal line (computing…)</span></span><span class="rr-chip rr-key"><i class="rr-best-i"></i>fastest boat of the leg</span></div></div>';
    S = { t: race.gun, playing: false, speed: 10, map: null, mk: {}, race: race, fleet: fleet, legIdx: -1, ideal: null };
    var best = { type: 'FeatureCollection', features: (race.legs || []).map(function (L) { return { type: 'Feature', properties: { n: L.n }, geometry: { type: 'LineString', coordinates: L.lane.map(function (q) { return [q[1], q[0]]; }) } }; }) };
    function idealFc() { return { type: 'FeatureCollection', features: S.ideal ? S.ideal.o.map(function (x, i) { return x && x.path.length > 1 ? { type: 'Feature', properties: { n: race.legs[i].n }, geometry: { type: 'LineString', coordinates: x.path.map(function (q) { return [q[1], q[0]]; }) } } : null; }).filter(Boolean) : [] }; }
    S.setIdeal = function (o, name) {
      S.ideal = o ? { o: o, name: name } : null; var e = $('rrIdN'); if (e) e.textContent = o ? 'AI ideal line · ' + name : 'AI ideal line (computing…)';
      if (S.map && S.ready && S.map.getSource('ideal')) S.map.getSource('ideal').setData(idealFc());
      S.legIdx = -2; setT(S.t);
    };
    function trails(t) {
      return { type: 'FeatureCollection', features: ids.map(function (id) {
        var c = [], from = S && S.full ? -Infinity : t - 5 * 60000; fleet[id].forEach(function (q) { if (q[0] <= t && q[0] >= from) c.push([q[2], q[1]]); });
        return { type: 'Feature', properties: { id: id, me: id === me ? 1 : 0, c: col[id] }, geometry: { type: 'LineString', coordinates: c.length > 1 ? c : [[0, 0], [0, 0]] } };
      }) };
    }
    function legAt(t) { var k = -1; (race.legs || []).forEach(function (L, i) { if (L.t0 <= t) k = i; }); return k; }
    function setT(t) {
      S.t = t; $('rrSl').value = t;
      $('rrTime').textContent = (t < race.gun ? 'start in ' + mmss((race.gun - t) / 1000) : 'race time ' + mmss((t - race.gun) / 1000));
      if (!S.map || !S.ready) return;
      S.map.getSource('tr').setData(trails(t));
      ids.forEach(function (id) { var q = at(fleet[id], t); if (q) S.mk[id].setLngLat([q[2], q[1]]); S.mk[id].getElement().style.opacity = q ? 1 : 0; });
      var k = legAt(t);
      if (k !== S.legIdx) {
        S.legIdx = k; var f = ['==', ['get', 'n'], k >= 0 ? race.legs[k].n : -1];
        ['ideal', 'idealC', 'best'].forEach(function (l) { S.map.setFilter(l, f); });
        var L = race.legs[k], I = S.ideal && S.ideal.o[k];
        $('rrLeg').innerHTML = L ? '<b>LEG ' + L.n + ' ' + (L.up ? '↑ UPWIND' : '↓ DOWNWIND') + '</b>' +
          (I ? '<span class="rr-ideal">AI ideal (' + esc(S.ideal.name) + '): ' + mmss(I.secs) + (I.gain >= 3 ? ' · −' + Math.round(I.gain) + 's' : '') + '</span>' : '') +
          '<span class="rr-bestt">fastest: ' + esc(meta.label(L.best)) + ' ' + mmss(L.bestDur) + '</span>' +
          (L.wind !== null ? '<span>wind ' + ('00' + L.wind).slice(-3) + '° (' + (L.shift > 0 ? '+' : '') + L.shift + '°)' + (L.up && L.fav && L.fav !== 'middle' ? ' · ' + L.fav + ' side paid' : '') + '</span>' : '') : '';
        if (meta.onLeg) meta.onLeg(k);
      }
    }
    function play() {
      S.playing = true; $('rrPlay').textContent = '❚❚';
      var tick = function () { if (!S || !S.playing) return; var nt = S.t + 250 * S.speed; if (nt >= tMax) { setT(tMax); stop(); return; } setT(nt); S.timer = setTimeout(tick, 250); };
      tick();
    }
    function stop() { if (!S) return; S.playing = false; clearTimeout(S.timer); var b = $('rrPlay'); if (b) b.textContent = '▶'; }
    $('rrPlay').addEventListener('click', function () { if (S.playing) stop(); else { if (S.t >= tMax) S.t = tMin; play(); } });
    $('rrSl').addEventListener('input', function (e) { stop(); setT(+e.target.value); });
    $('rrFull').addEventListener('click', function () { S.full = !S.full; $('rrFull').textContent = S.full ? 'ALL' : '5′'; setT(S.t); });
    $('rrSpd').addEventListener('click', function () { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; $('rrSpd').textContent = '×' + S.speed; });
    $('rrFs').addEventListener('click', function (e) { e.stopPropagation(); setFs(!$('rrStage').classList.contains('fs')); });
    $('rrZin').addEventListener('click', function (e) { e.stopPropagation(); if (S.map) S.map.zoomIn(); });
    $('rrZout').addEventListener('click', function (e) { e.stopPropagation(); if (S.map) S.map.zoomOut(); });
    S.goLeg = function (k) { var L = race.legs[k]; if (!L) return; stop(); setT(L.t0); };
    window.Track.lib().then(function () {
      var b = new maplibregl.LngLatBounds(); ids.forEach(function (id) { fleet[id].forEach(function (q) { if (q[0] >= race.gun) b.extend([q[2], q[1]]); }); });
      (race.marks || []).forEach(function (m) { b.extend([m.lon, m.lat]); });
      var map = window.Track.makeMap($('rrMap'), b.getCenter().toArray()); S.map = map;
      map.on('load', function () { map.fitBounds(b, { padding: 30, duration: 0, maxZoom: 17 }); });
      map.on('style.load', function () {
        if (map.getSource('ideal')) return;
        var none = ['==', ['get', 'n'], -1];
        // AI idealna linija: široka fejdovana tirkizna traka + tanka sredina
        map.addSource('ideal', { type: 'geojson', data: idealFc() });
        map.addLayer({ id: 'ideal', type: 'line', source: 'ideal', filter: none, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#00e0c6', 'line-opacity': 0.45, 'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 10, 0.3, 18, 60], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, 1.5, 13, 9, 18, 150] } });
        map.addLayer({ id: 'idealC', type: 'line', source: 'ideal', filter: none, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#00e0c6', 'line-opacity': 0.9, 'line-width': 1.6 } });
        // najbrži brod na legu: zlatna isprekidana
        map.addSource('best', { type: 'geojson', data: best });
        map.addLayer({ id: 'best', type: 'line', source: 'best', filter: none, layout: { 'line-join': 'round' }, paint: { 'line-color': GOLD, 'line-opacity': 0.95, 'line-width': 2.2, 'line-dasharray': [2, 1.6] } });
        map.addSource('mk', { type: 'geojson', data: { type: 'FeatureCollection', features: (race.marks || []).map(function (m) { return { type: 'Feature', properties: { top: m.top ? 1 : 0 }, geometry: { type: 'Point', coordinates: [m.lon, m.lat] } }; }) } });
        map.addLayer({ id: 'mk', type: 'circle', source: 'mk', paint: { 'circle-radius': 5, 'circle-color': ['case', ['==', ['get', 'top'], 1], '#ffb020', '#ff6b00'], 'circle-stroke-width': 2, 'circle-stroke-color': '#05070a' } });
        map.addSource('tr', { type: 'geojson', data: trails(S.t) });
        map.addLayer({ id: 'tr', type: 'line', source: 'tr', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['case', ['==', ['get', 'me'], 1], 3.5, 1.6], 'line-opacity': ['case', ['==', ['get', 'me'], 1], 1, 0.75] } });
        ids.forEach(function (id) {
          var d = document.createElement('div'); d.className = 'rr-boat' + (id === me ? ' me' : ''); d.style.background = col[id]; d.textContent = meta.short(id);
          S.mk[id] = new maplibregl.Marker({ element: d }).setLngLat([fleet[id][0][2], fleet[id][0][1]]).addTo(map);
        });
        S.ready = true; S.legIdx = -2; setT(S.t);
      });
    }).catch(function () { $('rrMap').innerHTML = '<p class="small" style="padding:16px">Map needs internet.</p>'; });
    setT(race.gun);
    return S;
  }
  window.RaceReplay = { open: open, close: close, go: function (k) { if (S && S.goLeg) S.goLeg(k); }, ideal: function (o, name) { if (S && S.setIdeal) S.setIdeal(o, name); } };
})();
