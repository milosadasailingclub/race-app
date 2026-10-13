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
  function measure(points, t) {
    t = t || {};
    var P = points.filter(function (q) { return q && q[1] !== null && q[2] !== null; });
    if (t.raceStart) P = P.filter(function (q) { return q[0] >= t.raceStart - 60000 && (!t.raceEnd || q[0] <= t.raceEnd); }); // samo trka (uvezeni podaci sa regate)
    var mn = window.Maneuvers ? window.Maneuvers.analyze(P, t.axis !== undefined && t.axis !== null ? { axis: t.flip ? (t.axis + 180) % 360 : t.axis } : { upAt: t.raceStart || null, flip: !!t.flip }) : null, ax = mn ? mn.axis : null;
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
  function addFromTrack(trackId, o) {
    o = o || {};
    var ex = entries().filter(function (x) { return x.trackId === trackId; })[0];
    if (ex) { if (!o.silent) open(ex.id); return Promise.resolve(ex); }
    return window.Track.get(trackId).then(function (t) {
      if (!t || !t.points || t.points.length < 20) { toast('Track too short for the Race Log'); return null; }
      var m = measure(t.points, t), all = entries(), last = all[0];
      var e = { id: 'l' + Date.now() + Math.floor(Math.random() * 1000), trackId: trackId, title: t.name, place: o.place || placeFor(m.lat, m.lon), m: m, wx: null,
        setup: last && last.setup ? Object.assign({}, last.setup) : {}, notes: '', result: t.place ? t.place + ' of ' + t.fleet : (t.fleet ? 'not finished (' + t.fleet + ' boats)' : ''), created: Date.now(), regatta: o.regatta || null, raceN: o.raceN || null };
      all.unshift(e); all.sort(function (a, b) { return (b.m.start || 0) - (a.m.start || 0); }); saveEntries(all);
      fetchWx(e); if (o.silent) return e;
      open(e.id); toast('Added to the Race Log' + (last && last.setup ? ' (setup copied from the last entry)' : ''));
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
      cS = col(['sog_kn', 'sog', 'speed_kn', 'speed']), cC = col(['cog', 'course', 'heading']), cH = col(['heel']), cDev = col(['deviceid', 'device', 'boat', 'boatid', 'tracker']), cSt = col(['standing', 'rank', 'position']), boats = {};
    if (cT < 0 || cLa < 0 || cLo < 0) throw new Error('CSV needs time, lat and lon columns');
    var sep = L[0].indexOf(';') >= 0 && L[0].indexOf(',') < 0 ? ';' : L[0].indexOf('\t') >= 0 ? '\t' : ',', P = [];
    for (var r = 1; r < L.length; r++) {
      var c = L[r].split(sep); if (c.length < 3) continue;
      var t = c[cT]; var tt = /^\d+(\.\d+)?$/.test(t) ? (+t < 1e12 ? +t * 1000 : +t) : parseTime(t);
      var num = function (i) { return i < 0 || c[i] === '' || c[i] === undefined ? null : +c[i]; };
      if (isNaN(tt) || num(cLa) === null) continue;
      var pt = [tt, num(cLa), num(cLo), num(cS), num(cC), num(cH), null];
      if (cDev >= 0) { var id = c[cDev], B = boats[id] || (boats[id] = { id: id, P: [], s0: null, s1: null, fin: null }); B.P.push(pt); var sv = num(cSt); if (sv !== null) { if (B.s0 === null) B.s0 = tt; B.s1 = tt; B.fin = sv; } }
      else P.push(pt);
    }
    if (cDev >= 0) {
      // više brodova u jednom fajlu (npr. izvoz sa sistema za praćenje regata): bira se brod
      var list = Object.keys(boats).map(function (k) { var B = boats[k]; B.P.sort(function (a, b) { return a[0] - b[0]; }); B.avg = avg(B.P.map(function (q) { return q[3] || 0; })); return B; })
        .filter(function (B) { return B.P.length >= 20 && B.avg >= 1; }).sort(function (a, b) { return (a.fin || 99) - (b.fin || 99); });
      return { name: null, boats: list };
    }
    return { name: null, points: fillSogCog(P) };
  }
  function parseTime(t) {
    var s = String(t).trim().replace(/"/g, '');
    if (/^\d{4}-\d\d-\d\d[ T]\d/.test(s)) { s = s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'); if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z'; }
    return Date.parse(s);
  }
  function importFile(f) {
    return readFile(f).then(function (txt) {
      var r = /\.gpx$/i.test(f.name) || /<gpx/i.test(txt.slice(0, 500)) ? parseGpx(txt) : parseCsv(txt);
      if (r.boats) {
        if (!r.boats.length) throw new Error('No moving boats found in ' + f.name);
        pendingImp = { name: f.name.replace(/\.(gpx|csv)$/i, ''), boats: r.boats };
        $('coPick').innerHTML = '<p class="small">This file has ' + r.boats.length + ' boats. Which one is yours?</p>' + r.boats.map(function (B, i) {
          return '<button class="cl-card" data-boat="' + i + '"><span class="cl-name">' + (B.fin ? '#' + B.fin + ' · ' : '') + 'Boat ' + esc(B.id) + '</span><span class="cl-meta">avg ' + B.avg.toFixed(1) + ' kn</span></button>';
        }).join('');
        toast('Pick your boat');
        return null;
      }
      return saveImported(r.points, r.name || f.name.replace(/\.(gpx|csv)$/i, ''), {});
    });
  }
  var pendingImp = null;
  function importBoat(i) {
    var B = pendingImp && pendingImp.boats[i]; if (!B) return;
    var others = pendingImp.boats.filter(function (x) { return x !== B; }).map(function (x) { return { id: x.id, fin: x.fin }; });
    saveImported(fillSogCog(B.P), pendingImp.name + ' · boat ' + B.id + (B.fin ? ' (#' + B.fin + ')' : ''), { raceStart: B.s0, raceEnd: B.s1, fleet: others.length + 1, place: B.fin, dev: B.id });
    pendingImp = null; $('coPick').innerHTML = '';
  }
  function saveImported(points, name, extra) {
    {
      var P = points.filter(function (q) { return !isNaN(q[0]) && !isNaN(q[1]) && !isNaN(q[2]); }).sort(function (a, b) { return a[0] - b[0]; });
      if (P.length < 20) throw new Error('No track points found in ' + name);
      var t = Object.assign({ id: 't' + P[0][0] + 'i' + (extra.dev || ''), name: name, start: P[0][0], end: P[P.length - 1][0], points: P, imported: true }, extra);
      t.stats = window.Track.stats(P);
      return window.Track.put(t).then(function () { return addFromTrack(t.id); });
    }
  }

  /* ---- regate (svi brodovi sa sistema za praćenje) ---- */
  function regattas() { var a = sget('regattas', []), ch = false; if (window.Regatta) a.forEach(function (rg) { if (rg.knownApplied !== 2 && applyKnown(rg)) ch = true; }); if (ch) sset('regattas', a); return a; }
  function saveRegattas(a) { sset('regattas', a); }
  function nameOf(r, id) { var c = (r.comp || {})[id]; return c ? c.name + (c.sail ? ' ' + c.sail : '') : 'Boat ' + id; }
  function readFile(f) {
    if (/\.gz$/i.test(f.name)) {
      if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser cannot open .gz files. Unzip it first.'));
      return new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return f.text();
  }
  function seq(a, fn) { return a.reduce(function (p, x) { return p.then(function () { return fn(x); }); }, Promise.resolve()); }
  // PRIVREMENO: zvanični rezultati Palić 2026 (sa slike rezultata) dok ne rešimo čitanje rezultata sa slike / PDF-a
  var KNOWN = [{ name: 'Palić 2026', from: Date.UTC(2026, 9, 8), to: Date.UTC(2026, 9, 12), lat: 46.1, lon: 19.76, txt:
    'Rank,Boat,Class,Nat,SailNo,Club,HelmName,CrewName,R1,R2,R3,R4,R5,R6,R7,R8,R9,Total,Nett\n' +
    '1,,Seascape 18,SRB,644,JK Ada,Goran Stevanović,Nikola Marijanović,2.0,1.0,(3.0),1.0,1.0,1.0,1.0,(3.0),1.0,14.0,8.0\n' +
    '2,Barely Legal,Seascape 18,SLO,611,JK Pirat,Jure Jerman,Urban Jerman,3.0,2.0,2.0,3.0,(5.0),(6.0),2.0,1.0,2.0,26.0,15.0\n' +
    '3,Pocket Rocket,Seascape 18,SLO,304,JK Ljubljana,Ana Žavbi,Anže Skalja,(5.0),4.0,1.0,2.0,4.0,3.0,5.0,(6.0),3.0,33.0,22.0\n' +
    '4,,Seascape 18,SRB,344,JK Ada,Miloš Dobrosavljević,Goran Jerinkić,1.0,(5.0),4.0,5.0,3.0,4.0,3.0,2.0,(6.0),33.0,22.0\n' +
    '5,YO,Seascape 18,SRB,401,JK Gemax,Nikola Banjac,Luka Minić,(8.0 DNF),(7.0),5.0,7.0,2.0,2.0,6.0,4.0,5.0,46.0,31.0\n' +
    '6,Pinocchio,Seascape 18,SLO,642,JK Bohinj / JK Palić,Dušan Djoković,Nenad Zakić,4.0,3.0,6.0,4.0,6.0,(7.0),7.0,(8.0 RET),4.0,49.0,34.0\n' +
    '7,Prince Team,Seascape 18,SRB,355,JK Ada,Aljoša Ivković,Aleksandar Jovanović,6.0,6.0,(7.0),6.0,(7.0),5.0,4.0,5.0,7.0,53.0,39.0\n' }];
  function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj').trim(); }
  function knownFor(rg, fleetPt) {
    var g = rg.races[0] && rg.races[0].gun; if (!g) return null;
    var m = (rg.races[0].marks || [])[0], ll = m ? [m.lat, m.lon] : fleetPt;
    return KNOWN.filter(function (k) { return g >= k.from && g <= k.to && (!ll || (Math.abs(ll[0] - k.lat) < 0.2 && Math.abs(ll[1] - k.lon) < 0.3)); })[0] || null;
  }
  // primeni poznate rezultate; vraća true ako je nešto promenjeno
  function applyKnown(rg) {
    var k = knownFor(rg); if (!k || rg.knownApplied === 2 || rg.compOfficial) return false;
    var res = window.Regatta.parseResults(k.txt); if (!res) return false;
    rg.comp = {}; applyResults(rg, res);
    rg.races.forEach(function (r) { r.rows.forEach(function (row) { if (rg.comp[row.id]) { row.name = rg.comp[row.id].name; row.sail = rg.comp[row.id].sail; } }); });
    if (/^Regatta \d/.test(rg.name)) rg.name = k.name;
    rg.knownApplied = 2; return true;
  }
  var regPending = null;
  function importRegatta(files) {
    var R = window.Regatta; if (!R) return Promise.reject(new Error('Regatta module missing'));
    return Promise.all(files.map(function (f) { return readFile(f).then(function (t) { return { f: f, t: t }; }); })).then(function (all) {
      var info = { competitors: {}, marks: {}, event: null }, races = [], res = null;
      all.forEach(function (x) {
        var D = /^\s*[{\[]/.test(x.t) ? null : R.parseFleetCsv(x.t);
        if (D) { races.push({ name: x.f.name, D: D }); return; }
        var rs = /^\s*[{\[]/.test(x.t) ? null : R.parseResults(x.t);
        if (rs) { res = rs; return; }
        var inf = R.parseInfo(x.t); Object.assign(info.competitors, inf.competitors); Object.assign(info.marks, inf.marks); if (inf.event) info.event = inf.event;
      });
      if (!races.length) throw new Error('No race files found (CSV with a device column for every boat)');
      toast('Analysing ' + races.length + ' race' + (races.length > 1 ? 's' : '') + '…');
      var out = [];
      races.forEach(function (x) { var a = R.analyzeRace(x.D, info); if (!a.error) out.push({ a: a, D: x.D, file: x.name }); else toast(x.name + ': ' + a.error, null, null, 4000); });
      if (!out.length) throw new Error('No race could be analysed');
      out.sort(function (p, q) { return p.a.gun - q.a.gun; });
      var ev = info.event || {}, rg = { id: 'rg' + out[0].a.gun, name: ev.name || ('Regatta ' + new Date(out[0].a.gun).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })),
        place: ev.location || (function () { var D = out[0].D, k = Object.keys(D)[0], q = D[k][0]; return placeFor(q[1], q[2]); })(), comp: info.competitors, compOfficial: Object.keys(info.competitors || {}).length > 0, me: null, created: Date.now(),
        races: out.map(function (x, i) { return { n: i + 1, gun: x.a.gun, end: x.a.end, wind: x.a.wind, laps: x.a.laps, rows: x.a.rows, legs: x.a.legs, marks: x.a.marks, targets: x.a.targets, boatInfo: x.a.boatInfo }; }) };
      if (res) applyResults(rg, res); else applyKnown(rg);
      rg.races.forEach(function (r) { r.rows.forEach(function (row) { if (rg.comp[row.id]) { row.name = rg.comp[row.id].name; row.sail = rg.comp[row.id].sail; } }); });
      saveRegattas(regattas().filter(function (x) { return x.id !== rg.id; }).concat([rg]));
      regPending = { id: rg.id, out: out };
      var fp = Promise.resolve();
      if (window.Track) out.forEach(function (x, i) { fp = fp.then(function () { return window.Track.put({ id: 'f' + rg.id + '_' + (i + 1), fleet: true, boats: x.a.fleet, start: x.a.gun, points: [] }); }); });
      return fp.then(function () { return findMe(rg, out); }).then(function (me) {
        if (me) return setMe(rg.id, me);
        // izbor broda
        var ids = {}; rg.races.forEach(function (r) { r.rows.forEach(function (x) { ids[x.id] = 1; }); });
        $('coRegPick').innerHTML = '<p class="small">' + rg.races.length + ' races found. Which boat is yours?' + (Object.keys(rg.comp).length ? '' : ' Boats have no names yet: add the official results (with the race files, or later on the regatta page) and they get named.') + '</p>' + Object.keys(ids).map(function (id) { return '<button class="cl-card" data-me="' + id + '"><span class="cl-name">' + esc(nameOf(rg, id)) + '</span></button>'; }).join('');
        toast('Pick your boat');
      });
    });
  }
  // zvanični rezultati: imena brodova (ako nema spiska takmičara) i zvanični plasman po trci
  function applyResults(rg, res) {
    var R = window.Regatta, m = R.mapByResults(rg.races, res);
    if (!rg.compOfficial && Object.keys(m).length) { rg.comp = {}; Object.keys(m).forEach(function (d) { rg.comp[d] = { name: m[d].name, sail: m[d].sail, nat: m[d].nat || '', conf: m[d].conf }; }); }
    var bySail = {}; res.boats.forEach(function (b) { bySail[String(b.sail).replace(/\D/g, '')] = b; });
    rg.races.forEach(function (r) {
      r.rows.forEach(function (row) {
        var c = rg.comp[row.id], b = c ? bySail[String(c.sail).replace(/\D/g, '')] : null;
        if (b && b.places[r.n] !== undefined) row.offPlace = b.places[r.n]; // null = DNF / RET / ...
      });
    });
    rg.hasResults = true;
  }
  function resultsInto(rgId, txt) {
    var res = window.Regatta.parseResults(txt || '');
    if (!res) { toast('Could not read the results. Copy the whole results table from the page, from the header (Rank … R1, R2 …) to the last boat, and paste it again.', null, null, 6000); return; }
    var all = regattas(), rg = all.filter(function (x) { return x.id === rgId; })[0]; if (!rg) return;
    applyResults(rg, res);
    rg.races.forEach(function (r) { r.rows.forEach(function (row) { if (rg.comp[row.id]) { row.name = rg.comp[row.id].name; row.sail = rg.comp[row.id].sail; } }); });
    var my = fold(helmOf(sget('myName', '') || ''));
    if (!rg.me && my) { var hit = Object.keys(rg.comp).filter(function (id) { return fold(helmOf(rg.comp[id].name)) === my; }); if (hit.length === 1) rg.me = hit[0]; }
    saveRegattas(all);
    // Race Log: zvanični plasman
    if (rg.me) saveEntries(entries().map(function (e) {
      if (e.regatta !== rg.id) return e; var m = / Race (\d+)$/.exec(e.title || ''); if (!m) return e;
      var r = rg.races[+m[1] - 1], row = r && r.rows.filter(function (y) { return y.id === rg.me; })[0];
      if (row && row.offPlace !== undefined) e.result = (row.offPlace === null ? 'DNF / RET' : row.offPlace) + ' of ' + r.rows.length; return e;
    }));
    toast('Results added: ' + res.boats.length + ' boats'); render();
  }
  // sopstveni brod: po imenu (zapamćeno) ili po tragu snimljenom aplikacijom u isto vreme
  function findMe(rg, out) {
    var my = (sget('myName', '') || '').toLowerCase().trim();
    my = fold(helmOf(my));
    if (my) { var hit = Object.keys(rg.comp).filter(function (id) { return fold(helmOf(rg.comp[id].name)) === my; }); if (hit.length === 1) return Promise.resolve(hit[0]); }
    if (!window.Track) return Promise.resolve(null);
    return window.Track.all().then(function (tr) {
      var votes = {};
      out.forEach(function (x) { tr.forEach(function (t) { if (t.imported || !t.points || t.end < x.a.gun || t.start > x.a.end) return; var id = window.Regatta.matchOwn(x.D, t.points); if (id) votes[id] = (votes[id] || 0) + 1; }); });
      var best = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0];
      return best || null;
    });
  }
  function helmOf(name) { return String(name || '').split(' / ')[0].trim(); }
  // promena "moj brod" za postojeću regatu: Race Log unosi i tragovi se prave iznova iz sačuvanih tragova flote (beleške i setup ostaju)
  function relinkMe(rgId, me) {
    var all = regattas(), rg = all.filter(function (x) { return x.id === rgId; })[0]; if (!rg) return Promise.resolve();
    var old = entries().filter(function (e) { return e.regatta === rgId; }), keep = {};
    old.forEach(function (e) { keep[e.raceN] = { notes: e.notes, setup: e.setup, wx: e.wx }; });
    rg.me = me; saveRegattas(all); if (rg.comp[me]) sset('myName', helmOf(rg.comp[me].name));
    saveEntries(entries().filter(function (e) { return e.regatta !== rgId; }));
    var p = Promise.resolve(); if (!window.Track) return p;
    old.forEach(function (e) { if (e.trackId) p = p.then(function () { return window.Track.del(e.trackId); }).catch(function () {}); });
    rg.races.forEach(function (r) {
      var row = r.rows.filter(function (y) { return y.id === me; })[0]; if (!row) return;
      p = p.then(function () { return window.Track.get('f' + rgId + '_' + r.n); }).then(function (f) {
        if (!f || !f.boats || !f.boats[me]) return;
        var fin = row.finished ? r.gun + row.elapsed * 1000 : r.end;
        var P = f.boats[me].filter(function (q) { return q[0] >= r.gun - 60000 && q[0] <= fin + 60000; }).map(function (q) { return [q[0], q[1], q[2], q[3], null, null, null]; });
        if (P.length < 20) return;
        var t = { id: 't' + r.gun + 'r' + me, name: rg.name + ' · Race ' + r.n, start: P[0][0], end: P[P.length - 1][0], points: P, imported: true,
          raceStart: r.gun, raceEnd: fin, axis: r.wind, place: row.offPlace !== undefined ? row.offPlace : row.place, fleet: r.rows.length };
        t.stats = window.Track.stats(P);
        return window.Track.put(t).then(function () { return addFromTrack(t.id, { silent: true, place: rg.place || null, regatta: rg.id, raceN: r.n }); }).then(function (e) {
          var k = keep[r.n]; if (!e || !k) return; var es = entries(); es.forEach(function (x) { if (x.id === e.id) { x.notes = k.notes || ''; x.setup = k.setup || x.setup; if (k.wx) x.wx = k.wx; } }); saveEntries(es);
        });
      });
    });
    return p;
  }
  function setMe(rgId, me) {
    var all = regattas(), rg = all.filter(function (x) { return x.id === rgId; })[0]; if (!rg) return Promise.resolve();
    rg.me = me; saveRegattas(all);
    if (rg.comp[me]) sset('myName', helmOf(rg.comp[me].name));
    $('coRegPick').innerHTML = '';
    var out = regPending && regPending.id === rgId ? regPending.out : null; regPending = null;
    var p = Promise.resolve();
    if (out && window.Track) out.forEach(function (x, i) {
      var r = rg.races[i], row = r.rows.filter(function (y) { return y.id === me; })[0]; if (!row) return;
      var fin = row.finished ? r.gun + row.elapsed * 1000 : r.end;
      var P = (x.D[me] || []).filter(function (q) { return q[0] >= r.gun - 60000 && q[0] <= fin + 60000; }).map(function (q) { return [q[0], q[1], q[2], q[3], q[4], null, null]; });
      if (P.length < 20) return;
      var t = { id: 't' + r.gun + 'r' + me, name: rg.name + ' · Race ' + r.n, start: P[0][0], end: P[P.length - 1][0], points: P, imported: true,
        raceStart: r.gun, raceEnd: fin, axis: r.wind, place: row.offPlace !== undefined ? row.offPlace : row.place, fleet: r.rows.length };
      t.stats = window.Track.stats(P);
      p = p.then(function () { return window.Track.put(t); }).then(function () { return addFromTrack(t.id, { silent: true, place: rg.place || null, regatta: rg.id, raceN: r.n }); });
    });
    return p.then(function () { cur = 'rg:' + rgId; render(); toast(rg.races.length + ' races added to the Race Log'); });
  }
  function fmtT(s) { if (s === null || s === undefined) return '–'; s = Math.round(s); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  var n1 = function (v) { return v === null || v === undefined ? '–' : v.toFixed(1); }, n2 = function (v) { return v === null || v === undefined ? '–' : v.toFixed(2); }, n0 = function (v) { return v === null || v === undefined ? '–' : Math.round(v) + ''; };
  function tblH(rows, cols, me) {
    return '<div class="co-tbl-w"><table class="co-tbl"><tr>' + cols.map(function (c) { return '<th>' + c[0] + '</th>'; }).join('') + '</tr>' + rows.map(function (x) {
      return '<tr' + (x.id === me ? ' class="me"' : '') + '>' + cols.map(function (c) { return '<td>' + c[1](x) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</table></div>';
  }
  function raceTable(rg, r) {
    var me = rg.me, tbl = function (rows, cols) { return tblH(rows, cols, me); };
    return tbl(r.rows.slice().sort(function (a, b) { var pa = a.offPlace !== undefined ? a.offPlace : a.place, pb = b.offPlace !== undefined ? b.offPlace : b.place; return (pa || 99) - (pb || 99); }), [['#', function (x) { var p = x.offPlace !== undefined ? x.offPlace : x.place; return p ? p : (x.offPlace === null ? 'DNF' : '–'); }], ['Boat', function (x) { return esc(nameOf(rg, x.id)); }], ['Time', function (x) { return fmtT(x.elapsed) + (x.finished ? '' : '*'); }], ['Start', function (x) { return x.start === null ? '–' : '+' + Math.round(x.start) + 's'; }], ['Up', function (x) { return n1(x.up) + '/' + n1(x.vmgUp); }], ['Dn', function (x) { return n1(x.down) + '/' + n1(x.vmgDown); }], ['TA', function (x) { return n0(x.ta); }], ['Tacks', function (x) { return x.tacks + (x.tackLoss !== null ? ' (' + n1(x.tackLoss) + ')' : ''); }]]) +
        (r.rows.some(function (x) { return !x.finished; }) ? '<p class="small">* not finished inside the file.</p>' : '') ;
  }
  var RT = { key: null, model: null, opt: {} }; // keš: model vetra po trci + idealne linije po brodu
  function raceTargets(r) {
    if (r.targets) return r.targets;
    var av = function (a, k) { return a.reduce(function (s, m) { return s + m[k]; }, 0) / a.length; }, tp = (r.marks || []).filter(function (m) { return m.top; }), bt = (r.marks || []).filter(function (m) { return !m.top; });
    return tp.length && bt.length ? { top: [av(tp, 'lat'), av(tp, 'lon')], bottom: [av(bt, 'lat'), av(bt, 'lon')] } : null;
  }
  function raceInfo(r) { if (r.boatInfo) return r.boatInfo; var o = {}; (r.rows || []).forEach(function (x) { o[x.id] = { ta: x.ta, tackLoss: x.tackLoss, up: x.up, down: x.down }; }); return o; }
  function legsTable(rg, r, sel, opt) {
    var lbl = function (id) { return nameOf(rg, id).split(' / ')[0]; };
    return tblH(r.legs.map(function (L, i) { var x = L.boats[sel] || {}; return { id: '', L: L, x: x, o: opt ? opt[i] : undefined }; }), [
      ['Leg', function (o) { return '<button class="co-leg" data-leg="' + (o.L.n - 1) + '">' + o.L.n + (o.L.up ? ' ↑' : ' ↓') + '</button>'; }],
      ['Wind', function (o) { return o.L.wind === null ? '–' : d3(o.L.wind) + (o.L.shift ? ' (' + (o.L.shift > 0 ? '+' : '') + o.L.shift + ')' : ''); }],
      ['Paid', function (o) { return o.L.up ? (o.L.fav === 'middle' ? 'middle' : o.L.fav || '–') : '–'; }],
      ['Fastest', function (o) { return esc(lbl(o.L.best)) + ' ' + fmtT(o.L.bestDur); }],
      ['Time', function (o) { return o.x.dur === undefined ? '–' : fmtT(o.x.dur); }],
      ['Lost', function (o) { return o.x.lost === undefined ? '–' : (o.x.lost < 1 ? '<b>fastest</b>' : '+' + Math.round(o.x.lost) + 's'); }],
      ['Off', function (o) { return o.x.off === undefined || o.x.off === null ? '–' : Math.abs(Math.round(o.x.off)) + ' m ' + (o.x.off > 0 ? 'R' : 'L'); }],
      ['Ideal', function (o) { return o.o === undefined ? '<span class="co-wait">…</span>' : o.o ? fmtT(o.o.secs) : '–'; }],
      ['Gain', function (o) { return o.o ? '<b class="co-gain">' + (o.o.gain < 3 ? '≈0' : '−' + Math.round(o.o.gain) + 's') + '</b>' : '–'; }]
    ], null);
  }
  function renderRace(rgId, n) {
    var rg = regattas().filter(function (x) { return x.id === rgId; })[0], r = rg && rg.races[n - 1]; if (!r) { cur = null; renderList(); return; }
    $('coTitle').textContent = 'RACE ' + n;
    var me = rg.me, lbl = function (id) { return nameOf(rg, id).split(' / ')[0]; }, tg = raceTargets(r);
    var h = '<div class="co-when">' + esc(rg.name) + ' · ' + dateTxt(r.gun) + ' ' + timeTxt(r.gun) + ' · wind ' + d3(r.wind) + '° · ' + r.laps + ' laps</div><div id="rrBox"></div>';
    if (r.legs && r.legs.length) {
      var bs = Object.keys(r.legs[0].boats);
      var sel = RT.sel && bs.indexOf(RT.sel) >= 0 && RT.key === rgId + ':' + n ? RT.sel : (bs.indexOf(me) >= 0 ? me : r.legs[0].best);
      h += '<div class="co-sec"><h3>LEGS</h3><label class="co-selb">Boat <select id="coSel">' + bs.map(function (id) { return '<option value="' + esc(id) + '"' + (id === sel ? ' selected' : '') + '>' + esc(lbl(id)) + (id === me ? ' (you)' : '') + '</option>'; }).join('') + '</select></label>' +
        '<p class="small">Turquoise shaded lane = <b>AI ideal line</b> for the selected boat: the fastest way to the mark from where and when that boat started the leg, sailed at its own speeds and pointing, through the wind shifts and pressure the whole fleet showed at that time and place. Gold dashed line = track of the boat that sailed the leg fastest. Gain = time that line would have saved. Tap a leg to jump there.</p>' +
        '<div id="coLegs">' + legsTable(rg, r, sel, null) + '</div></div>';
      h += r.legs.map(function (L) {
        var rows = Object.keys(L.boats).map(function (id) { return Object.assign({ id: id }, L.boats[id]); }).sort(function (a, b) { return a.lost - b.lost; });
        return '<details class="co-sec co-race"><summary>LEG ' + L.n + (L.up ? ' ↑' : ' ↓') + ' · all boats</summary>' + tblH(rows, [['Boat', function (x) { return esc(lbl(x.id)); }], ['Time', function (x) { return fmtT(x.dur); }], ['Lost', function (x) { return x.lost < 1 ? '–' : '+' + Math.round(x.lost) + 's'; }], ['Off lane', function (x) { return x.off === null ? '–' : Math.abs(Math.round(x.off)) + ' m ' + (x.off > 0 ? 'R' : 'L'); }]], me) + '</details>';
      }).join('');
    } else h += '<p class="small">This regatta was imported before the replay existed. Import the race files again to get the fleet replay and the fastest lanes.</p>';
    $('coBody').innerHTML = h;
    if (r.legs && window.Track && window.RaceReplay) window.Track.get('f' + rgId + '_' + n).then(function (f) {
      if (!f || !f.boats) { $('rrBox').innerHTML = '<p class="small">Fleet tracks not found. Import the race files again.</p>'; return; }
      window.RaceReplay.open($('rrBox'), r, f.boats, { me: me, label: lbl, short: function (id) { var c = (rg.comp || {})[id], sl = c && c.sail ? String(c.sail).trim() : ''; if (!sl) return id.slice(-3); return /[a-z]/i.test(sl) ? sl.toUpperCase() : ((c.nat ? String(c.nat).toUpperCase() + ' ' : '') + sl); } });
      var k = rgId + ':' + n; if (RT.key !== k) { RT.key = k; RT.model = null; RT.opt = {}; RT.sel = null; }
      var calc = function (id) {
        RT.sel = id; var box = $('coLegs');
        var done = function (o) { if (RT.sel !== id || !$('coLegs')) return; $('coLegs').innerHTML = legsTable(rg, r, id, o); window.RaceReplay.ideal(o, lbl(id)); };
        if (RT.opt[id]) { done(RT.opt[id]); if (RT.model && RT.model.field && window.RaceReplay.field) window.RaceReplay.field(RT.model.field, RT.model.probe); return; }
        if (box) box.innerHTML = legsTable(rg, r, id, null); window.RaceReplay.ideal(null);
        if (!window.Router || !tg) { done(r.legs.map(function () { return null; })); return; }
        setTimeout(function () { // posle iscrtavanja; računanje traje 1–3 s na telefonu
          var race = { gun: r.gun, wind: r.wind, legs: r.legs, targets: tg, marks: r.marks }, o;
          try { if (!RT.model) RT.model = window.Router.buildModel(race, f.boats, raceInfo(r)); o = window.Router.optimal(race, f.boats, id, raceInfo(r), RT.model); } catch (e) { console.warn(e); o = r.legs.map(function () { return null; }); }
          RT.opt[id] = o; done(o);
          if (RT.model && RT.model.field && window.RaceReplay.field) window.RaceReplay.field(RT.model.field, RT.model.probe);
        }, 60);
      };
      calc(sel);
      var sEl = $('coSel'); if (sEl) sEl.addEventListener('change', function () { calc(sEl.value); });
    });
  }
  function renderRegatta(id) {
    var rg = regattas().filter(function (x) { return x.id === id; })[0]; if (!rg) { cur = null; renderList(); return; }
    $('coTitle').textContent = 'REGATTA';
    var S = window.Regatta.summary(rg.races, rg.me), me = rg.me;
    var h = '<input class="co-title co-rgt" id="coRgName" value="' + esc(rg.name) + '"><div class="co-when">' + esc(rg.place || '') + ' · ' + rg.races.length + ' races · ' + dateTxt(rg.races[0].gun) + '</div>';
    var pickH = S.list.map(function (x) { return '<button class="cl-card' + (x.id === me ? ' on' : '') + '" data-me2="' + x.id + '"><span class="cl-name">' + esc(nameOf(rg, x.id)) + '</span></button>'; }).join('');
    if (!me) h += '<p class="small">Pick your boat to see your comparison:</p>' + pickH;
    else h += '<div class="co-me">Your boat: <b>' + esc(nameOf(rg, me)) + '</b> <button class="btn sm" id="coMeChg">Not you? Change</button></div><div id="coMePick" hidden><p class="small">Tap your boat. Your Race Log entries for this regatta are rebuilt from your boat\'s track; notes and setup are kept.</p>' + pickH + '</div>';
    if (rg.races.some(function (r) { return !r.legs; })) h += '<p class="co-warn">This regatta was imported with an older version, so it has no fleet map. Import the race files (and results) again in the Race Log to get the replay map. You can delete this old copy after that.</p>';
    else h += '<p class="small">Open a race below and tap <b>▶ Replay</b> to see the fleet map.</p>';
    if (S.tips.length) h += '<div class="co-sec"><h3>WHAT THE NUMBERS SAY</h3>' + S.tips.map(function (t) { return '<p class="co-tip">' + esc(t) + '</p>'; }).join('') + '<p class="small">Tacking angle is measured over ground (includes leeway), the same way for every boat.</p></div>';
    var tbl = function (rows, cols) { return tblH(rows, cols, me); };
    h += '<div class="co-sec"><h3>ALL RACES (AVERAGE)</h3>' + tbl(S.list, [['Boat', function (x) { return esc(nameOf(rg, x.id)); }], ['Up kn', function (x) { return n2(x.up); }], ['VMG up', function (x) { return n2(x.vmgUp); }], ['VMG dn', function (x) { return n2(x.vmgDown); }], ['TA°', function (x) { return n0(x.ta); }], ['Tack m', function (x) { return n1(x.tackLoss); }], ['Start s', function (x) { return n0(x.start); }]]) + '</div>';
    rg.races.forEach(function (r) {
      var mine = r.rows.filter(function (x) { return x.id === me; })[0];
      var myE = entries().filter(function (e) { return e.regatta === rg.id && e.raceN === r.n; })[0];
      h += '<details class="co-sec co-race"><summary>RACE ' + r.n + ' · ' + timeTxt(r.gun) + ' · wind ' + d3(r.wind) + '° · ' + r.laps + ' laps' + (mine ? ' · you ' + ((mine.offPlace !== undefined ? mine.offPlace : mine.place) || 'not finished') : '') + '</summary>' +
        raceTable(rg, r) + '<div class="row">' + (r.legs ? '<button class="btn" data-rr="' + rg.id + ':' + r.n + '">▶ Replay &amp; fastest lanes</button>' : '') + (myE ? '<button class="btn" data-le="' + myE.id + '">My Race Log entry</button>' : '') + '</div></details>';
    });
    h += '<div class="co-sec"><h3>RESULTS</h3><p class="small">' + (rg.hasResults ? 'Official results added: boats named and places from the results.' : 'Add the official results to name the boats and use the official places. Copy the results table from the results web page and paste it here, or pick the file (CSV / TXT / HTML).') + '</p>' +
      '<textarea id="coResTxt" rows="4" placeholder="Paste the results table here"></textarea><div class="row"><button class="btn" id="coResGo">Use pasted results</button><label class="btn co-imp">Results file<input type="file" id="coResFile" accept=".csv,.txt,.tsv,.html,.htm" hidden></label></div></div>';
    h += '<p class="small">Place = ' + (rg.hasResults ? 'official result' : 'order over the finish line found in the tracks') + '. Names: ' + (rg.hasResults && Object.keys(rg.comp).some(function (k) { return rg.comp[k].conf !== undefined; }) ? 'matched from the finish order of every race to the results' : 'from the competitor list') + '. Up / Dn = speed / VMG in knots. Tacks (m) = median meters lost per tack.</p>' +
      '<div class="row"><button class="btn danger" id="coRgDel">Delete regatta</button></div>';
    $('coBody').innerHTML = h;
  }

  /* ---- prikaz ---- */
  var cur = null, saveT = null;
  function isOpen() { return document.body.getAttribute('data-view') === 'coaching'; }
  function open(id) { if (window.RA && !isOpen()) window.RA.show('coaching'); cur = id || null; render(); }
  function list() { cur = null; render(); }
  function toTop() { var b = $('coBody'); if (b) b.scrollTop = 0; window.scrollTo(0, 0); }
  function render() {
    if (!(cur && cur.indexOf('rr:') === 0) && window.RaceReplay) window.RaceReplay.close();
    if (cur && cur.indexOf('rr:') === 0) renderRace(cur.split(':')[1], +cur.split(':')[2]);
    else if (cur && cur.indexOf('rg:') === 0) renderRegatta(cur.slice(3)); else if (cur) renderEntry(); else renderList();
  }
  function wxLine(w) {
    if (!w) return 'Loading weather…';
    if (w.err) return 'Weather not available (' + esc(w.err) + ')';
    return (Math.round(w.min) === Math.round(w.max) ? Math.round(w.min) : Math.round(w.min) + '–' + Math.round(w.max)) + ' kn, gusts ' + (w.gust !== null ? Math.round(w.gust) : '–') + ' · from ' + d3(w.dir) + '° ' + compass(w.dir) + (w.temp !== null ? ' · ' + Math.round(w.temp) + '°C' : '');
  }
  function renderList() {
    $('coTitle').textContent = 'DEBRIEF';
    var q = (sget('coFilter', '') || '').toLowerCase(), all = entries(), rgs = regattas();
    var hit = function (s) { return !q || s.toLowerCase().indexOf(q) >= 0; };
    // jedna lista: pojedinačni zapisi + regate (grupa trka) po datumu
    var items = all.filter(function (e) { return !e.regatta || !rgs.some(function (r) { return r.id === e.regatta; }); })
      .filter(function (e) { return hit([e.title, e.place, e.notes, e.result].join(' ')); }).map(function (e) { return { t: e.m.start || 0, e: e }; })
      .concat(rgs.filter(function (r) { return hit([r.name, r.place].join(' ') + ' ' + all.filter(function (e) { return e.regatta === r.id; }).map(function (e) { return e.notes; }).join(' ')); }).map(function (r) { return { t: r.races[0].gun, r: r }; }))
      .sort(function (a, b) { return b.t - a.t; });
    var h = '<div class="co-sec"><h3>RACE LOG</h3><p class="small">One entry per sail: your track, the measured numbers, the weather of the day, setup and notes. Import a file with only your boat and you get your numbers; import files with the whole fleet (tracking system of a regatta) and every race is also compared with the other boats.</p>' +
      '<div class="row"><button class="btn" id="coAddTrack">+ From a saved track</button><label class="btn co-imp">Import files<input type="file" id="coImport" multiple accept=".gpx,.csv,.gz,.txt,.tsv,.json,.html,.htm,text/csv,application/gpx+xml" hidden></label></div>' +
      '<p class="small co-hint">GPX / CSV of your boat, or the race files of a regatta (CSV / CSV.GZ with all boats). Add the official results or the competitor list in the same pick to name the boats.</p>' +
      (items.length || q ? '<input type="search" id="coFilter" class="co-filter" placeholder="Search place, notes… (e.g. Palić)" value="' + esc(q) + '">' : '') + '<div id="coPick"></div><div id="coRegPick"></div>';
    h += items.length ? items.map(function (it) {
      if (it.r) { var r = it.r; return '<button class="cl-card co-card co-rgcard" data-rg="' + r.id + '"><span class="cl-name">' + esc(r.name) + '</span><span class="cl-meta">' + r.races.length + ' races</span><span class="co-sub">' + esc(r.place || '') + ' · ' + dateTxt(r.races[0].gun) + ' · fleet of ' + r.races[0].rows.length + (r.me ? ' · you: ' + esc(nameOf(r, r.me).split(' / ')[0]) : '') + '</span></button>'; }
      var e = it.e;
      return '<button class="cl-card co-card" data-le="' + e.id + '"><span class="cl-name">' + esc(e.title) + '</span><span class="cl-meta">' + (e.m.start ? dateTxt(e.m.start) : '') + '</span>' +
        '<span class="co-sub">' + esc(e.place) + ' · ' + (e.wx && !e.wx.err ? (Math.round(e.wx.min) === Math.round(e.wx.max) ? Math.round(e.wx.min) : Math.round(e.wx.min) + '–' + Math.round(e.wx.max)) + ' kn ' + compass(e.wx.dir) : (e.m.windDir !== null ? 'wind ~' + d3(e.m.windDir) + '°' : '')) + ' · ' + f1(e.m.dist) + ' NM</span></button>';
    }).join('') : '<p class="small">' + (q ? 'Nothing matches.' : 'No entries yet. Add one from a saved track or import a file.') + '</p>';
    h += '</div><div class="co-sec co-soon"><h3>TRAINING SESSIONS</h3><p class="small">Coming soon: tack and gybe drills with entry / exit speed, acceleration and start drills.</p></div>';
    $('coBody').innerHTML = h;
  }
  function fleetHtml(e) {
    if (!e.regatta) return '';
    var rg = regattas().filter(function (x) { return x.id === e.regatta; })[0]; if (!rg) return '';
    var n = e.raceN || +((/ Race (\d+)$/.exec(e.title || '') || [])[1]), r = rg.races[n - 1]; if (!r) return '';
    return '<div class="co-sec"><h3>FLEET · RACE ' + r.n + '</h3><p class="small">Wind ' + d3(r.wind) + '° · ' + r.laps + ' laps · ' + r.rows.length + ' boats. Up / Dn = speed / VMG kn.</p>' + raceTable(rg, r) +
      '<div class="row">' + (r.legs ? '<button class="btn" data-rr="' + rg.id + ':' + r.n + '">▶ Fleet replay &amp; fastest lanes</button>' : '') + '<button class="btn" data-rg="' + rg.id + '">Regatta overview</button></div></div>';
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
      '<div class="row"><button class="btn" id="coOpenTrk">Open track replay</button><button class="btn" id="coFlip">Wind from the other side?</button></div></div>' +
      fleetHtml(e) +
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
    if (b.hasAttribute('data-le')) { cur = b.getAttribute('data-le'); render(); toTop(); return; }
    if (b.hasAttribute('data-pick')) { addFromTrack(b.getAttribute('data-pick')); return; }
    if (b.hasAttribute('data-boat')) { importBoat(+b.getAttribute('data-boat')); return; }
    if (b.hasAttribute('data-rr')) { cur = 'rr:' + b.getAttribute('data-rr'); render(); toTop(); return; }
    if (b.hasAttribute('data-leg')) { if (window.RaceReplay) window.RaceReplay.go(+b.getAttribute('data-leg')); var mpE = document.getElementById('rrMap'); if (mpE) mpE.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (b.hasAttribute('data-rg')) { cur = 'rg:' + b.getAttribute('data-rg'); render(); toTop(); return; }
    if (b.hasAttribute('data-me')) { var rgP = regPending; setMe(rgP ? rgP.id : null, b.getAttribute('data-me')); return; }
    if (b.hasAttribute('data-me2')) { var all2 = regattas(), r2 = all2.filter(function (x) { return 'rg:' + x.id === cur; })[0]; if (r2) { toast('Updating your Race Log…'); relinkMe(r2.id, b.getAttribute('data-me2')).then(function () { render(); toast('Your boat: ' + nameOf(r2, b.getAttribute('data-me2'))); }); } return; }
    if (b.id === 'coMeChg') { var pk = $('coMePick'); if (pk) pk.hidden = !pk.hidden; return; }
    if (b.id === 'coResGo') { var tx = ($('coResTxt') || {}).value || ''; resultsInto(cur.slice(3), tx); return; }
    if (b.id === 'coRgDel') { var rid = cur.slice(3); toast('Delete this regatta? Race Log entries stay.', 'Delete', function () { saveRegattas(regattas().filter(function (x) { return x.id !== rid; })); cur = null; renderList(); }, 4000); return; }
    if (b.id === 'coFlip') {
      var ef = entries().filter(function (x) { return x.id === cur; })[0]; if (!ef) return;
      window.Track.get(ef.trackId).then(function (t) { if (!t) return; t.flip = !t.flip; return window.Track.put(t).then(function () { update(ef.id, { m: measure(t.points, t) }); toast('Wind side flipped'); }); });
      return;
    }
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
    body.addEventListener('input', function (ev) {
      if (ev.target.id === 'coRgName' && cur && cur.indexOf('rg:') === 0) { var all = regattas(), r = all.filter(function (x) { return 'rg:' + x.id === cur; })[0]; if (r) { r.name = ev.target.value; saveRegattas(all); } return; } if (ev.target.id === 'coFilter') { sset('coFilter', ev.target.value); var p = ev.target.selectionStart; renderList(); var f = $('coFilter'); if (f) { f.focus(); try { f.setSelectionRange(p, p); } catch (e) {} } return; } onInput(ev); });
    body.addEventListener('click', onClick);
    body.addEventListener('change', function (ev) {
      if (ev.target.id === 'coRegImp' && ev.target.files.length) {
        var fs = Array.prototype.slice.call(ev.target.files); toast('Reading ' + fs.length + ' file' + (fs.length > 1 ? 's' : '') + '…');
        importRegatta(fs).catch(function (err) { toast('Import failed: ' + err.message, null, null, 5000); });
        return;
      }
      if (ev.target.id === 'coResFile' && ev.target.files.length) { var rid = cur.slice(3); ev.target.files[0].text().then(function (t) { resultsInto(rid, t); }); return; }
      if (ev.target.id !== 'coImport' || !ev.target.files.length) return;
      var files = Array.prototype.slice.call(ev.target.files); toast('Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…');
      // fajlovi sa više brodova -> regata (poređenje sa flotom); inače trag jednog broda
      Promise.all(files.map(function (f) { return readFile(f).then(function (t) { return { f: f, t: t }; }); })).then(function (all) {
        var fleet = all.some(function (x) { if (/^\s*[{\[]/.test(x.t) || /<gpx/i.test(x.t.slice(0, 500))) return false; var D = window.Regatta.parseFleetCsv(x.t); return D && Object.keys(D).filter(function (k) { return D[k].length > 30; }).length >= 3; });
        if (fleet) return importRegatta(files).catch(function (err) { toast(err.message + ' – importing as single tracks', null, null, 4000); return seq(files, importFile); });
        return seq(files.filter(function (f) { return !/\.(txt|json|html?|tsv)$/i.test(f.name); }), importFile);
      }).catch(function (err) { toast('Import failed: ' + err.message, null, null, 5000); });
    });
    $('coBack').addEventListener('click', function () {
      if (!cur) { window.RA.show('menu'); return; }
      if (cur.indexOf('rr:') === 0) { cur = 'rg:' + cur.split(':')[1]; render(); toTop(); return; }
      var e = cur.indexOf('rg:') === 0 ? null : entries().filter(function (x) { return x.id === cur; })[0];
      cur = e && e.regatta && regattas().some(function (r) { return r.id === e.regatta; }) ? 'rg:' + e.regatta : null; render(); toTop();
    });
  }
  init();
  window.Coach = { open: open, list: list, addFromTrack: addFromTrack, _measure: measure, _parseGpx: parseGpx, _parseCsv: parseCsv };
})();
