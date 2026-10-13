/* The Race App — "idealna putanja" za izabrani brod na jednom legu.
   1) vetar (smer + jačina) kroz vreme i prostor procenjen iz cele flote (kurs na orci ± pola ugla letanja, sredine letanja/halsovanja, brzina u odnosu na polar)
   2) polar klase iz istih podataka, brzina izabranog broda iz njegovog sopstvenog odnosa prema polaru
   3) izohrone: najbrži put od mesta i trenutka kad je izabrani brod započeo leg do bove, sa gubitkom na letanju */
(function () {
  'use strict';
  function rad(d) { return d * Math.PI / 180; }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function cmean(a) { var s = 0, c = 0; a.forEach(function (h) { s += Math.sin(rad(h)); c += Math.cos(rad(h)); }); return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360; }
  function med(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }

  // model vetra za celu trku (radi se jednom po trci)
  function buildModel(race, fleet, info) {
    var AX = race.wind, ids = Object.keys(fleet), o = null;
    ids.forEach(function (id) { if (!o && fleet[id].length) o = [fleet[id][0][1], fleet[id][0][2]]; });
    var kx = 111320 * Math.cos(rad(o[0])), ky = 110540, xy = function (la, lo) { return [(lo - o[1]) * kx, (la - o[0]) * ky]; };
    var tA = race.gun - 60000, tB = tA, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    ids.forEach(function (id) { fleet[id].forEach(function (q) { var p = xy(q[1], q[2]); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); tB = Math.max(tB, q[0]); }); });
    x0 -= 200; y0 -= 200; x1 += 200; y1 += 200;
    var DT = 20000, DS = 80, NT = Math.ceil((tB - tA) / DT) + 1, NX = Math.ceil((x1 - x0) / DS) + 1, NY = Math.ceil((y1 - y0) / DS) + 1;
    // 1) smer vetra: uzorci (t, x, y, smer, težina)
    var dirS = [], spdRaw = [], GY = 75; // ugao halsovanja (krma) po COG, tipično 65–80°
    ids.forEach(function (id) {
      var P = fleet[id], bi = (info && info[id]) || {}, ta = bi.ta || 88;
      for (var i = 2; i < P.length - 2; i++) {
        var q = P[i]; if (q[3] === null || q[3] < 1.5) continue;
        var a = P[i - 2], b = P[i + 2], p = xy(q[1], q[2]), pa = xy(a[1], a[2]), pb = xy(b[1], b[2]);
        if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 5) continue;
        var cog = (Math.atan2(pb[0] - pa[0], pb[1] - pa[1]) * 180 / Math.PI + 360) % 360, rel = nrm(cog - AX);
        // ravno jedrenje (bez okreta) na orci
        var c1 = (Math.atan2(p[0] - pa[0], p[1] - pa[1]) * 180 / Math.PI), c2 = (Math.atan2(pb[0] - p[0], pb[1] - p[1]) * 180 / Math.PI);
        if (Math.abs(nrm(c1 - c2)) > 12) continue;
        if (Math.abs(rel) < 75) { var w = rel < 0 ? cog + ta / 2 : cog - ta / 2; if (Math.abs(nrm(w - AX)) < 35) dirS.push([q[0], p[0], p[1], w, 1]); }
        else if (Math.abs(rel) > 110) { var rd = nrm(cog - AX - 180), w2 = cog + 180 + (rd < 0 ? GY / 2 : -GY / 2); if (Math.abs(nrm(w2 - AX)) < 35) dirS.push([q[0], p[0], p[1], w2, 0.5]); }
        spdRaw.push([q[0], p[0], p[1], q[3], cog, id]);
      }
    });
    function grid() { return { v: new Float64Array(NT * NX * NY), s: new Float64Array(NT * NX * NY), c: new Float64Array(NT * NX * NY), w: new Float64Array(NT * NX * NY) }; }
    function idx(ti, xi, yi) { return (ti * NX + xi) * NY + yi; }
    function cell(t, x, y) { return [Math.max(0, Math.min(NT - 1, Math.round((t - tA) / DT))), Math.max(0, Math.min(NX - 1, Math.round((x - x0) / DS))), Math.max(0, Math.min(NY - 1, Math.round((y - y0) / DS)))]; }
    // gaus po vremenu (sigma ~60 s) i prostoru (~250 m), odvojivo
    function blur(arr, axis, sig) {
      var r = Math.ceil(sig * 2.5), k = []; for (var i = -r; i <= r; i++) k.push(Math.exp(-i * i / (2 * sig * sig)));
      var out = new Float64Array(arr.length), dims = [NT, NX, NY];
      for (var ti = 0; ti < NT; ti++) for (var xi = 0; xi < NX; xi++) for (var yi = 0; yi < NY; yi++) {
        var c = [ti, xi, yi], s = 0;
        for (var j = -r; j <= r; j++) { var cc = c.slice(); cc[axis] += j; if (cc[axis] < 0 || cc[axis] >= dims[axis]) continue; s += arr[idx(cc[0], cc[1], cc[2])] * k[j + r]; }
        out[idx(ti, xi, yi)] = s;
      }
      return out;
    }
    function smooth(arr) { return blur(blur(blur(arr, 0, 3), 1, 3), 2, 3); }
    // smer kao sin/cos
    var S1 = new Float64Array(NT * NX * NY), C1 = new Float64Array(NT * NX * NY), W1 = new Float64Array(NT * NX * NY);
    dirS.forEach(function (d) { var c = cell(d[0], d[1], d[2]), k = idx(c[0], c[1], c[2]); S1[k] += Math.sin(rad(d[3])) * d[4]; C1[k] += Math.cos(rad(d[3])) * d[4]; W1[k] += d[4]; });
    S1 = smooth(S1); C1 = smooth(C1); W1 = smooth(W1);
    // samo vreme (rezerva kad u blizini nema podataka)
    var tS = new Float64Array(NT), tC = new Float64Array(NT);
    dirS.forEach(function (d) { var ti = cell(d[0], 0, 0)[0]; tS[ti] += Math.sin(rad(d[3])); tC[ti] += Math.cos(rad(d[3])); });
    var tS2 = new Float64Array(NT), tC2 = new Float64Array(NT);
    for (var ti = 0; ti < NT; ti++) for (var j = -6; j <= 6; j++) { var u = ti + j; if (u < 0 || u >= NT) continue; var g = Math.exp(-j * j / 18); tS2[ti] += tS[u] * g; tC2[ti] += tC[u] * g; }
    function dirAt(t, x, y) {
      var c = cell(t, x, y), k = idx(c[0], c[1], c[2]), w = W1[k], s = S1[k], co = C1[k], ts = tS2[c[0]], tc = tC2[c[0]];
      var f = Math.min(1, w / 2); // malo podataka u blizini -> više vremenske serije
      var sx = f * (w ? s / w : 0) + (1 - f) * (ts || Math.sin(rad(AX))) / (Math.hypot(ts, tc) || 1), cx = f * (w ? co / w : 0) + (1 - f) * (tc || Math.cos(rad(AX))) / (Math.hypot(ts, tc) || 1);
      return (Math.atan2(sx, cx) * 180 / Math.PI + 360) % 360;
    }
    // 2) polar svakog broda: oblik tipičnog kobiličnog broda sa asimetrikom, skaliran SOPSTVENIM brzinama i uglom letanja tog broda
    function makePolar(bi, Bm) {
      var VU = bi.up || 4, VD = bi.down || 4.5, B = Bm || Math.max(36, Math.min(52, (bi.ta || 88) / 2)), DW = 180 - GY / 2, mn = B - 10;
      var f = function (twa) {
        if (twa < mn) return 0;
        if (twa < B) return VU * (0.55 + 0.45 * (twa - mn) / (B - mn));
        if (twa < 90) return VU * (1 + 0.12 * (twa - B) / (90 - B));
        if (twa < 120) return VU * 1.12 + (VD * 1.12 - VU * 1.12) * (twa - 90) / 30;
        if (twa <= DW) return VD * (1.12 - 0.12 * (twa - 120) / (DW - 120));
        return VD * (1 - 0.15 * (twa - DW) / (180 - DW));
      };
      f.min = mn; return f;
    }
    // 3) pritisak: brzina broda u odnosu na njegovu uobičajenu brzinu na orci / krmi, izglađeno kroz vreme i prostor
    var PS = new Float64Array(NT * NX * NY), PW = new Float64Array(NT * NX * NY);
    spdRaw.forEach(function (r) {
      var bi = (info && info[r[5]]) || {}, rel = Math.abs(nrm(r[4] - AX)), base = rel < 75 ? bi.up : rel > 105 ? bi.down : null; if (!base) return;
      var c = cell(r[0], r[1], r[2]), k = idx(c[0], c[1], c[2]); PS[k] += Math.max(0.5, Math.min(1.6, r[3] / base)); PW[k] += 1;
    });
    PS = smooth(PS); PW = smooth(PW);
    function pressAt(t, x, y) { var c = cell(t, x, y), k = idx(c[0], c[1], c[2]); var w = PW[k]; return w > 0.3 ? Math.max(0.7, Math.min(1.3, PS[k] / w)) : 1; }
    return { xy: xy, toLL: function (p) { return [o[0] + p[1] / ky, o[1] + p[0] / kx]; }, dirAt: dirAt, makePolar: makePolar, pressAt: pressAt, AX: AX };
  }

  // izohrone za jedan leg
  function route(model, start, t0, target, up, pol, penaltyS, maxS) {
    var M = model, tgt = M.xy(target[0], target[1]), dt = 10, R = 35;
    var sB = (Math.atan2(tgt[0] - start[0], tgt[1] - start[1]) * 180 / Math.PI + 360) % 360;
    var front = [{ p: start, t: t0, side: 0, par: null }], all = [];
    for (var step = 0; step * dt < maxS; step++) {
      var next = {};
      front.forEach(function (s) {
        var W = M.dirAt(s.t, s.p[0], s.p[1]), pr = M.pressAt(s.t, s.p[0], s.p[1]);
        for (var a = -180; a < 180; a += 4) {
          var twa = Math.abs(a); if (twa < pol.min) continue;
          var v = pol(twa) * pr * 0.514444; if (v <= 0.2) continue;
          var side = a < 0 ? -1 : 1, eff = dt - (s.side && side !== s.side ? Math.min(dt, penaltyS) : 0);
          var h = rad(W + a), np = [s.p[0] + Math.sin(h) * v * eff, s.p[1] + Math.cos(h) * v * eff];
          var b = (Math.atan2(np[0] - start[0], np[1] - start[1]) * 180 / Math.PI + 360) % 360, sec = Math.round(nrm(b - sB) / 2);
          var rem = Math.hypot(tgt[0] - np[0], tgt[1] - np[1]);
          var cand = { p: np, t: s.t + dt * 1000, side: side, par: s, rem: rem };
          if (!next[sec] || rem < next[sec].rem) next[sec] = cand;
        }
      });
      front = Object.keys(next).map(function (k) { return next[k]; });
      if (!front.length) return null;
      front.sort(function (x, y) { return x.rem - y.rem; });
      if (front[0].rem < R) { var path = [], s = front[0]; while (s) { path.unshift(M.toLL(s.p)); s = s.par; } var nt = 0; for (var u = front[0]; u && u.par; u = u.par) if (u.par.side && u.side !== u.par.side) nt++; return { path: path, secs: (front[0].t - t0) / 1000, tacks: nt }; }
      front = front.slice(0, 120);
    }
    return null;
  }

  // idealni put izabranog broda za sve legove trke
  function optimal(race, fleet, boatId, info, model) {
    var M = model || buildModel(race, fleet, info), out = [];
    var bi = (info && info[boatId]) || {}, P = fleet[boatId];
    if (!P || !race.legs) return out;
    race.legs.forEach(function (L) {
      var b = L.boats[boatId]; if (!b || !b.t0) { out.push(null); return; }
      var q = P.filter(function (x) { return x[0] <= b.t0; }).pop() || P[0], start = M.xy(q[1], q[2]);
      var target = L.up ? race.targets.top : race.targets.bottom;
      var spd = L.up ? (bi.up || 4) : (bi.down || 4), pen = Math.max(4, Math.min(15, ((bi.tackLoss || 3) / Math.max(1, spd * 0.514)) + 4));
      // poravnanje modela sa samim brodom: sredina njegova dva kursa (levi/desni bok) na ovom legu = vetar (krma: +180)
      var segA = P.filter(function (x) { return x[0] >= b.t0 && x[0] <= b.t1; }), hs = [], ws = [];
      for (var j = 2; j < segA.length; j++) { var p0 = M.xy(segA[j - 2][1], segA[j - 2][2]), p1 = M.xy(segA[j][1], segA[j][2]); if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 4) continue; hs.push((Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180 / Math.PI + 360) % 360); ws.push(M.dirAt(segA[j][0], p1[0], p1[1])); }
      var mW = ws.length ? cmean(ws) : M.AX, ref = L.up ? mW : (mW + 180) % 360, aS = [], bS = [];
      hs.forEach(function (h) { var r0 = nrm(h - ref); if (Math.abs(r0) > 15 && Math.abs(r0) < 80) (r0 < 0 ? aS : bS).push(h); });
      var off = 0;
      if (aS.length > 5 && bS.length > 5) { var mid = cmean([cmean(aS), cmean(bS)]); if (!L.up) mid = (mid + 180) % 360; off = nrm(mid - mW); if (Math.abs(off) > 25) off = 0; }
      var M2 = Object.create(M); M2.dirAt = function (t, x, y) { return (M.dirAt(t, x, y) + off + 360) % 360; };
      // ugao na orci koji je brod STVARNO držao na ovom legu (prema istom modelu vetra) -> polar ne može da "orca" više od broda
      var tw = []; for (var jj = 0; jj < hs.length; jj++) { var rr = Math.abs(nrm(hs[jj] - ((ws[jj] + off + 360) % 360))); if (L.up && rr > 25 && rr < 75) tw.push(rr); }
      var Bm = tw.length > 10 ? Math.max(34, Math.min(55, med(tw))) : null;
      var pol = M.makePolar(bi, L.up ? Bm : null), r = route(M2, start, b.t0, target, L.up, pol, pen, b.dur * 1.6 + 60);
      // kalibracija: stvarni put broda "odjedren" kroz isti model -> poređenje u istim jedinicama
      var seg0 = P.filter(function (x) { return x[0] >= b.t0 && x[0] <= b.t1; }), seg = [], mt = 0, tacks = 0, ps = null, Bq = pol.min + 10;
      seg0.forEach(function (x) { if (!seg.length || x[0] - seg[seg.length - 1][0] >= 10000) seg.push(x); }); if (seg0.length) seg.push(seg0[seg0.length - 1]);
      for (var i = 1; i < seg.length; i++) {
        var a = M.xy(seg[i - 1][1], seg[i - 1][2]), c = M.xy(seg[i][1], seg[i][2]), d = Math.hypot(c[0] - a[0], c[1] - a[1]); if (d < 2) continue;
        var h = Math.atan2(c[0] - a[0], c[1] - a[1]) * 180 / Math.PI, W = M2.dirAt(seg[i][0], c[0], c[1]), rel = nrm(h - W), twa = L.up ? Math.max(Math.abs(rel), Bq) : Math.abs(rel);
        var sd = rel < 0 ? -1 : 1; if (ps && sd !== ps && Math.abs(rel) > 20) tacks++; if (Math.abs(rel) > 20) ps = sd;
        var v = pol(twa) * M.pressAt(seg[i][0], c[0], c[1]) * 0.514444; mt += d / Math.max(0.3, v);
      }
      mt += tacks * pen;
      if (r && mt > 0) { var k = Math.max(0.85, Math.min(1.15, b.dur / mt)), opt = Math.min(b.dur, r.secs * k); out.push({ path: r.path, secs: opt, actual: b.dur, gain: b.dur - opt, k: k, off: off, raw: r.secs, mt: mt, tacks: tacks, pen: pen, B: pol.min + 10, rTacks: r.tacks }); }
      else out.push(null);
    });
    return out;
  }
  var api = { buildModel: buildModel, optimal: optimal };
  if (typeof window !== 'undefined') window.Router = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
