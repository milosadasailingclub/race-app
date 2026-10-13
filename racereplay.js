/* The Race App — replay cele flote za jednu trku + "idealna traka" po legu (trag broda koji je leg odjedrio najbrže) */
(function () {
  'use strict';
  var COLORS = ['#9b3bff', '#ff2e93', '#ffb020', '#3da5ff', '#7cfc00', '#ff6b6b', '#c8c8c8', '#00b3a4', '#ffd6e8', '#a0ffa0'];
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mmss(s) { s = Math.round(s); var neg = s < 0; s = Math.abs(s); return (neg ? '−' : '') + Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function at(P, t) { var lo = 0, hi = P.length - 1; if (!P.length || t < P[0][0]) return null; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (P[m][0] <= t) lo = m; else hi = m - 1; } return P[lo]; }
  var S = null;
  function close() { if (S) { clearTimeout(S.timer); if (S.map) S.map.remove(); S = null; } }
  function open(el, race, fleet, meta) {
    close();
    var ids = Object.keys(fleet).filter(function (id) { return fleet[id] && fleet[id].length; });
    var me = meta.me, col = {}, ci = 0; ids.forEach(function (id) { col[id] = id === me ? '#ffffff' : COLORS[ci++ % COLORS.length]; });
    var tMin = race.gun - 30000, tMax = Math.max.apply(null, ids.map(function (id) { var p = fleet[id]; return p[p.length - 1][0]; }));
    el.innerHTML = '<div class="rr-stage"><div class="rr-map" id="rrMap"><div class="rr-leg" id="rrLeg"></div></div>' +
      '<div class="trk-ctrl"><button class="icon-btn" id="rrPlay">▶</button><input type="range" id="rrSl" min="' + tMin + '" max="' + tMax + '" step="1000" value="' + race.gun + '"><button class="icon-btn" id="rrSpd">×30</button><button class="icon-btn rr-full" id="rrFull" title="Full tracks / last 5 min">5′</button></div>' +
      '<div class="rr-time" id="rrTime"></div><div class="rr-chips">' + ids.map(function (id) { return '<span class="rr-chip' + (id === me ? ' me' : '') + '"><i style="background:' + col[id] + '"></i>' + esc(meta.label(id)) + '</span>'; }).join('') +
      '<span class="rr-chip"><i class="rr-lane-i"></i>fastest lane of the leg</span><span class="rr-chip"><i class="rr-ideal-i"></i><span id="rrIdN">AI ideal line</span></span></div></div>';
    S = { t: race.gun, playing: false, speed: 30, map: null, mk: {}, race: race, fleet: fleet, legIdx: -1, ideal: null };
    var lanes = { type: 'FeatureCollection', features: (race.legs || []).map(function (L) { return { type: 'Feature', properties: { n: L.n }, geometry: { type: 'LineString', coordinates: L.lane.map(function (q) { return [q[1], q[0]]; }) } }; }) };
    function trails(t) {
      return { type: 'FeatureCollection', features: ids.map(function (id) {
        var c = [], from = S && S.full ? -Infinity : t - 5 * 60000; fleet[id].forEach(function (q) { if (q[0] <= t && q[0] >= from) c.push([q[2], q[1]]); });
        return { type: 'Feature', properties: { id: id, me: id === me ? 1 : 0, c: col[id] }, geometry: { type: 'LineString', coordinates: c.length > 1 ? c : [[0, 0], [0, 0]] } };
      }) };
    }
    function idealFc() { return { type: 'FeatureCollection', features: S.ideal ? S.ideal.o.map(function (x, i) { return x ? { type: 'Feature', properties: { n: race.legs[i].n }, geometry: { type: 'LineString', coordinates: x.path.map(function (q) { return [q[1], q[0]]; }) } } : null; }).filter(Boolean) : [] }; }
    S.setIdeal = function (o, name) { S.ideal = o ? { o: o, name: name } : null; var e = $('rrIdN'); if (e) e.textContent = o ? 'AI ideal line · ' + name : 'AI ideal line (computing…)'; if (S.map && S.ready && S.map.getSource('ideal')) { S.map.getSource('ideal').setData(idealFc()); } S.legIdx = -2; setT(S.t); };
    function legAt(t) { var k = -1; (race.legs || []).forEach(function (L, i) { if (L.t0 <= t) k = i; }); return k; }
    function setT(t) {
      S.t = t; $('rrSl').value = t;
      $('rrTime').textContent = (t < race.gun ? 'start in ' + mmss((race.gun - t) / 1000) : 'race time ' + mmss((t - race.gun) / 1000));
      if (!S.map || !S.ready) return;
      S.map.getSource('tr').setData(trails(t));
      ids.forEach(function (id) { var q = at(fleet[id], t); if (q) S.mk[id].setLngLat([q[2], q[1]]); S.mk[id].getElement().style.opacity = q ? 1 : 0; });
      var k = legAt(t);
      if (k !== S.legIdx) {
        S.legIdx = k;
        S.map.setFilter('lane', ['==', ['get', 'n'], k >= 0 ? race.legs[k].n : -1]); S.map.setFilter('laneC', ['==', ['get', 'n'], k >= 0 ? race.legs[k].n : -1]); S.map.setFilter('ideal', ['==', ['get', 'n'], k >= 0 ? race.legs[k].n : -1]);
        var L = race.legs[k];
        $('rrLeg').innerHTML = L ? '<b>LEG ' + L.n + ' ' + (L.up ? '↑ UPWIND' : '↓ DOWNWIND') + '</b><span>fastest: ' + esc(meta.label(L.best)) + ' ' + mmss(L.bestDur) + '</span>' +
          (L.wind !== null ? '<span>wind ' + ('00' + L.wind).slice(-3) + '° (' + (L.shift > 0 ? '+' : '') + L.shift + '°)' + (L.up && L.fav && L.fav !== 'middle' ? ' · ' + L.fav + ' side paid' : '') + '</span>' : '') + (S.ideal && S.ideal.o[k] ? '<span class="rr-ideal">AI ideal ' + esc(S.ideal.name) + ': ' + mmss(S.ideal.o[k].secs) + (S.ideal.o[k].gain >= 3 ? ' (−' + Math.round(S.ideal.o[k].gain) + 's)' : '') + '</span>' : '') : '';
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
    $('rrSpd').addEventListener('click', function () { S.speed = S.speed === 30 ? 60 : S.speed === 60 ? 10 : 30; $('rrSpd').textContent = '×' + S.speed; });
    S.goLeg = function (k) { var L = race.legs[k]; if (!L) return; stop(); setT(L.t0); };
    window.Track.lib().then(function () {
      var b = new maplibregl.LngLatBounds(); ids.forEach(function (id) { fleet[id].forEach(function (q) { if (q[0] >= race.gun) b.extend([q[2], q[1]]); }); });
      (race.marks || []).forEach(function (m) { b.extend([m.lon, m.lat]); });
      var map = window.Track.makeMap($('rrMap'), b.getCenter().toArray()); S.map = map;
      map.on('load', function () { map.fitBounds(b, { padding: 30, duration: 0, maxZoom: 17 }); });
      map.on('style.load', function () {
        if (map.getSource('lane')) return;
        map.addSource('lane', { type: 'geojson', data: lanes });
        // široka fejdovana tirkizna traka (~70 m) + tanka sredina
        map.addLayer({ id: 'lane', type: 'line', source: 'lane', filter: ['==', ['get', 'n'], -1], layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#00e0c6', 'line-opacity': 0.4, 'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 10, 0.3, 18, 70], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, 1.5, 13, 10, 18, 170] } });
        map.addLayer({ id: 'laneC', type: 'line', source: 'lane', filter: ['==', ['get', 'n'], -1], paint: { 'line-color': '#00e0c6', 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [2, 2] } });
        map.addSource('ideal', { type: 'geojson', data: idealFc() });
        map.addLayer({ id: 'ideal', type: 'line', source: 'ideal', filter: ['==', ['get', 'n'], -1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': 2.2, 'line-dasharray': [1.5, 1.5] } });
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
  function $(id) { return document.getElementById(id); }
  window.RaceReplay = { open: open, close: close, go: function (k) { if (S && S.goLeg) S.goLeg(k); }, ideal: function (o, name) { if (S && S.setIdeal) S.setIdeal(o, name); } };
})();
