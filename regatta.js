/* The Race App — Regatta import: sirovi podaci sa sistema za praćenje regata (CSV po trci, svi brodovi + bove)
   + opciono spisak takmičara (ime, jedro, uređaj) -> start, cilj, vetar, poređenje svih brodova, zapisi u Race Log. */
(function () {
  'use strict';
  var M0 = typeof window === "undefined" && typeof require !== "undefined" ? require("./maneuvers.js") : null;
  var M = { analyze: function (P, o) { return ((typeof window !== "undefined" && window.Maneuvers) || M0).analyze(P, o); } };
  function rad(d) { return d * Math.PI / 180; }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function cmean(a) { var s = 0, c = 0; a.forEach(function (h) { s += Math.sin(rad(h)); c += Math.cos(rad(h)); }); return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360; }
  function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function med(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }

  /* ---- čitanje ---- */
  function parseTime(t) {
    var s = String(t).trim().replace(/"/g, '');
    if (/^\d+(\.\d+)?$/.test(s)) return +s < 1e12 ? +s * 1000 : +s;
    if (/^\d{4}-\d\d-\d\d[ T]\d/.test(s)) { s = s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1'); if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z'; }
    return Date.parse(s);
  }
  // CSV sa kolonom uređaja -> { dev: [[t,lat,lon,sog,cog], ...] }
  function parseFleetCsv(txt) {
    var L = txt.trim().split(/\r?\n/), h = L[0].toLowerCase().split(',').map(function (s) { return s.trim().replace(/"/g, ''); });
    function col(n) { for (var k = 0; k < n.length; k++) { var i = h.indexOf(n[k]); if (i >= 0) return i; } return -1; }
    var cD = col(['deviceid', 'device', 'boatid', 'tracker', 'boat']), cT = col(['timestamp', 'time', 'datetime', 'utc']), cLa = col(['latitude', 'lat']), cLo = col(['longitude', 'lon', 'lng']),
      cS = col(['speed', 'sog', 'sog_kn', 'speed_kn']), cC = col(['course', 'cog', 'heading']);
    if (cD < 0 || cT < 0 || cLa < 0 || cLo < 0) return null;
    var D = {};
    for (var i = 1; i < L.length; i++) {
      var c = L[i].split(','); if (c.length < 4) continue;
      var t = parseTime(c[cT]), la = +c[cLa], lo = +c[cLo]; if (isNaN(t) || isNaN(la) || isNaN(lo)) continue;
      (D[c[cD]] = D[c[cD]] || []).push([t, la, lo, cS >= 0 && c[cS] !== '' ? +c[cS] : null, cC >= 0 && c[cC] !== '' ? +c[cC] : null]);
    }
    Object.keys(D).forEach(function (k) { D[k].sort(function (a, b) { return a[0] - b[0]; }); });
    return D;
  }
  // spisak takmičara / bova / eventa iz teksta (JSON odgovori, jedan po redu, ili HAR)
  function parseInfo(txt) {
    var out = { competitors: {}, marks: {}, event: null };
    function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.deviceId && (o.lastName || o.firstName || o.sailNumber)) out.competitors[String(o.deviceId)] = { name: [String(o.firstName || '').trim(), String(o.lastName || '').trim()].filter(Boolean).join(' '), sail: String(o.sailNumber || '').trim(), club: String(o.club || '').trim() };
      else if (o.deviceId && o.markName) out.marks[String(o.deviceId)] = String(o.markName);
      if (o.eventId && o.name && o.location !== undefined) out.event = { name: o.name, location: o.location, lat: o.lat, lon: o.lon };
      Object.keys(o).forEach(function (k) { var v = o[k]; if (typeof v === 'string' && /^\s*[\[{]/.test(v) && v.length < 2e6) { try { walk(JSON.parse(v)); } catch (e) {} } else walk(v); });
    }
    try { walk(JSON.parse(txt)); } catch (e) { txt.split(/\r?\n/).forEach(function (l) { l = l.trim(); if (!l) return; try { walk(JSON.parse(l)); } catch (e2) {} }); }
    return out;
  }

  /* ---- geometrija ---- */
  function mkXY(o) { var kx = 111320 * Math.cos(rad(o[0])), ky = 110540; return function (la, lo) { return [(lo - o[1]) * kx, (la - o[0]) * ky]; }; }
  function side(a, b, p) { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); }
  function segCross(p1, p2, a, b) { return (side(a, b, p1) > 0) !== (side(a, b, p2) > 0) && (side(p1, p2, a) > 0) !== (side(p1, p2, b) > 0); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /* ---- analiza jedne trke ---- */
  function analyzeRace(D, info) {
    info = info || { competitors: {}, marks: {} };
    var ids = Object.keys(D), boats = [], marks = [];
    ids.forEach(function (id) {
      var P = D[id]; if (P.length < 30) return;
      var sp = avg(P.map(function (q) { return q[3] || 0; }));
      if (info.marks[id] || (!info.competitors[id] && sp < 1)) marks.push(id); else if (sp >= 1 || info.competitors[id]) boats.push(id);
    });
    if (marks.length < 2 || boats.length < 2) return { error: 'Need at least two marks (fixed trackers) and two boats in the file' };
    var t0 = Infinity, t1 = -Infinity; ids.forEach(function (id) { t0 = Math.min(t0, D[id][0][0]); t1 = Math.max(t1, D[id][D[id].length - 1][0]); });
    var mp = {}; marks.forEach(function (id) { mp[id] = [med(D[id].map(function (q) { return q[1]; })), med(D[id].map(function (q) { return q[2]; }))]; });
    var xy = mkXY(mp[marks[0]]), MX = {}; marks.forEach(function (id) { MX[id] = xy(mp[id][0], mp[id][1]); });
    var PX = {}; boats.forEach(function (id) { PX[id] = D[id].map(function (q) { return [q[0], xy(q[1], q[2])]; }); });
    var lines = [];
    for (var i = 0; i < marks.length; i++) for (var j = i + 1; j < marks.length; j++) { var L = dist(MX[marks[i]], MX[marks[j]]); if (L > 10 && L < 300) lines.push([marks[i], marks[j]]); }
    function crossings(ln, wm, toward) {
      var a = MX[ln[0]], b = MX[ln[1]], ws = side(a, b, MX[wm]) > 0, out = {};
      boats.forEach(function (id) {
        var P = PX[id], r = [];
        for (var k = 1; k < P.length; k++) if (segCross(P[k - 1][1], P[k][1], a, b) && ((side(a, b, P[k][1]) > 0) === ws) === toward) r.push(P[k][0]);
        out[id] = r;
      });
      return out;
    }
    function farMark(ln) { var c = [(MX[ln[0]][0] + MX[ln[1]][0]) / 2, (MX[ln[0]][1] + MX[ln[1]][1]) / 2], best = null, bd = 0; marks.forEach(function (m) { var d = dist(c, MX[m]); if (d > bd) { bd = d; best = m; } }); return best; }
    // START: linija i trenutak kad najviše brodova pređe ka gornjoj bovi u 90 s
    var named = lines.filter(function (ln) { var n = ln.map(function (m) { return info.marks[m] || ''; }).sort().join(); return n === 's1,s2'; });
    var best = null;
    (named.length ? named : lines).forEach(function (ln) {
      var wm = farMark(ln), c = crossings(ln, wm, true), all = [];
      Object.keys(c).forEach(function (id) { c[id].forEach(function (t) { all.push([t, id]); }); }); all.sort(function (x, y) { return x[0] - y[0]; });
      all.forEach(function (e) {
        if (e[0] > t0 + 0.7 * (t1 - t0)) return;
        var w = {}; all.forEach(function (f) { if (f[0] >= e[0] && f[0] <= e[0] + 90000 && !w[f[1]]) w[f[1]] = f[0]; });
        var n = Object.keys(w).length;
        if (!best || n > best.n) best = { n: n, ln: ln, wm: wm, first: w, c: c };
      });
    });
    if (!best || best.n < 2) return { error: 'Start not found' };
    var vals = Object.keys(best.first).map(function (k) { return best.first[k]; });
    var gun = Math.floor(med(vals) / 60000) * 60000, startLn = best.ln, wm = best.wm;
    var sc = [(MX[startLn[0]][0] + MX[startLn[1]][0]) / 2, (MX[startLn[0]][1] + MX[startLn[1]][1]) / 2];
    var G = (Math.atan2(MX[wm][0] - sc[0], MX[wm][1] - sc[1]) * 180 / Math.PI + 360) % 360;
    // sledeći start u istom fajlu (ne računamo posle njega)
    var tLimit = t1, sAll = [];
    Object.keys(best.c).forEach(function (id) { best.c[id].forEach(function (t) { if (t > gun + 600000) sAll.push([t, id]); }); }); sAll.sort(function (x, y) { return x[0] - y[0]; });
    sAll.some(function (e) { var w = {}; sAll.forEach(function (f) { if (f[0] >= e[0] && f[0] <= e[0] + 90000) w[f[1]] = 1; }); if (Object.keys(w).length >= Math.max(3, 0.6 * boats.length)) { tLimit = e[0] - 120000; return true; } return false; });
    // KRUGOVI: posete gornjoj bovi (i bovama blizu nje)
    var topMarks = marks.filter(function (m) { return dist(MX[m], MX[wm]) < 120; });
    function visits(id) {
      var P = PX[id], v = [], near = false;
      P.forEach(function (q) {
        if (q[0] < gun || q[0] > tLimit) return;
        var d = Math.min.apply(null, topMarks.map(function (m) { return dist(q[1], MX[m]); }));
        if (!near && d < 90) { near = true; v.push(q[0]); } else if (near && d > 250) near = false;
      });
      return v;
    }
    var V = {}; boats.forEach(function (id) { V[id] = visits(id); });
    var cnt = {}; boats.forEach(function (id) { var n = V[id].length; if (n) cnt[n] = (cnt[n] || 0) + 1; });
    var laps = +Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || b - a; })[0] || 1;
    // CILJ: prvi prelaz (niz vetar) neke kratke linije posle poslednje posete gornjoj bovi
    var fin = null, cands = [];
    lines.forEach(function (ln) {
      var c = crossings(ln, wm, false), f = {}, n = 0, sum = 0;
      boats.forEach(function (id) {
        if (V[id].length < laps) return;
        var after = V[id][laps - 1], t = c[id].filter(function (x) { return x > after && x <= tLimit + 120000; })[0];
        if (t && t - after < 25 * 60000) { f[id] = t; n++; sum += t - after; }
      });
      if (n) cands.push({ n: n, avg: sum / n, ln: ln, f: f });
    });
    if (typeof process !== 'undefined' && process.env && process.env.RDBG) cands.forEach(function (c) { console.log('  cand', c.ln.join('-'), c.n, Math.round(c.avg / 1000), Object.keys(c.f).sort(function (a, b) { return c.f[a] - c.f[b]; }).map(function (k) { return (info.competitors[k] || {}).sail || k; }).join(' ')); });
    // najviše brodova; kod jednakog broja prednost ima startna linija (često je i cilj), pa najkraće vreme
    function isStart(c) { return c.ln.slice().sort().join() === startLn.slice().sort().join(); }
    cands.forEach(function (c) { if (!fin || c.n > fin.n || (c.n === fin.n && (isStart(c) && !isStart(fin) || (isStart(c) === isStart(fin) && c.avg < fin.avg)))) fin = c; });
    var finishT = fin ? fin.f : {};
    // VETAR: iz geometrije (start -> gornja bova), doteran halsovima svih brodova
    var axes = [];
    boats.forEach(function (id) {
      var end = finishT[id] || tLimit, P = D[id].filter(function (q) { return q[0] >= gun && q[0] <= end; }).map(function (q) { return [q[0], q[1], q[2], q[3], q[4], null, null]; });
      if (P.length < 60) return;
      var r = M.analyze(P, { upAt: gun }); if (r.axis === null) return;
      var a = Math.abs(nrm(r.axis - G)) > 90 ? (r.axis + 180) % 360 : r.axis;
      if (Math.abs(nrm(a - G)) < 35) axes.push(a);
    });
    var AX = axes.length ? cmean(axes) : G;
    // BROJKE po brodu, samo od starta do cilja
    var rows = boats.map(function (id) {
      var fT = finishT[id] || null, end = fT || tLimit;
      var P = D[id].filter(function (q) { return q[0] >= gun && q[0] <= end; }).map(function (q) { return [q[0], q[1], q[2], q[3], q[4], null, null]; });
      var st = (best.c[id] || []).filter(function (t) { return t >= gun - 5000; })[0];
      var r = P.length >= 60 ? M.analyze(P, { axis: AX }) : { list: [] };
      var up = [], vu = [], dn = [], vd = [], mx = 0;
      P.forEach(function (q) { if (q[3] > mx) mx = q[3]; if (q[3] === null || q[4] === null || q[3] < 1.5) return; var rel = Math.abs(nrm(q[4] - AX)); if (rel < 70) { up.push(q[3]); vu.push(q[3] * Math.cos(rad(rel))); } else if (rel > 110) { dn.push(q[3]); vd.push(q[3] * Math.cos(rad(180 - rel))); } });
      var tk = r.list.filter(function (m) { return m.kind === 'tack'; }), gy = r.list.filter(function (m) { return m.kind === 'gybe'; });
      var c = info.competitors[id] || {};
      return { id: id, name: c.name || ('Boat ' + id), sail: c.sail || '', finished: !!fT, elapsed: (end - gun) / 1000, start: st ? (st - gun) / 1000 : null,
        up: avg(up), vmgUp: avg(vu), down: avg(dn), vmgDown: avg(vd), ta: med(tk.map(function (m) { return m.turn; })), tacks: tk.length,
        tackLoss: med(tk.filter(function (m) { return m.loss !== null; }).map(function (m) { return m.loss; })), gybes: gy.length,
        gybeLoss: med(gy.filter(function (m) { return m.loss !== null; }).map(function (m) { return m.loss; })), max: mx };
    });
    rows.sort(function (a, b) { return (a.finished ? a.elapsed : 1e9 + a.elapsed) - (b.finished ? b.elapsed : 1e9 + b.elapsed); });
    rows.forEach(function (r, i) { r.place = r.finished ? i + 1 : null; });
    return { gun: gun, end: tLimit, wind: Math.round(AX), course: Math.round(G), laps: laps, startLine: startLn, finishLine: fin ? fin.ln : null, rows: rows, boats: boats.length };
  }

  /* ---- prepoznavanje sopstvenog broda iz traga snimljenog aplikacijom ---- */
  function matchOwn(D, own) {
    if (!own || !own.length) return null;
    var byT = {}; own.forEach(function (q) { byT[Math.round(q[0] / 1000)] = q; });
    var best = null;
    Object.keys(D).forEach(function (id) {
      var ds = []; D[id].forEach(function (q) { var o = byT[Math.round(q[0] / 1000)]; if (o) ds.push(Math.hypot((q[2] - o[2]) * 111320 * Math.cos(rad(q[1])), (q[1] - o[1]) * 110540)); });
      if (ds.length >= 60) { var m = med(ds); if (m < 30 && (!best || m < best.d)) best = { id: id, d: m }; }
    });
    return best ? best.id : null;
  }

  /* ---- zbir prvenstva za jednog brod ---- */
  function summary(races, me) {
    var keys = ['up', 'vmgUp', 'vmgDown', 'ta', 'tackLoss', 'start'], per = {};
    races.forEach(function (r) {
      r.rows.forEach(function (x) { var p = per[x.id] || (per[x.id] = { id: x.id, name: x.name, n: 0, rk: {} }); p.n++; keys.forEach(function (k) { if (x[k] !== null && x[k] !== undefined) (p[k] = p[k] || []).push(x[k]); }); });
      ['up', 'vmgUp', 'vmgDown'].forEach(function (k) {
        r.rows.filter(function (x) { return x[k] !== null; }).sort(function (a, b) { return b[k] - a[k]; }).forEach(function (x, i) { (per[x.id].rk[k] = per[x.id].rk[k] || []).push(i + 1); });
      });
    });
    var list = Object.keys(per).map(function (id) {
      var p = per[id], o = { id: id, name: p.name, races: p.n };
      ['up', 'vmgUp', 'vmgDown', 'ta'].forEach(function (k) { o[k] = p[k] ? avg(p[k]) : null; });
      o.tackLoss = p.tackLoss ? med(p.tackLoss) : null; o.start = p.start ? med(p.start) : null;
      o.rkUp = p.rk.up ? avg(p.rk.up) : null; o.rkVmgUp = p.rk.vmgUp ? avg(p.rk.vmgUp) : null; o.rkVmgDown = p.rk.vmgDown ? avg(p.rk.vmgDown) : null;
      return o;
    }).sort(function (a, b) { return (b.vmgUp || 0) - (a.vmgUp || 0); });
    var tips = [], m = list.filter(function (x) { return x.id === me; })[0];
    if (m && list.length > 2) {
      var others = list.filter(function (x) { return x !== m; }), bestUp = others.slice().sort(function (a, b) { return b.vmgUp - a.vmgUp; })[0];
      var taRef = avg(others.slice().sort(function (a, b) { return b.vmgUp - a.vmgUp; }).slice(0, 2).map(function (x) { return x.ta; }).filter(function (v) { return v !== null; }));
      if (m.rkUp !== null && m.rkVmgUp !== null && m.rkUp + 1 <= m.rkVmgUp) tips.push('Upwind you are among the fastest boats (speed rank ' + m.rkUp.toFixed(1) + ') but not in VMG (rank ' + m.rkVmgUp.toFixed(1) + ').' + (m.ta !== null && taRef && m.ta - taRef >= 4 ? ' Your tacking angle is ' + Math.round(m.ta) + '° against ' + Math.round(taRef) + '° for the best VMG boats: you sail about ' + Math.round((m.ta - taRef) / 2) + '° lower on each tack. Try to point higher and watch VMG, not only speed.' : ''));
      else if (m.rkVmgUp !== null && m.rkVmgUp <= 2) tips.push('Upwind VMG is one of your strengths (rank ' + m.rkVmgUp.toFixed(1) + ').');
      if (m.rkVmgDown !== null) tips.push(m.rkVmgDown <= 2 ? 'Downwind VMG is a strength (rank ' + m.rkVmgDown.toFixed(1) + ').' : 'Downwind VMG rank ' + m.rkVmgDown.toFixed(1) + ' (best: ' + others.slice().sort(function (a, b) { return b.vmgDown - a.vmgDown; })[0].name + ').');
      var tl = list.filter(function (x) { return x.tackLoss !== null; }).sort(function (a, b) { return a.tackLoss - b.tackLoss; });
      var ti = tl.indexOf(m); if (ti >= 0) tips.push(ti === 0 ? 'Your tacks lose the least in the fleet (' + m.tackLoss.toFixed(1) + ' m per tack).' : 'Tacks: ' + m.tackLoss.toFixed(1) + ' m per tack (best ' + tl[0].tackLoss.toFixed(1) + ' m, ' + tl[0].name + ').');
      var sl = list.filter(function (x) { return x.start !== null; }).sort(function (a, b) { return a.start - b.start; }), si = sl.indexOf(m);
      if (si >= 0) tips.push(si === 0 ? 'Your starts are the quickest: over the line ' + Math.round(m.start) + ' s after the gun (median).' : 'Starts: over the line ' + Math.round(m.start) + ' s after the gun (best ' + Math.round(sl[0].start) + ' s).');
    }
    return { list: list, tips: tips };
  }

  /* ---- zvanični rezultati (kopirano sa sajta / Sailwave HTML / CSV) ---- */
  function parseResults(txt) {
    var rows = [];
    if (/<table/i.test(txt) && typeof DOMParser !== 'undefined') {
      var doc = new DOMParser().parseFromString(txt, 'text/html');
      Array.prototype.forEach.call(doc.querySelectorAll('tr'), function (tr) { rows.push(Array.prototype.map.call(tr.querySelectorAll('th,td'), function (c) { return c.textContent.replace(/\s+/g, ' ').trim(); })); });
    } else {
      var hdr = (txt.split(/\r?\n/).filter(function (l) { return /\bR1\b/i.test(l); })[0] || ''), sep = hdr.indexOf('\t') >= 0 ? '\t' : hdr.indexOf(';') >= 0 ? ';' : hdr.indexOf(',') >= 0 ? ',' : null;
      txt.split(/\r?\n/).forEach(function (l) {
        if (!l.trim()) return;
        var c = sep && l.indexOf(sep) >= 0 ? l.split(sep) : l.split(/\s{2,}/);
        rows.push(c.map(function (x) { return x.replace(/"/g, '').trim(); }));
      });
    }
    var hi = -1, H = null;
    rows.some(function (r, i) { var low = r.map(function (x) { return x.toLowerCase(); }); if (low.some(function (x) { return /^r\d+$/.test(x); }) && low.some(function (x) { return /sail|helm|boat|skipper|crew/.test(x); })) { hi = i; H = low; return true; } return false; });
    if (hi < 0) return parseResultsLoose(txt);
    function col(re) { for (var k = 0; k < H.length; k++) if (re.test(H[k])) return k; return -1; }
    var cSail = col(/sail\s*no|^sail|^no\.?$|^nr/), cHelm = col(/helm|skipper|name/), cCrew = col(/crew/), cBoat = col(/^boat|yacht/), RC = [];
    H.forEach(function (h, k) { var m = /^r(\d+)$/.exec(h); if (m) RC.push([+m[1], k]); });
    var boats = [];
    rows.slice(hi + 1).forEach(function (r) {
      if (r.length < RC.length + 2) return;
      var places = {};
      RC.forEach(function (rc) {
        var v = (r[rc[1]] || '').replace(/[()]/g, ' ').trim(), num = parseFloat(v);
        places[rc[0]] = !isNaN(num) && !/DNF|DNS|DNC|RET|DSQ|OCS|BFD|UFD|DNE|RAF|NSC/i.test(v) ? num : null;
      });
      var sail = cSail >= 0 ? r[cSail] : '', helm = cHelm >= 0 ? r[cHelm] : '';
      if (!sail && !helm) return;
      boats.push({ sail: sail, helm: helm, crew: cCrew >= 0 ? r[cCrew] : '', boat: cBoat >= 0 ? r[cBoat] : '', places: places });
    });
    return boats.length ? { boats: boats, races: RC.map(function (x) { return x[0]; }) } : null;
  }
  // rezerva: tekst kopiran sa telefona (svaka ćelija u svom redu, prazne ćelije nestanu)
  function parseResultsLoose(txt) {
    if (/<table/i.test(txt) && typeof DOMParser !== 'undefined') txt = new DOMParser().parseFromString(txt, 'text/html').body.innerText || '';
    var T = [];
    txt.split(/\r?\n/).forEach(function (l) { l.split('\t').forEach(function (x) { x = x.trim(); if (x) T.push(x); }); });
    // spoji "(8.0" + "DNF)" i "8.0" + "RET"
    var U = [];
    T.forEach(function (x) {
      var last = U[U.length - 1];
      if (last && /^\(\d/.test(last) && !/\)$/.test(last)) { U[U.length - 1] = last + ' ' + x; return; }
      if (last && /^\(?\d+(\.\d+)?$/.test(last) && /^(DNF|DNS|DNC|RET|DSQ|OCS|BFD|UFD|DNE|RAF|NSC)\)?$/i.test(x)) { U[U.length - 1] = last + ' ' + x; return; }
      U.push(x);
    });
    var rIdx = []; U.forEach(function (x, i) { if (/^R\d+$/i.test(x)) rIdx.push(i); });
    if (!rIdx.length) return null;
    var N = rIdx.length, start = rIdx[rIdx.length - 1] + 1;
    while (start < U.length && !/^\d+$/.test(U[start])) start++; // preskoči Total / Nett
    var hasCrew = U.slice(0, rIdx[0]).some(function (x) { return /crew/i.test(x); });
    var isScore = function (x) { return /^\(?\d+(\.\d+)?( ?[A-Z]{3})?\)?$/i.test(x); };
    var boats = [], i = start, rank = 1;
    while (i < U.length) {
      if (U[i] !== String(rank)) { i++; continue; }
      // skupljaj do niza od N+2 rezultata (trke + Total + Nett) ili N
      var j = i + 1, pre = [];
      while (j < U.length && !(isScore(U[j]) && U.slice(j, j + N).every(isScore))) { pre.push(U[j]); j++; }
      if (j >= U.length) break;
      var sc = U.slice(j, j + N), places = {};
      sc.forEach(function (v, k) { var num = parseFloat(v.replace(/[()]/g, '')); places[k + 1] = !isNaN(num) && !/DNF|DNS|DNC|RET|DSQ|OCS|BFD|UFD|DNE|RAF|NSC/i.test(v) ? num : null; });
      var ni = -1; pre.forEach(function (x, k) { if (ni < 0 && /^[A-Z]{3}$/.test(x) && k + 1 < pre.length && /\d/.test(pre[k + 1])) ni = k; });
      var sail = ni >= 0 ? pre[ni] + ' ' + pre[ni + 1] : (pre.filter(function (x) { return /^\d{2,6}$/.test(x); })[0] || '');
      var helm = hasCrew ? pre[pre.length - 2] : pre[pre.length - 1], crew = hasCrew ? pre[pre.length - 1] : '';
      if (sail || helm) boats.push({ sail: sail, helm: helm || '', crew: crew || '', boat: '', places: places });
      rank++; i = j + N;
    }
    return boats.length >= 2 ? { boats: boats, races: Object.keys(boats[0].places).map(Number) } : null;
  }
  // uređaj -> brod iz rezultata: redosled na cilju u svakoj trci glasa, pobeđuje najčešće povezivanje
  function mapByResults(races, res) {
    var votes = {};
    races.forEach(function (r, i) {
      var n = i + 1, fin = r.rows.filter(function (x) { return x.finished; }).sort(function (a, b) { return a.elapsed - b.elapsed; });
      var off = res.boats.filter(function (b) { return b.places[n] !== null && b.places[n] !== undefined; }).sort(function (a, b) { return a.places[n] - b.places[n]; });
      fin.forEach(function (x, k) { var b = off[k]; if (!b) return; var v = votes[x.id] || (votes[x.id] = {}); v[b.sail] = (v[b.sail] || 0) + 1; });
    });
    var pairs = []; Object.keys(votes).forEach(function (d) { Object.keys(votes[d]).forEach(function (s) { pairs.push([votes[d][s], d, s]); }); });
    pairs.sort(function (a, b) { return b[0] - a[0]; });
    var map = {}, used = {};
    pairs.forEach(function (p) { if (map[p[1]] || used[p[2]]) return; var tot = 0; Object.keys(votes[p[1]]).forEach(function (s) { tot += votes[p[1]][s]; }); map[p[1]] = { sail: p[2], conf: p[0] / tot }; used[p[2]] = 1; });
    var out = {};
    Object.keys(map).forEach(function (d) { var b = res.boats.filter(function (x) { return x.sail === map[d].sail; })[0]; out[d] = { name: b.helm + (b.crew ? ' / ' + b.crew : ''), helm: b.helm, sail: b.sail, boat: b.boat, conf: map[d].conf, places: b.places }; });
    return out;
  }

  var api = { parseFleetCsv: parseFleetCsv, parseInfo: parseInfo, parseResults: parseResults, mapByResults: mapByResults, analyzeRace: analyzeRace, matchOwn: matchOwn, summary: summary };
  if (typeof window !== 'undefined') window.Regatta = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
