/* The Race App — analiza manevara (halsovi, gybe-ovi, bear-away, round-up) iz snimljenog traga.
   Tačka traga: [t, lat, lon, sog, cog, heel, acc, x?]  x = [phase, leg, side, ref, lift, axis, mode, refSrc, timer] */
(function () {
  'use strict';
  function rad(d) { return d * Math.PI / 180; }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function cmean(a) { var s = 0, c = 0; a.forEach(function (h) { s += Math.sin(rad(h)); c += Math.cos(rad(h)); }); return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360; }
  function avg(a) { if (!a.length) return null; var s = 0; a.forEach(function (v) { s += v; }); return s / a.length; }
  function xy(o, q) { return { x: rad(q[2] - o[2]) * 6371000 * Math.cos(rad(o[1])), y: rad(q[1] - o[1]) * 6371000 }; }

  function analyze(points, opt) {
    opt = opt || {};
    var P = points.filter(function (q) { return q && q[1] !== null && q[2] !== null; });
    var n = P.length; if (n < 40) return { list: [], axis: null, summary: null };
    var T = P.map(function (q) { return q[0] / 1000; });
    var S = P.map(function (q) { return q[3] || 0; });
    var H = [], last = null;
    P.forEach(function (q) { if (q[4] !== null && q[4] !== undefined && (q[3] || 0) > 0.8) last = q[4]; H.push(last); });
    function idxAt(t) { var lo = 0, hi = n - 1; while (lo < hi) { var m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; } return lo; }
    function range(t0, t1) { var a = []; for (var i = idxAt(t0); i < n && T[i] <= t1; i++) a.push(i); return a; }
    function hd(ix) { return ix.map(function (i) { return H[i]; }).filter(function (h) { return h !== null; }); }

    // 1) kandidati: razlika kursa pre/posle tačke >= 50°
    var D = new Array(n).fill(0), PRE = [], POST = [];
    for (var i = 0; i < n; i++) {
      var a = hd(range(T[i] - 14, T[i] - 4)), b = hd(range(T[i] + 4, T[i] + 14));
      var va = avg(range(T[i] - 14, T[i] - 4).map(function (k) { return S[k]; }));
      if (a.length >= 4 && b.length >= 4 && va !== null && va > 1.2) { PRE[i] = cmean(a); POST[i] = cmean(b); D[i] = Math.abs(nrm(POST[i] - PRE[i])); }
    }
    var cands = [];
    for (i = 0; i < n; i++) {
      if (D[i] < 50) continue;
      var j = i, best = i;
      while (j + 1 < n && D[j + 1] >= 50 && T[j + 1] - T[j] < 4) { j++; if (D[j] > D[best]) best = j; }
      cands.push(best); i = j;
    }
    // 2) početak/kraj okreta
    var list = cands.map(function (c) {
      var pre = PRE[c], post = POST[c], s = c, e = c;
      while (s > 0 && T[c] - T[s] < 20 && (H[s] === null || Math.abs(nrm(H[s] - pre)) > 10)) s--;
      while (e < n - 1 && T[e] - T[c] < 20 && (H[e] === null || Math.abs(nrm(H[e] - post)) > 10)) e++;
      var ax = P[c][7] && P[c][7][5] !== '' && P[c][7][5] !== undefined ? +P[c][7][5] : null;
      return { c: c, s: s, e: e, t: P[c][0], pre: pre, post: post, turn: Math.abs(nrm(post - pre)), dir: nrm(post - pre) > 0 ? 1 : -1, recAxis: ax };
    });
    if (!list.length) return { list: [], axis: null, summary: null };

    // 3) osa vetra. Snimljena osa je samo početna pretpostavka (live mod je mogao da je pogrešno nauči, npr. iz orcanja niz vetar).
    //    Prava osa se računa iz samog traga: sredina kursa pre/posle halsa = pravac vetra; lokalno, iz najbližih halsova.
    var U = opt.axis !== undefined && opt.axis !== null ? opt.axis : null;
    var rec = list.filter(function (m) { return m.recAxis !== null; });
    var est = null;
    if (rec.length) est = cmean(rec.map(function (m) { return m.recAxis; }));
    else {
      // histogram dvostrukog ugla sredina manevara 60–130° (halsovi i gybe-ovi imaju sredinu na osi ili osi+180)
      var bins = new Array(36).fill(0);
      list.forEach(function (m) { if (m.turn >= 60 && m.turn <= 130) { var mid = cmean([m.pre, m.post]); bins[Math.floor(((2 * mid) % 360) / 10)] += 1; } });
      var bi = 0; for (var k = 1; k < 36; k++) if (bins[k] + 0.5 * (bins[(k + 35) % 36] + bins[(k + 1) % 36]) > bins[bi] + 0.5 * (bins[(bi + 35) % 36] + bins[(bi + 1) % 36])) bi = k;
      var mids = []; list.forEach(function (m) { if (m.turn >= 60 && m.turn <= 130) { var mid = cmean([m.pre, m.post]), d2 = Math.abs(nrm(2 * mid - (bi * 10 + 5))); if (d2 < 30) mids.push(mid); } });
      if (mids.length) {
        var A = cmean(mids.map(function (m) { return (2 * m) % 360; })) / 2; // osa mod 180
        // smer uz vetar: strana gde je nagib veći
        function heelScore(axis) { var hs = [], i2; for (i2 = 0; i2 < n; i2++) if (H[i2] !== null && P[i2][5] !== null && Math.abs(P[i2][5]) < 35 && Math.abs(nrm(H[i2] - axis)) < 70) hs.push(Math.abs(P[i2][5])); hs.sort(function (x, y) { return x - y; }); return hs.length ? hs[hs.length >> 1] : 0; }
        est = heelScore(A) >= heelScore((A + 180) % 360) ? A : (A + 180) % 360;
      }
    }
    // halsovi (i gybe-ovi): oba kursa sa iste strane vetra, široko, i prelaz preko ose; sredina = osa (gybe: sredina + 180)
    function axMids(ax, gy) {
      var d = gy ? (ax + 180) % 360 : ax;
      return list.filter(function (m) {
        if (m.turn < 50 || m.turn > 130) return false;
        var a = nrm(m.pre - d), b = nrm(m.post - d);
        return Math.abs(a) < 90 && Math.abs(b) < 90 && Math.abs(a) > 12 && Math.abs(b) > 12 && (a > 0) !== (b > 0);
      }).map(function (m) { var c = cmean([m.pre, m.post]); return { t: m.t, mid: gy ? (c + 180) % 360 : c }; });
    }
    // na reci struja krivi kurs niz vetar, pa gybe-ovi pomažu samo kad halsova ima manje od 2
    function refs(ax) { var tm = axMids(ax, false); return tm.length >= 2 ? tm : tm.concat(axMids(ax, true)); }
    var TM = est !== null ? refs(est) : [];
    for (var it = 0; it < 2 && TM.length; it++) { est = cmean(TM.map(function (x) { return x.mid; })); TM = refs(est); }
    function localAxis(m) {
      if (U !== null) return U;
      if (!TM.length) return est;
      var near = TM.slice().sort(function (a, b) { return Math.abs(a.t - m.t) - Math.abs(b.t - m.t); }).slice(0, 3)
        .filter(function (x, k) { return k === 0 || Math.abs(x.t - m.t) < 10 * 60000; });
      var la = cmean(near.map(function (x) { return x.mid; }));
      return Math.abs(nrm(la - est)) < 40 ? la : est;
    }
    function axisFor(m) { return localAxis(m); }

    // 4) klasifikacija i gubitak
    list.forEach(function (m, idx) {
      var Ua = axisFor(m); m.axis = Ua;
      if (Ua === null) { m.kind = 'turn'; } else {
        var rp = Math.abs(nrm(m.pre - Ua)), rq = Math.abs(nrm(m.post - Ua));
        // uz vetar < 80°, niz vetar > 95°; između (npr. orcanje na krmi u refuli) = običan okret bez ocene
        var up1 = rp < 80, dn1 = rp > 95, up2 = rq < 80, dn2 = rq > 95;
        m.kind = up1 && up2 ? 'tack' : dn1 && dn2 ? 'gybe' : up1 && dn2 ? 'bearaway' : dn1 && up2 ? 'roundup' : 'turn';
        if (m.kind === 'tack' && (nrm(m.pre - Ua) > 0) === (nrm(m.post - Ua) > 0)) m.kind = 'turn'; // bez prelaza preko ose nije hals (gybe ne proveravamo: na reci struja krivi COG niz vetar)
      }
      var ts = T[m.s], nextS = idx + 1 < list.length ? T[list[idx + 1].s] : Infinity, prevE = idx > 0 ? T[list[idx - 1].e] : -Infinity;
      var entryIx = range(Math.max(ts - 12, prevE + 2), ts - 2);
      m.vIn = avg(entryIx.map(function (k) { return S[k]; }));
      var w0 = ts - 2, w1 = Math.min(ts + 30, nextS - 2);
      var winIx = range(w0, w1);
      m.vMin = winIx.length ? Math.min.apply(null, winIx.map(function (k) { return S[k]; })) : null;
      var exitIx = range(w1 - 5, w1); m.vOut = avg(exitIx.map(function (k) { return S[k]; }));
      m.dur = T[m.e] - ts;
      m.rec = null;
      if (m.vIn) {
        var aft = winIx.filter(function (k) { return T[k] >= ts; });
        var iMin = aft.reduce(function (b2, k) { return S[k] < S[b2] ? k : b2; }, aft[0] || m.c);
        for (var k2 = iMin; k2 < n && T[k2] <= ts + 45; k2++) if (S[k2] >= 0.9 * m.vIn) { m.rec = T[k2] - ts; break; }
      }
      m.loss = null;
      if ((m.kind === 'tack' || m.kind === 'gybe') && Ua !== null && winIx.length > 5 && w1 - w0 >= 12) {
        var dirA = m.kind === 'tack' ? Ua : (Ua + 180) % 360, ux = Math.sin(rad(dirA)), uy = Math.cos(rad(dirA));
        var vmgIn = avg(entryIx.map(function (k) { return S[k] * Math.cos(rad(nrm((H[k] === null ? m.pre : H[k]) - dirA))); }));
        var a0 = P[winIx[0]], a1 = P[winIx[winIx.length - 1]], d = xy(a0, a1);
        // cilj = prosek VMG pre i posle (posle = mirni deo novog borda), da šift ili struja na jednom halsu ne iskrive rezultat
        var outIx = range(T[m.e] + 6, Math.min(T[m.e] + 20, nextS - 2));
        var vmgOut = outIx.length >= 5 ? avg(outIx.map(function (k) { return S[k] * Math.cos(rad(nrm((H[k] === null ? m.post : H[k]) - dirA))); })) : null;
        var target = vmgOut !== null && vmgOut > 0.3 ? (vmgIn + vmgOut) / 2 : vmgIn;
        var made = d.x * ux + d.y * uy, ideal = (target || 0) / 1.943844 * (T[winIx[winIx.length - 1]] - T[winIx[0]]);
        if (vmgIn && vmgIn > 0.5) m.loss = ideal - made;
        m.vmgOut = vmgOut;
        m.vmgIn = vmgIn;
      }
      m.lat = P[m.c][1]; m.lon = P[m.c][2];
    });

    // 5) sažetak
    function sum(kind) {
      var a = list.filter(function (m) { return m.kind === kind && m.loss !== null; });
      if (!a.length) return null;
      var l = a.map(function (m) { return m.loss; });
      var bi2 = 0, wi = 0; a.forEach(function (m, x) { if (m.loss < a[bi2].loss) bi2 = x; if (m.loss > a[wi].loss) wi = x; });
      return { n: list.filter(function (m) { return m.kind === kind; }).length, avgLoss: avg(l), best: a[bi2], worst: a[wi], avgRec: avg(a.filter(function (m) { return m.rec !== null; }).map(function (m) { return m.rec; })) };
    }
    return { list: list, axis: U !== null ? U : est, summary: { tack: sum('tack'), gybe: sum('gybe') } };
  }
  if (typeof window !== 'undefined') window.Maneuvers = { analyze: analyze };
  if (typeof module !== 'undefined') module.exports = { analyze: analyze };
})();
