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
    el.innerHTML = '<div class="rr-stage" id="rrStage"><div class="rr-map" id="rrMap">' +
      '<div class="trk-fsbtns"><button class="icon-btn" id="rrFs" title="Full screen">⛶</button><button class="icon-btn rr-z" id="rrZin">+</button><button class="icon-btn rr-z" id="rrZout">−</button><button class="icon-btn rr-wbtn" id="rrWind" title="Wind field" hidden><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="pointer-events:none;display:block;margin:auto"><path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/></svg></button><button class="icon-btn rr-wbtn rr-ibtn" id="rrIdB" title="AI ideal line"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;display:block;margin:auto"><path d="M7 11.5v7.5h4.5z" fill="currentColor" stroke="none"/><path d="M6.2 11v8.6"/><path d="M3.2 20.3h9.4l-1.6 2H4.8z" fill="currentColor" stroke="none"/><path d="M13.5 19.5c4.5 0 5.5-3 2.5-5s-2-5 2-5.5" stroke-dasharray="1.6 2.2"/><path d="M19 1.8a3.4 3.4 0 0 1 3.4 3.4c0 2.5-3.4 5.6-3.4 5.6s-3.4-3.1-3.4-5.6A3.4 3.4 0 0 1 19 1.8z" fill="currentColor" stroke="none"/><circle cx="19" cy="5.2" r="1.25" fill="#05070a" stroke="none"/></svg></button></div></div>' +
      '<div class="rr-vid" id="rrVid" hidden></div><div class="rr-vtel" id="rrVtel" hidden></div>' +
      '<div class="trk-ctrl"><button class="icon-btn" id="rrPlay">▶</button><input type="range" id="rrSl" min="' + tMin + '" max="' + tMax + '" step="1000" value="' + race.gun + '"><button class="icon-btn rr-spd" id="rrSpd">×10</button><button class="icon-btn rr-full" id="rrFull" title="Trail length: 5, 10, 15 min, this leg, all">5′</button></div>' +
      '<div class="rr-time" id="rrTime"></div><div class="rr-leg" id="rrLeg"></div><div class="rr-chips">' +
      '<span class="rr-chip rr-key"><i class="rr-lane-i"></i><span id="rrIdN">AI ideal line (computing…)</span></span><span class="rr-chip rr-key"><i class="rr-best-i"></i>fastest boat of the leg</span></div>' +
      '<div class="rr-wkey" id="rrWKey" hidden><span>less wind</span><i></i><span>more wind</span><small>colour = where there is more / less wind than on the rest of the course at that moment (from boat speeds) · arrows = wind direction</small></div></div>';
    S = { trail: '5', t: race.gun, playing: false, speed: 10, map: null, mk: {}, race: race, fleet: fleet, legIdx: -1, ideal: null };
    var best = { type: 'FeatureCollection', features: (race.legs || []).map(function (L) { return { type: 'Feature', properties: { n: L.n }, geometry: { type: 'LineString', coordinates: L.lane.map(function (q) { return [q[1], q[0]]; }) } }; }) };
    function idealFc() { return { type: 'FeatureCollection', features: S.ideal ? S.ideal.o.map(function (x, i) { return x && x.path.length > 1 ? { type: 'Feature', properties: { n: race.legs[i].n }, geometry: { type: 'LineString', coordinates: x.path.map(function (q) { return [q[1], q[0]]; }) } } : null; }).filter(Boolean) : [] }; }
    S.setIdeal = function (o, name) {
      S.ideal = o ? { o: o, name: name } : null; var e = $('rrIdN'); if (e) e.textContent = o ? 'AI ideal line · ' + name : 'AI ideal line (computing…)';
      if (S.map && S.ready && S.map.getSource('ideal')) S.map.getSource('ideal').setData(idealFc());
      S.legIdx = -2; setT(S.t);
    };
    S.wOn = true; S.fKey = null;
    if (window.CamRec) CamRec.attach($('rrVid'), tMin, tMax).then(function (n) { S.vid = n > 0; if (n) { var k = $('rrIdN'); setT(S.t); } });
    function drawField(t) {
      if (!S.fieldFn || !S.map || !S.ready || !S.map.getSource('wa')) return;
      var F = S.fieldFn(t); if (F.key === S.fKey) return; S.fKey = F.key;
      var m = S.map;
      if (F.img) {
        if (!m.getSource('wf')) {
          m.addSource('wf', { type: 'image', url: F.img, coordinates: F.coords });
          m.addLayer({ id: 'wf', type: 'raster', source: 'wf', layout: { visibility: S.wOn ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.55, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, 'wa');
        } else m.getSource('wf').updateImage({ url: F.img, coordinates: F.coords });
      }
      m.getSource('wa').setData(F.arrows);
      if (S.probeAt) showProbe();
    }
    // dodir na mapi: smer i relativna jačina vetra u toj tački, osvežava se kako replay ide
    function showProbe() {
      if (!S.probeFn || !S.probeAt || !S.map) return;
      var q = S.probeFn(S.t, S.probeAt[1], S.probeAt[0]), h;
      if (!q || q.conf < 0.1) h = '<b>No boats here</b><span>no wind data at this time</span>';
      else {
        var pc = q.p === null ? null : Math.round((q.p - 1) * 100);
        h = '<b>Wind ' + ('00' + q.dir).slice(-3) + '°</b>' +
          '<span>' + (Math.abs(q.shift) < 2 ? 'same direction as the rest of the course' : Math.abs(q.shift) + '° ' + (q.shift > 0 ? 'to the right (veered)' : 'to the left (backed)') + ' vs. the rest of the course') + '</span>' +
          '<span>' + (pc === null ? '–' : Math.abs(pc) < 2 ? 'pressure like the rest of the course' : (pc > 0 ? 'more' : 'less') + ' pressure than the rest of the course (' + (pc > 0 ? '+' : '−') + Math.abs(pc) + '%)') + '</span>' +
          (q.conf < 0.5 ? '<span class="rr-pq">few boats here, rough estimate</span>' : '');
      }
      if (!S.pop) { S.pop = new maplibregl.Popup({ closeButton: true, closeOnClick: false, className: 'rr-pop', offset: 8 }); S.pop.on('close', function () { if (S) { S.probeAt = null; S.pop = null; } }); }
      S.pop.setLngLat(S.probeAt).setHTML(h); if (!S.pop.isOpen()) S.pop.addTo(S.map);
    }
    S.setField = function (fn, probe) {
      S.probeFn = probe || null; S.fieldFn = fn; S.fKey = null; if (!$('rrWind')) return; $('rrWind').hidden = !fn; $('rrWKey').hidden = !fn || !S.wOn; drawField(S.t);
    };
    function trails(t) {
      return { type: 'FeatureCollection', features: ids.map(function (id) {
        var c = [], tr = S ? S.trail : '5', from = tr === 'all' ? -Infinity : tr === 'leg' ? legStart(t) : t - (+tr || 5) * 60000; fleet[id].forEach(function (q) { if (q[0] <= t && q[0] >= from) c.push([q[2], q[1]]); });
        return { type: 'Feature', properties: { id: id, me: id === me ? 1 : 0, c: col[id] }, geometry: { type: 'LineString', coordinates: c.length > 1 ? c : [[0, 0], [0, 0]] } };
      }) };
    }
    function legStart(t) { var k = legAt(t); return k >= 0 ? race.legs[k].t0 : race.gun - 60000; }
    function legAt(t) { var k = -1; (race.legs || []).forEach(function (L, i) { if (L.t0 <= t) k = i; }); return k; }
    function setT(t) {
      S.t = t; $('rrSl').value = t;
      // video sa telefona (ako postoji za ovaj trenutak) + brzina i kurs moje jedrilice u istom trenutku
      if (window.CamRec && S.vid) { CamRec.sync(t, S.playing, S.speed); var vb = $('rrVid'), vt = $('rrVtel'); if (vb && vt) { vt.hidden = vb.hidden; if (!vb.hidden && me && fleet[me]) { var a0 = at(fleet[me], t - 2000), a1 = at(fleet[me], t + 2000); if (a0 && a1 && a1[0] > a0[0]) { var dy = (a1[1] - a0[1]) * 111120, dx = (a1[2] - a0[2]) * 111120 * Math.cos(a0[1] * Math.PI / 180), d = Math.hypot(dx, dy); vt.innerHTML = '<span>SOG <b>' + (d / ((a1[0] - a0[0]) / 1000) * 1.943844).toFixed(1) + '</b> kn</span><span>COG <b>' + ('00' + Math.round((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360)).slice(-3) + '°</b></span>'; } } } }
      $('rrTime').textContent = (t < race.gun ? 'start in ' + mmss((race.gun - t) / 1000) : 'race time ' + mmss((t - race.gun) / 1000));
      if (!S.map || !S.ready) return;
      if (S.wOn) drawField(t); else if (S.probeAt) showProbe();
      S.map.getSource('tr').setData(trails(t));
      ids.forEach(function (id) { var q = at(fleet[id], t); if (q) S.mk[id].setLngLat([q[2], q[1]]); S.mk[id].getElement().style.opacity = q ? 1 : 0; });
      var k = legAt(t);
      if (k !== S.legIdx) {
        S.legIdx = k; var f = ['==', ['get', 'n'], k >= 0 ? race.legs[k].n : -1];
        ['ideal', 'idealC', 'best'].forEach(function (l) { S.map.setFilter(l, f); });
        var L = race.legs[k], I = S.ideal && S.ideal.o[k];
        $('rrLeg').innerHTML = L ? '<b>LEG ' + L.n + ' ' + (L.up ? '↑ UPWIND' : '↓ DOWNWIND') + '</b>' +
          (I ? '<span class="rr-ideal">AI ideal: ' + mmss(I.secs) + (I.gain >= 3 ? ' · −' + Math.round(I.gain) + 's' : '') + '</span>' : '') +
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
    // dužina tragova: 5 / 10 / 15 min, tekući leg, ceo trag
    var TRAILS = [['5', '5′'], ['10', '10′'], ['15', '15′'], ['leg', 'LEG'], ['all', 'ALL']];
    $('rrFull').addEventListener('click', function () { var i = TRAILS.map(function (x) { return x[0]; }).indexOf(S.trail); S.trail = TRAILS[(i + 1) % TRAILS.length][0]; $('rrFull').textContent = TRAILS[(i + 1) % TRAILS.length][1]; setT(S.t); });
    $('rrSpd').addEventListener('click', function () { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; $('rrSpd').textContent = '×' + S.speed; });
    $('rrFs').addEventListener('click', function (e) { e.stopPropagation(); setFs(!$('rrStage').classList.contains('fs')); });
    $('rrZin').addEventListener('click', function (e) { e.stopPropagation(); if (S.map) S.map.zoomIn(); });
    $('rrWind').addEventListener('click', function (e) {
      e.stopPropagation(); S.wOn = !S.wOn; $('rrWind').classList.toggle('off', !S.wOn); $('rrWKey').hidden = !S.wOn;
      if (S.map && S.ready) ['wf', 'wa'].forEach(function (l) { if (S.map.getLayer(l)) S.map.setLayoutProperty(l, 'visibility', S.wOn ? 'visible' : 'none'); });
      S.fKey = null; if (S.wOn) drawField(S.t);
    });
    $('rrZout').addEventListener('click', function (e) { e.stopPropagation(); if (S.map) S.map.zoomOut(); });
    // AI idealna linija: uključi / isključi (pamti se)
    S.iOn = (function () { try { return localStorage.getItem('ra.rrIdeal') !== 'false'; } catch (x) { return true; } })();
    function applyIdeal() { var b = $('rrIdB'); if (b) b.classList.toggle('off', !S.iOn); var k = document.querySelector('#rrStage .rr-lane-i'); if (k && k.parentNode) k.parentNode.style.opacity = S.iOn ? '' : '.35'; if (S.map && S.ready) ['ideal', 'idealC'].forEach(function (l) { if (S.map.getLayer(l)) S.map.setLayoutProperty(l, 'visibility', S.iOn ? 'visible' : 'none'); }); }
    $('rrIdB').addEventListener('click', function (e) { e.stopPropagation(); S.iOn = !S.iOn; try { localStorage.setItem('ra.rrIdeal', S.iOn ? 'true' : 'false'); } catch (x) {} applyIdeal(); });
    S.applyIdeal = applyIdeal; applyIdeal();
    S.goLeg = function (k) { var L = race.legs[k]; if (!L) return; stop(); setT(L.t0); };
    window.Track.lib().then(function () {
      var b = new maplibregl.LngLatBounds(); ids.forEach(function (id) { fleet[id].forEach(function (q) { if (q[0] >= race.gun) b.extend([q[2], q[1]]); }); });
      (race.marks || []).forEach(function (m) { b.extend([m.lon, m.lat]); });
      var map = window.Track.makeMap($('rrMap'), b.getCenter().toArray()); S.map = map;
      map.on('load', function () { map.fitBounds(b, { padding: 30, duration: 0, maxZoom: 17 }); });
      map.on('style.load', function () {
        if (map.getSource('ideal')) return;
        var none = ['==', ['get', 'n'], -1], empty = { type: 'FeatureCollection', features: [] };
        // polje vetra: boja = koliko su brodovi tu išli brže/sporije od svog proseka (pritisak), strelice = smer vetra
        if (!map.hasImage('wArrow')) {
          var cv = document.createElement('canvas'); cv.width = cv.height = 32; var g = cv.getContext('2d');
          g.strokeStyle = 'rgba(255,255,255,.85)'; g.fillStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.5; g.lineCap = 'round';
          g.beginPath(); g.moveTo(16, 27); g.lineTo(16, 8); g.stroke(); g.beginPath(); g.moveTo(16, 3); g.lineTo(10, 12); g.lineTo(22, 12); g.closePath(); g.fill();
          map.addImage('wArrow', { width: 32, height: 32, data: g.getImageData(0, 0, 32, 32).data });
        }
        map.addSource('wa', { type: 'geojson', data: empty });
        map.addLayer({ id: 'wa', type: 'symbol', source: 'wa', layout: { 'icon-image': 'wArrow', 'icon-rotate': ['get', 'r'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.2, 15, 0.38, 18, 0.7] }, paint: { 'icon-opacity': ['*', 0.85, ['get', 'a']] } });
        map.on('click', function (e) { if (!S.probeFn) return; S.probeAt = [e.lngLat.lng, e.lngLat.lat]; showProbe(); });
        // AI idealna linija: široka fejdovana tirkizna traka + tanka sredina
        map.addSource('ideal', { type: 'geojson', data: idealFc() });
        map.addLayer({ id: 'ideal', type: 'line', source: 'ideal', filter: none, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#00e0c6', 'line-opacity': 0.45, 'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 10, 0.3, 18, 60], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10, 1.5, 13, 9, 18, 150] } });
        map.addLayer({ id: 'idealC', type: 'line', source: 'ideal', filter: none, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#00e0c6', 'line-opacity': 0.9, 'line-width': 1.6 } });
        if (S.applyIdeal) setTimeout(S.applyIdeal, 0);
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
  window.RaceReplay = { open: open, close: close, go: function (k) { if (S && S.goLeg) S.goLeg(k); }, ideal: function (o, name) { if (S && S.setIdeal) S.setIdeal(o, name); }, field: function (fn, probe) { if (S && S.setField) S.setField(fn, probe); } };
})();
