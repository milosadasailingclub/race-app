/* The Race App — Coaching: Race Log (dnevnik). Zapis iz bilo kog traga (snimljenog ili uvezenog GPX/CSV),
   sa izmerenim podacima iz traga, vremenom za taj dan (Open-Meteo arhiva), podešavanjem broda i beleškama. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function toast(m, a, f, ms) { if (window.RA) window.RA.toast(m, a, f, ms); }
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) { toast('Storage full'); } }
  function entries() { return sget('raceLog', []); }
  function saveEntries(a) { sset('raceLog', a); }
  function rad(d) { return d * Math.PI / 180; }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function cmean(a) { var s = 0, c = 0; a.forEach(function (h) { s += Math.sin(rad(h)); c += Math.cos(rad(h)); }); return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360; }
  function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function med(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
  function distM(a, b) { var R6 = 6371000, dLa = rad(b[1] - a[1]), dLo = rad(b[2] - a[2]); var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R6 * Math.asin(Math.sqrt(x)); }
  function bearing(a, b) { var y = Math.sin(rad(b[2] - a[2])) * Math.cos(rad(b[1])), x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[2] - a[2])); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function d3(v) { return v === null || v === undefined || isNaN(v) ? '–––' : ('00' + Math.round(v) % 360).slice(-3); }
  function f1(v) { return v === null || v === undefined || isNaN(v) ? '–' : v.toFixed(1); }
  function compass(d) { return d === null || d === undefined ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8]; }
  function fmtDur(s) { s = Math.round(s); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' h ' + m + ' min' : m + ' min'; }
  function dateTxt(t) { return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  function timeTxt(t) { return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  var SETUP = [['sails', 'Sails'], ['rig', 'Rig / shrouds / rake'], ['crew', 'Crew & weight'], ['other', 'Other settings']];

  /* ---- analiza traga: šta se izmerilo ---- */
  function measure(points) {
    var P = points.filter(function (q) { return q && q[1] !== null && q[2] !== null; });
    var mn = window.Maneuvers ? window.Maneuvers.analyze(P) : null, ax = mn ? mn.axis : null;
    var up = [], dn = [], heelUp = [], mx = 0, d = 0;
    for (var i = 0; i < P.length; i++) {
      var q = P[i]; if (i) d += distM(P[i - 1], q);
      if (q[3] !== null && q[3] > mx) mx = q[3];
      if (ax === null || q[4] === null || q[3] === null || q[3] < 1.5) continue;
      var rel = Math.abs(nrm(q[4] - ax));
      if (rel < 70) { up.push(q[3]); if (q[5] !== null && Math.abs(q[5]) < 40) heelUp.push(Math.abs(q[5])); }
      else if (rel > 110) dn.push(q[3]);
    }
    var tacks = mn ? mn.list.filter(function (m) { return m.kind === 'tack'; }) : [], S = (mn && mn.summary) || {};
    var lat = avg(P.map(function (q) { return q[1]; })), lon = avg(P.map(function (q) { return q[2]; }));
    return {
      start: P.length ? P[0][0] : null, end: P.length ? P[P.length - 1][0] : null, lat: lat, lon: lon,
      dist: d / 1852, max: mx, windDir: ax, up: avg(up), down: avg(dn), heelUp: avg(heelUp), heelUpMax: heelUp.length ? heelUp.slice().sort(function (a, b) { return a - b; })[Math.floor(heelUp.length * 0.95)] : null,
      ta: med(tacks.map(function (m) { return m.turn; })), nTack: S.tack ? S.tack.n : tacks.length, tackLoss: S.tack ? S.tack.avgLoss : null,
      nGybe: S.gybe ? S.gybe.n : 0, gybeLoss: S.gybe ? S.gybe.avgLoss : null, tackRec: S.tack ? S.tack.avgRec : null
    };
  }
  function placeFor(lat, lon) {
    var best = null, bd = 15000;
    var cand = (sget('wxSpots', []) || []).map(function (s) { return { name: s.name, lat: s.lat, lon: s.lon }; })
      .concat((sget('norEvents', []) || []).filter(function (e) { return e.loc; }).map(function (e) { return { name: e.loc.name, lat: e.loc.lat, lon: e.loc.lon }; }));
    cand.forEach(function (c) { var dd = distM([0, lat, lon], [0, c.lat, c.lon]); if (dd < bd) { bd = dd; best = c; } });
    return best ? best.name : lat.toFixed(3) + ', ' + lon.toFixed(3);
  }

  /* ---- vreme za taj dan (Open-Meteo, istorija prognoza; rezervno obična prognoza za skorije dane) ---- */
  function fetchWx(e) {
    var m = e.m; if (!m || m.start === null) return Promise.resolve();
    var day = new Date(m.start).toISOString().slice(0, 10), dayE = new Date(m.end).toISOString().slice(0, 10);
    var q = '?latitude=' + m.lat.toFixed(4) + '&longitude=' + m.lon.toFixed(4) + '&timezone=GMT&wind_speed_unit=kn&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m&start_date=' + day + '&end_date=' + dayE;
    function get(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { if (!j || j.error || !j.hourly) throw new Error((j && j.reason) || 'no data'); return j.hourly; }); }
    return get('https://historical-forecast-api.open-meteo.com/v1/forecast' + q).catch(function () { return get('https://api.open-meteo.com/v1/forecast' + q); }).then(function (H) {
      var t0 = m.start - 1800000, t1 = m.end + 1800000, ws = [], gs = [], ds = [], ts = [];
      H.time.forEach(function (t, i) { var tt = Date.parse(t + ':00Z'); if (tt < t0 || tt > t1) return; if (H.wind_speed_10m[i] !== null) ws.push(H.wind_speed_10m[i]); if (H.wind_gusts_10m[i] !== null) gs.push(H.wind_gusts_10m[i]); if (H.wind_direction_10m[i] !== null) ds.push(H.wind_direction_10m[i]); if (H.temperature_2m[i] !== null) ts.push(H.temperature_2m[i]); });
      if (!ws.length) throw new Error('no data for these hours');
      update(e.id, { wx: { min: Math.min.apply(null, ws), max: Math.max.apply(null, ws), avg: avg(ws), gust: gs.length ? Math.max.apply(null, gs) : null, dir: ds.length ? cmean(ds) : null, temp: avg(ts), at: Date.now() } });
    }).catch(function (err) { update(e.id, { wx: { err: String(err.message || err) } }); });
  }

  /* ---- zapis ---- */
  function update(id, patch) {
    saveEntries(entries().map(function (x) { return x.id === id ? Object.assign(x, patch) : x; }));
    if (cur === id) renderEntry(); else if (cur === null && isOpen()) renderList();
  }
  function addFromTrack(trackId) {
    var ex = entries().filter(function (x) { return x.trackId === trackId; })[0];
    if (ex) { open(ex.id); return Promise.resolve(ex); }
    return window.Track.get(trackId).then(function (t) {
      if (!t || !t.points || t.points.length < 20) { toast('Track too short for the Race Log'); return null; }
      var m = measure(t.points), all = entries(), last = all[0];
      var e = { id: 'l' + Date.now(), trackId: trackId, title: t.name, place: placeFor(m.lat, m.lon), m: m, wx: null,
        setup: last && last.setup ? Object.assign({}, last.setup) : {}, notes: '', result: '', created: Date.now() };
      all.unshift(e); all.sort(function (a, b) { return (b.m.start || 0) - (a.m.start || 0); }); saveEntries(all);
      fetchWx(e); open(e.id); toast('Added to the Race Log' + (last && last.setup ? ' (setup copied from the last entry)' : ''));
      return e;
    });
  }

  /* ---- uvoz GPX / CSV sa drugog uređaja ---- */
  function fillSogCog(P) {
    for (var i = 0; i < P.length; i++) {
      var a = P[Math.max(0, i - 2)], b = P[Math.min(P.length - 1, i + 2)], dt = (b[0] - a[0]) / 1000;
      if ((P[i][3] === null || isNaN(P[i][3])) && dt > 0) P[i][3] = distM(a, b) / dt * 1.943844;
      if ((P[i][4] === null || isNaN(P[i][4])) && distM(a, b) > 2) P[i][4] = bearing(a, b);
    }
    return P;
  }
  function parseGpx(txt) {
    var doc = new DOMParser().parseFromString(txt, 'application/xml'), pts = doc.getElementsByTagName('trkpt');
    if (!pts.length) pts = doc.getElementsByTagName('rtept');
    var P = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], tEl = p.getElementsByTagName('time')[0]; if (!tEl) continue;
      var ext = function (n) { var el = p.getElementsByTagName(n)[0] || p.getElementsByTagName('ra:' + n)[0]; return el ? +el.textContent : null; };
      var sp = ext('sog_kn'); if (sp === null) { var s2 = ext('speed'); if (s2 !== null) sp = s2 * 1.943844; }
      P.push([Date.parse(tEl.textContent), +p.getAttribute('lat'), +p.getAttribute('lon'), sp, ext('cog') !== null ? ext('cog') : ext('course'), ext('heel'), null]);
    }
    var nm = doc.getElementsByTagName('name')[0];
    return { name: nm ? nm.textContent : null, points: fillSogCog(P) };
  }
  function parseCsv(txt) {
    var L = txt.trim().split(/\r?\n/), h = L[0].toLowerCase().split(/[,;\t]/).map(function (s) { return s.trim().replace(/"/g, ''); });
    function col(names) { for (var k = 0; k < names.length; k++) { var i = h.indexOf(names[k]); if (i >= 0) return i; } return -1; }
    var cT = col(['time', 'timestamp', 'datetime', 'date', 'utc']), cLa = col(['lat', 'latitude']), cLo = col(['lon', 'lng', 'long', 'longitude']),
      cS = col(['sog_kn', 'sog', 'speed_kn', 'speed']), cC = col(['cog', 'course', 'heading']), cH = col(['heel']);
    if (cT < 0 || cLa < 0 || cLo < 0) throw new Error('CSV needs time, lat and lon columns');
    var sep = L[0].indexOf(';') >= 0 && L[0].indexOf(',') < 0 ? ';' : L[0].indexOf('\t') >= 0 ? '\t' : ',', P = [];
    for (var r = 1; r < L.length; r++) {
      var c = L[r].split(sep); if (c.length < 3) continue;
      var t = c[cT]; var tt = /^\d+(\.\d+)?$/.test(t) ? (+t < 1e12 ? +t * 1000 : +t) : Date.parse(t);
      var num = function (i) { return i < 0 || c[i] === '' || c[i] === undefined ? null : +c[i]; };
      if (isNaN(tt) || num(cLa) === null) continue;
      P.push([tt, num(cLa), num(cLo), num(cS), num(cC), num(cH), null]);
    }
    return { name: null, points: fillSogCog(P) };
  }
  function importFile(f) {
    return f.text().then(function (txt) {
      var r = /\.gpx$/i.test(f.name) || /<gpx/i.test(txt.slice(0, 500)) ? parseGpx(txt) : parseCsv(txt);
      var P = r.points.filter(function (q) { return !isNaN(q[0]) && !isNaN(q[1]) && !isNaN(q[2]); }).sort(function (a, b) { return a[0] - b[0]; });
      if (P.length < 20) throw new Error('No track points found in ' + f.name);
      var t = { id: 't' + P[0][0] + 'i', name: r.name || f.name.replace(/\.(gpx|csv)$/i, ''), start: P[0][0], end: P[P.length - 1][0], points: P, imported: true };
      t.stats = window.Track.stats(P);
      return window.Track.put(t).then(function () { return addFromTrack(t.id); });
    });
  }

  /* ---- prikaz ---- */
  var cur = null, saveT = null;
  function isOpen() { return document.body.getAttribute('data-view') === 'coaching'; }
  function open(id) { if (window.RA && !isOpen()) window.RA.show('coaching'); cur = id || null; render(); }
  function list() { cur = null; render(); }
  function render() { if (cur) renderEntry(); else renderList(); }
  function wxLine(w) {
    if (!w) return 'Loading weather…';
    if (w.err) return 'Weather not available (' + esc(w.err) + ')';
    return (Math.round(w.min) === Math.round(w.max) ? Math.round(w.min) : Math.round(w.min) + '–' + Math.round(w.max)) + ' kn, gusts ' + (w.gust !== null ? Math.round(w.gust) : '–') + ' · from ' + d3(w.dir) + '° ' + compass(w.dir) + (w.temp !== null ? ' · ' + Math.round(w.temp) + '°C' : '');
  }
  function renderList() {
    $('coTitle').textContent = 'COACHING';
    var q = (sget('coFilter', '') || '').toLowerCase(), all = entries();
    var list = all.filter(function (e) { return !q || [e.title, e.place, e.notes, e.result].join(' ').toLowerCase().indexOf(q) >= 0; });
    var h = '<div class="co-sec"><h3>RACE LOG</h3><p class="small">Every sail you log keeps the track, the measured numbers, the weather of that day, your setup and notes. Next time at the same place you know what worked.</p>' +
      '<div class="row"><button class="btn" id="coAddTrack">+ From a saved track</button><label class="btn co-imp">Import GPX / CSV<input type="file" id="coImport" accept=".gpx,.csv,text/csv,application/gpx+xml" hidden></label></div>' +
      (all.length ? '<input type="search" id="coFilter" class="co-filter" placeholder="Search place, notes… (e.g. Palić)" value="' + esc(q) + '">' : '') + '<div id="coPick"></div>';
    h += list.length ? list.map(function (e) {
      return '<button class="cl-card co-card" data-le="' + e.id + '"><span class="cl-name">' + esc(e.title) + '</span><span class="cl-meta">' + (e.m.start ? dateTxt(e.m.start) : '') + '</span>' +
        '<span class="co-sub">' + esc(e.place) + ' · ' + (e.wx && !e.wx.err ? (Math.round(e.wx.min) === Math.round(e.wx.max) ? Math.round(e.wx.min) : Math.round(e.wx.min) + '–' + Math.round(e.wx.max)) + ' kn ' + compass(e.wx.dir) : (e.m.windDir !== null ? 'wind ~' + d3(e.m.windDir) + '°' : '')) + ' · ' + f1(e.m.dist) + ' NM</span></button>';
    }).join('') : '<p class="small">' + (all.length ? 'Nothing matches.' : 'No entries yet. Add one from a saved track or import a GPX / CSV from another device.') + '</p>';
    h += '</div><div class="co-sec co-soon"><h3>TRAINING SESSIONS</h3><p class="small">Coming soon: tack and gybe drills with entry / exit speed, acceleration and start drills.</p></div>';
    $('coBody').innerHTML = h;
  }
  function renderEntry() {
    var e = entries().filter(function (x) { return x.id === cur; })[0]; if (!e) { cur = null; renderList(); return; }
    $('coTitle').textContent = 'RACE LOG';
    var m = e.m, w = e.wx;
    function tile(l, v) { return '<div><em>' + l + '</em><b>' + v + '</b></div>'; }
    var h = '<input class="co-title" data-f="title" value="' + esc(e.title) + '">' +
      '<div class="co-when">' + (m.start ? dateTxt(m.start) + ' · ' + timeTxt(m.start) + '–' + timeTxt(m.end) + ' · ' + fmtDur((m.end - m.start) / 1000) : '') + '</div>' +
      '<label class="co-lbl">Place<input data-f="place" value="' + esc(e.place) + '"></label>' +
      '<div class="co-sec"><h3>WEATHER THAT DAY</h3><p class="co-wx">' + wxLine(w) + '</p>' + (w && w.err ? '<button class="btn" id="coWxRetry">Try again</button>' : '') +
      (m.windDir !== null ? '<p class="small">Wind measured from your tacks: <b>' + d3(m.windDir) + '° ' + compass(m.windDir) + '</b>' + (w && !w.err && w.dir !== null ? ' (forecast ' + d3(w.dir) + '°, ' + (nrm(m.windDir - w.dir) >= 0 ? '+' : '') + Math.round(nrm(m.windDir - w.dir)) + '°)' : '') + '</p>' : '') + '</div>' +
      '<div class="co-sec"><h3>MEASURED</h3><div class="co-tiles">' +
      tile('UPWIND kn', f1(m.up)) + tile('DOWNWIND kn', f1(m.down)) + tile('MAX kn', f1(m.max)) + tile('DIST NM', f1(m.dist)) +
      tile('TACK ANGLE', m.ta !== null ? Math.round(m.ta) + '°' : '–') + tile('HEEL UP', m.heelUp !== null ? Math.round(m.heelUp) + '°' : '–') +
      tile('TACKS', m.nTack + (m.tackLoss !== null ? ' · ' + (m.tackLoss > 0 ? '−' : '+') + Math.abs(Math.round(m.tackLoss)) + ' m' : '')) +
      tile('GYBES', m.nGybe + (m.gybeLoss !== null ? ' · ' + (m.gybeLoss > 0 ? '−' : '+') + Math.abs(Math.round(m.gybeLoss)) + ' m' : '')) + '</div>' +
      '<button class="btn" id="coOpenTrk">Open track replay</button></div>' +
      '<div class="co-sec"><h3>SETUP</h3>' + SETUP.map(function (s) { return '<label class="co-lbl">' + s[1] + '<input data-s="' + s[0] + '" value="' + esc((e.setup || {})[s[0]] || '') + '"></label>'; }).join('') + '</div>' +
      '<div class="co-sec"><h3>RESULT</h3><input class="co-full" data-f="result" placeholder="e.g. 3rd of 12, race 2: 1st" value="' + esc(e.result) + '"></div>' +
      '<div class="co-sec"><h3>NOTES</h3><textarea data-f="notes" rows="7" placeholder="What worked, what did not, which side paid, crew notes…">' + esc(e.notes) + '</textarea></div>' +
      '<div class="row"><button class="btn danger" id="coDel">Delete entry</button></div>';
    $('coBody').innerHTML = h;
  }
  function onInput(ev) {
    var el = ev.target, f = el.getAttribute && (el.getAttribute('data-f') || el.getAttribute('data-s')); if (!f || !cur) return;
    var isS = el.hasAttribute('data-s'), val = el.value, id = cur;
    saveEntries(entries().map(function (x) { if (x.id !== id) return x; if (isS) { x.setup = Object.assign({}, x.setup); x.setup[f] = val; } else x[f] = val; return x; }));
  }
  function onClick(ev) {
    var b = ev.target.closest('button, [data-le]'); if (!b) return;
    if (b.hasAttribute('data-le')) { cur = b.getAttribute('data-le'); render(); window.scrollTo(0, 0); return; }
    if (b.hasAttribute('data-pick')) { addFromTrack(b.getAttribute('data-pick')); return; }
    if (b.id === 'coAddTrack') {
      var used = entries().map(function (x) { return x.trackId; });
      window.Track.all().then(function (a) {
        var free = a.filter(function (t) { return used.indexOf(t.id) < 0 && t.points && t.points.length >= 20; });
        $('coPick').innerHTML = free.length ? '<p class="small">Pick a track:</p>' + free.map(function (t) { return '<button class="cl-card" data-pick="' + t.id + '"><span class="cl-name">' + esc(t.name) + '</span><span class="cl-meta">' + ((t.stats && t.stats.dist) || 0).toFixed(2) + ' NM</span></button>'; }).join('') : '<p class="small">All saved tracks are already in the Race Log.</p>';
      });
      return;
    }
    if (b.id === 'coOpenTrk') { var e = entries().filter(function (x) { return x.id === cur; })[0]; if (e) window.Track.open(e.trackId); return; }
    if (b.id === 'coWxRetry') { var e2 = entries().filter(function (x) { return x.id === cur; })[0]; if (e2) { update(e2.id, { wx: null }); fetchWx(e2); } return; }
    if (b.id === 'coDel') { var id = cur; toast('Delete this entry? The track stays in Tracking.', 'Delete', function () { saveEntries(entries().filter(function (x) { return x.id !== id; })); cur = null; renderList(); }, 4000); }
  }
  function init() {
    var body = $('coBody'); if (!body) return;
    body.addEventListener('input', function (ev) { if (ev.target.id === 'coFilter') { sset('coFilter', ev.target.value); var p = ev.target.selectionStart; renderList(); var f = $('coFilter'); if (f) { f.focus(); try { f.setSelectionRange(p, p); } catch (e) {} } return; } onInput(ev); });
    body.addEventListener('click', onClick);
    body.addEventListener('change', function (ev) {
      if (ev.target.id !== 'coImport' || !ev.target.files.length) return;
      var f = ev.target.files[0]; toast('Importing ' + f.name + '…');
      importFile(f).catch(function (err) { toast('Import failed: ' + err.message, null, null, 5000); });
    });
    $('coBack').addEventListener('click', function () { if (cur) { cur = null; renderList(); } else window.RA.show('menu'); });
  }
  init();
  window.Coach = { open: open, list: list, addFromTrack: addFromTrack, _measure: measure, _parseGpx: parseGpx, _parseCsv: parseCsv };
})();
