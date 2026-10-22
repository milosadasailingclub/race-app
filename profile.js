/* The Race App — profil: ime, broj jedra, klasa broda.
   Biblioteka klasa raste postepeno (polari i pravila se dodaju kad imamo pouzdane podatke).
   Custom klasa (PRO): ime, ključna pravila klase, polarni dijagram (nalepi tabelu). */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) {} }
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // kind: keel / dinghy / multi · spi: sym / asym / none. Polari: null dok ne unesemo proverene podatke.
  var CLASSES = [
    { id: 'seascape18', name: 'Seascape 18 / First 18', kind: 'keel', spi: 'asym', polarSrc: 'ORC, median of 8 certificates (via windregatta.com)', polar: {
      tws: [4, 6, 8, 10, 12, 14, 16, 20, 24], twa: [52, 60, 75, 90, 110, 120, 135, 150],
      v: [[3.29, 4.45, 5.21, 5.63, 5.93, 6.09, 6.20, 6.37, 6.44], [3.50, 4.65, 5.38, 5.80, 6.18, 6.40, 6.54, 6.76, 6.89], [3.62, 4.76, 5.47, 5.97, 6.46, 6.88, 7.14, 7.54, 7.76],
        [3.65, 4.87, 5.69, 6.28, 6.66, 7.14, 7.68, 8.40, 8.95], [3.69, 4.91, 5.77, 6.53, 7.36, 7.98, 8.51, 9.63, 11.22], [3.55, 4.78, 5.64, 6.38, 7.25, 8.19, 9.12, 10.96, 12.43],
        [3.12, 4.32, 5.27, 5.96, 6.66, 7.51, 8.45, 12.21, 14.24], [2.59, 3.69, 4.64, 5.39, 5.95, 6.53, 7.29, 9.99, 13.20]],
      beat: { twa: [42.0, 41.9, 40.2, 38.3, 37.0, 36.9, 36.7, 37.0, 37.8], vmg: [2.18, 2.98, 3.58, 3.98, 4.21, 4.28, 4.34, 4.40, 4.39] },
      run: { twa: [145.8, 145.8, 148.3, 149.8, 148.8, 145.8, 144.8, 136.1, 142.3], vmg: [2.25, 3.20, 4.02, 4.65, 5.16, 5.68, 6.32, 8.71, 11.40] } },
      // North Sails speed guide: TACK / JIBE = pravi ugao letanja / halsovanja (uključuje zanošenje), uporedivo sa GPS merenjem
      // naučeno iz trekera (privremeno, Palić 2026: 9 trka, nestabilan vetar, ~8 kn): norme klase za ocenu manevara i uglova
      // po stanju mora: flat = ravna voda (brzo ubrzanje, mali gubici); chop / swell se popunjavaju kad stignu tragovi
      learned: { flat: { src: 'Palić 2026 fleet tracks (9 races, flat water, shifty, ~8 kn)', tackLossM: 3.0, tackRecS: 12, gybeLossM: 1.6, gybeRecS: 10, steadyTackAt8: 79, dnDeeperDeg: 4 }, chop: null, swell: null },
      guideSrc: 'North Sails Seascape 18 speed guide', guide: {
        up: { tws: [6, 8, 10, 12, 14, 16, 20], bs: [3.9, 4.7, 5.1, 5.2, 5.3, 5.3, 5.4], vmg: [2.9, 3.5, 4.0, 4.2, 4.3, 4.3, 4.4], heel: [9, 10, 12, 15, 16, 16, 18], twa: [42, 40, 38, 36, 36, 35, 35], turn: [90, 86, 84, 80, 75, 75, 75] },
        dn: { tws: [6, 8, 10, 12, 14, 16, 20], bs: [3.9, 4.8, 5.4, 5.8, 6.2, 7.6, 12.1], vmg: [3.2, 4.1, 4.7, 5.0, 5.4, 6.1, 8.8], heel: [5, 5, 6, 6, 6, 7, 10], twa: [147, 148, 150, 150, 150, 143, 137], turn: [85, 80, 70, 65, 65, 75, 80] } } },
    { id: 'seascape24', name: 'Seascape 24 / First 24', kind: 'keel', spi: 'asym' },
    { id: 'seascape27', name: 'Seascape 27 / First 27', kind: 'keel', spi: 'asym' },
    { id: 'j70', name: 'J/70', kind: 'keel', spi: 'asym' },
    { id: 'j80', name: 'J/80', kind: 'keel', spi: 'asym' },
    { id: 'melges24', name: 'Melges 24', kind: 'keel', spi: 'asym' },
    { id: 'sb20', name: 'SB20', kind: 'keel', spi: 'asym' },
    { id: 'platu25', name: 'Platu 25', kind: 'keel', spi: 'sym' },
    { id: 'dragon', name: 'Dragon', kind: 'keel', spi: 'sym' },
    { id: 'etchells', name: 'Etchells', kind: 'keel', spi: 'sym' },
    { id: 'soling', name: 'Soling', kind: 'keel', spi: 'sym' },
    { id: 'star', name: 'Star', kind: 'keel', spi: 'none' },
    { id: 'tempest', name: 'Tempest', kind: 'keel', spi: 'sym' },
    { id: 'ilca7', name: 'ILCA 7', kind: 'dinghy', spi: 'none' },
    { id: 'ilca6', name: 'ILCA 6', kind: 'dinghy', spi: 'none' },
    { id: 'ilca4', name: 'ILCA 4', kind: 'dinghy', spi: 'none' },
    { id: 'finn', name: 'Finn', kind: 'dinghy', spi: 'none' },
    { id: 'optimist', name: 'Optimist', kind: 'dinghy', spi: 'none' },
    { id: '420', name: '420', kind: 'dinghy', spi: 'sym' },
    { id: '470', name: '470', kind: 'dinghy', spi: 'sym' },
    { id: '49er', name: '49er', kind: 'dinghy', spi: 'asym' },
    { id: 'fd', name: 'Flying Dutchman', kind: 'dinghy', spi: 'sym' },
    { id: 'pirat', name: 'Pirat', kind: 'dinghy', spi: 'none' },
    { id: 'nacra17', name: 'Nacra 17', kind: 'multi', spi: 'asym' }
  ];
  function customs() { return sget('customClasses', []); }
  function all() { return CLASSES.concat(customs().map(function (c) { return Object.assign({ custom: true }, c); })); }
  function get(id) { return all().filter(function (c) { return c.id === id; })[0] || null; }
  function current() { return get(sget('boatClass', '')); }

  /* ---- polar: nalepljena tabela. Prvi red: TWS (čvorovi), prva kolona: TWA (°), ćelije: brzina broda (kn).
     Prihvata ; , tab ili razmake; red "beat"/"run" (optimalni uglovi) se preskače ako nije broj. ---- */
  function parsePolar(txt) {
    var rows = String(txt || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { return l.split(/[;\t,]\s*|\s+/).filter(function (x) { return x !== ''; }); });
    if (rows.length < 3) return null;
    var tws = rows[0].slice(1).map(parseFloat).filter(function (v) { return !isNaN(v); }); if (tws.length < 2) return null;
    var out = [];
    rows.slice(1).forEach(function (r) { var a = parseFloat(r[0]); if (isNaN(a) || a < 0 || a > 180) return; var v = r.slice(1, tws.length + 1).map(parseFloat); if (v.some(isNaN)) return; out.push([a, v]); });
    if (out.length < 3) return null;
    out.sort(function (x, y) { return x[0] - y[0]; });
    return { tws: tws, twa: out.map(function (x) { return x[0]; }), v: out.map(function (x) { return x[1]; }) };
  }
  // brzina iz polara (bilinearno)
  function speed(P, tws, twa) {
    if (!P) return null; twa = Math.abs(twa);
    function ix(a, x) { if (x <= a[0]) return [0, 0, 0]; if (x >= a[a.length - 1]) return [a.length - 1, a.length - 1, 0]; for (var i = 1; i < a.length; i++) if (x <= a[i]) return [i - 1, i, (x - a[i - 1]) / (a[i] - a[i - 1])]; }
    var s = ix(P.tws, tws), a = ix(P.twa, twa), g = function (ai, si) { return P.v[ai][si]; };
    var v0 = g(a[0], s[0]) + (g(a[0], s[1]) - g(a[0], s[0])) * s[2], v1 = g(a[1], s[0]) + (g(a[1], s[1]) - g(a[1], s[0])) * s[2];
    var lin = function (arr) { return arr[s[0]] + (arr[s[1]] - arr[s[0]]) * s[2]; };
    if (twa < P.twa[0]) {
      if (!P.beat) return 0;
      var ba = lin(P.beat.twa), bs = lin(P.beat.vmg) / Math.cos(ba * Math.PI / 180);
      if (twa >= ba) return bs + (v0 - bs) * (twa - ba) / (P.twa[0] - ba);
      return Math.max(0, bs * (1 - (ba - twa) / 12));
    }
    if (twa > P.twa[P.twa.length - 1]) return v1 * (1 - 0.15 * (twa - P.twa[P.twa.length - 1]) / (180 - P.twa[P.twa.length - 1]));
    return v0 + (v1 - v0) * a[2];
  }
  // optimalni ugao na orci / krmi (najveći VMG) za datu jačinu vetra
  function targets(P, tws) {
    if (!P) return null; var up = [0, 0], dn = [0, 0];
    if (P.beat && P.run) {
      var ix = function (x) { var a = P.tws; if (x <= a[0]) return [0, 0, 0]; if (x >= a[a.length - 1]) return [a.length - 1, a.length - 1, 0]; for (var i = 1; i < a.length; i++) if (x <= a[i]) return [i - 1, i, (x - a[i - 1]) / (a[i] - a[i - 1])]; }, q = ix(tws), L = function (arr) { return arr[q[0]] + (arr[q[1]] - arr[q[0]]) * q[2]; };
      var bt = L(P.beat.twa), bv = L(P.beat.vmg), rt = L(P.run.twa), rv = L(P.run.vmg);
      return { upTwa: Math.round(bt), upVmg: bv, upBs: bv / Math.cos(bt * Math.PI / 180), dnTwa: Math.round(rt), dnVmg: rv, dnBs: rv / -Math.cos(rt * Math.PI / 180) };
    }
    for (var a = 30; a <= 180; a++) { var v = speed(P, tws, a), vmg = v * Math.cos(a * Math.PI / 180); if (vmg > up[1]) up = [a, vmg]; if (-vmg > dn[1]) dn = [a, -vmg]; }
    return { upTwa: up[0], upVmg: up[1], upBs: speed(P, tws, up[0]), dnTwa: dn[0], dnVmg: dn[1], dnBs: speed(P, tws, dn[0]) };
  }
  // vrednosti iz speed guide-a za datu jačinu vetra (linearno između redova)
  function guideAt(G, tws) {
    if (!G) return null;
    function at(T) { var a = T.tws, i = 1; if (tws <= a[0]) i = 1; else if (tws >= a[a.length - 1]) i = a.length - 1; else while (a[i] < tws) i++; var f = Math.max(0, Math.min(1, (tws - a[i - 1]) / (a[i] - a[i - 1]))), o = {}; ['bs', 'vmg', 'heel', 'twa', 'turn'].forEach(function (k) { o[k] = T[k][i - 1] + (T[k][i] - T[k][i - 1]) * f; }); return o; }
    return { up: at(G.up), dn: at(G.dn) };
  }
  // procena jačine vetra iz brzina najboljih brodova (obrnuto iz tabele brzina: orca i krma)
  function estTws(G, upS, dnS) {
    if (!G) return null;
    function inv(T, v) { if (v === null || v === undefined) return null; var b = T.bs, w = T.tws; if (v <= b[0]) return w[0]; for (var i = 1; i < b.length; i++) if (v <= b[i] && b[i] > b[i - 1]) return w[i - 1] + (w[i] - w[i - 1]) * (v - b[i - 1]) / (b[i] - b[i - 1]); return w[w.length - 1]; }
    var a = [inv(G.up, upS), inv(G.dn, dnS)].filter(function (x) { return x !== null; });
    return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null;
  }
  // teorija za trku: cilj iz tabele + koliko VMG gubiš na svom uglu (brzina na uglu iz polara)
  function theory(c, tws, upAng) {
    if (!c || !c.guide || !tws) return null;
    var G = guideAt(c.guide, tws), r = { tws: tws, up: G.up, dn: G.dn, loss: null };
    if (upAng && c.polar) { var v = speed(c.polar, tws, upAng), vmg = v * Math.cos(upAng * Math.PI / 180); r.loss = Math.max(-0.2, 1 - vmg / G.up.vmg); r.myVmg = vmg; r.myBs = v; }
    return r;
  }
  function drawPolar(cv, P) {
    var g = cv.getContext('2d'), W = cv.width = cv.clientWidth * 2, H = cv.height = cv.clientHeight * 2, cx = W * 0.1, cy = H / 2, R = Math.min(W * 0.86, H * 0.47);
    g.clearRect(0, 0, W, H);
    var vmax = Math.max.apply(null, P.v.map(function (r) { return Math.max.apply(null, r); })) || 1;
    g.strokeStyle = 'rgba(160,170,180,.25)'; g.lineWidth = 1;
    for (var k = 1; k <= 4; k++) { g.beginPath(); g.arc(cx, cy, R * k / 4, -Math.PI / 2, Math.PI / 2); g.stroke(); }
    [0, 45, 90, 135, 180].forEach(function (a) { var r = a * Math.PI / 180; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(r) * R, cy - Math.cos(r) * R); g.stroke(); });
    var cols = ['#3b4cc0', '#2fa3d6', '#35b779', '#f2c12e', '#e8572f', '#ff2e93', '#9b3bff'];
    P.tws.forEach(function (t, si) {
      g.strokeStyle = cols[si % cols.length]; g.lineWidth = 3; g.beginPath();
      for (var a = P.twa[0]; a <= P.twa[P.twa.length - 1]; a += 2) { var v = speed(P, t, a), r = a * Math.PI / 180, x = cx + Math.sin(r) * R * v / vmax, y = cy - Math.cos(r) * R * v / vmax; if (a === P.twa[0]) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke(); g.fillStyle = cols[si % cols.length]; g.font = (W * 0.04) + 'px sans-serif'; g.fillText(t + ' kn', W * 0.02, H * 0.06 + si * W * 0.05);
    });
  }

  /* ---- UI u Settings ---- */
  function pro() { return true; } // PRO je za sada otključan za testiranje
  function render() {
    var box = $('profBody'); if (!box) return;
    var cid = sget('boatClass', ''), c = get(cid), cs = customs();
    var opts = '<option value="">— choose —</option>' + CLASSES.map(function (x) { return '<option value="' + x.id + '"' + (x.id === cid ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
      (cs.length ? '<optgroup label="My classes">' + cs.map(function (x) { return '<option value="' + x.id + '"' + (x.id === cid ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</optgroup>' : '') +
      '<option value="__new">+ Custom class / my own boat… (PRO)</option>';
    var h = '<label class="prof-row">Sail number<input id="profSail" type="text" maxlength="12" value="' + esc(sget('mySail', '')) + '" placeholder="e.g. SRB 344"></label>' +
      '<label class="prof-row">Boat class<select id="profClass">' + opts + '</select></label>';
    if (c) {
      var GT = c.guide ? '<h4>Speed guide</h4><div class="prof-tw"><table class="co-tbl"><tr><th>TWS</th><th>Up BS</th><th>TWA</th><th>Tack</th><th>Heel</th><th>Dn BS</th><th>TWA</th><th>Gybe</th></tr>' +
        c.guide.up.tws.map(function (w, i) { var u = c.guide.up, d = c.guide.dn; return '<tr><td>' + w + '</td><td>' + u.bs[i] + '</td><td>' + u.twa[i] + '°</td><td>' + u.turn[i] + '°</td><td>' + u.heel[i] + '°</td><td>' + d.bs[i] + '</td><td>' + d.twa[i] + '°</td><td>' + d.turn[i] + '°</td></tr>'; }).join('') + '</table></div>' : '';
      var P = c.polar || null, T = P ? targets(P, 10) : null;
      var D0 = h.length;
      h += '<p class="small">' + esc(c.name) + (c.custom ? ' <span class="pro">PRO</span> custom' : '') + ' · ' + { keel: 'keelboat', dinghy: 'dinghy', multi: 'multihull' }[c.kind || 'keel'] + ' · ' + { sym: 'spinnaker', asym: 'gennaker', none: 'no spinnaker' }[c.spi || 'none'] + '.</p>';
      h += P ? '<canvas class="prof-polar" id="profPolar"></canvas><p class="small">Polar: ' + P.tws.length + ' wind speeds × ' + P.twa.length + ' angles. At 10 kn: upwind ' + T.upTwa + '° TWA, ' + T.upBs.toFixed(1) + ' kn · downwind ' + T.dnTwa + '° TWA, ' + T.dnBs.toFixed(1) + ' kn.</p>'
        : '<p class="small">No polar for this class yet. ' + (c.custom ? 'Paste one below.' : 'We add class polars as we get reliable data; until then the app learns your speeds from your tracks.') + '</p>';
      if (c.custom) h += '<div class="prof-custom"><label class="prof-row">Class name<input id="pcName" type="text" maxlength="40" value="' + esc(c.name) + '"></label>' +
        '<label class="prof-row">Type<select id="pcKind"><option value="keel"' + (c.kind === 'keel' ? ' selected' : '') + '>Keelboat</option><option value="dinghy"' + (c.kind === 'dinghy' ? ' selected' : '') + '>Dinghy</option><option value="multi"' + (c.kind === 'multi' ? ' selected' : '') + '>Multihull</option></select></label>' +
        '<label class="prof-row">Downwind sail<select id="pcSpi"><option value="asym"' + (c.spi === 'asym' ? ' selected' : '') + '>Gennaker</option><option value="sym"' + (c.spi === 'sym' ? ' selected' : '') + '>Spinnaker</option><option value="none"' + (c.spi === 'none' ? ' selected' : '') + '>None</option></select></label>' +
        '<label class="prof-col">Class rules: key points (crew, sails, weight limits, what you may adjust while racing)<textarea id="pcRules" rows="4" maxlength="3000">' + esc(c.rules || '') + '</textarea></label>' +
        '<label class="prof-col">Polar: paste the table (first row wind speeds in kn, first column wind angles, cells boat speed in kn)<textarea id="pcPolar" rows="6" placeholder="TWA/TWS 6 8 10 12 16 20&#10;45 4.1 4.8 5.3 5.6 5.8 5.9&#10;60 4.6 5.4 5.9 6.2 6.5 6.6&#10;...">' + esc(c.polarTxt || '') + '</textarea></label>' +
        '<p class="small" id="pcMsg"></p><div class="row"><button class="btn primary" id="pcSave">Save class</button><button class="btn danger" id="pcDel">Delete</button></div>' +
        '<p class="small">Coming: read the class rules and the polar from a PDF with AI (PRO), and learn the polar from your own tracks with the Calypso wind sensor.</p></div>';
    }
    if (c) {
      // detalji klase (polar, tabela brzina, sopstvena klasa) u jednom meniju koji se otvara
      var det = h.slice(D0) + (GT || '');
      h = h.slice(0, D0) + '<details class="prof-det"' + (c.custom ? ' open' : '') + '><summary>' + (c.polar || c.guide ? 'Polar & speed guide' : 'Class details') + '</summary>' + det + '</details>';
    }
    box.innerHTML = h;
    // Settings je skriven pri učitavanju (širina 0): crtaj kad canvas dobije veličinu
    if (c && c.polar) { var cv = $('profPolar'), draw = function () { if (cv.clientWidth > 0) drawPolar(cv, c.polar); }; draw(); if (window.ResizeObserver) new ResizeObserver(draw).observe(cv); }
  }
  function bind() {
    var box = $('profBody'); if (!box) return;
    box.addEventListener('change', function (e) {
      var id = e.target.id;
      if (id === 'profName') sset('myName', e.target.value.trim());
      if (id === 'profSail') sset('mySail', e.target.value.trim());
      if (id === 'profClass') {
        var v = e.target.value;
        if (v === '__new') {
          if (!pro()) { render(); return; }
          var nc = { id: 'c' + Date.now(), name: 'My boat', kind: 'keel', spi: 'asym', rules: '', polarTxt: '', polar: null };
          sset('customClasses', customs().concat([nc])); v = nc.id;
        }
        sset('boatClass', v); render();
      }
    });
    box.addEventListener('click', function (e) {
      var cid = sget('boatClass', '');
      if (e.target.id === 'pcSave') {
        var txt = $('pcPolar').value, P = txt.trim() ? parsePolar(txt) : null;
        if (txt.trim() && !P) { $('pcMsg').textContent = 'Could not read the polar. First row: wind speeds; first column: angles; numbers separated by spaces, tabs, ; or ,'; return; }
        sset('customClasses', customs().map(function (c) { return c.id === cid ? Object.assign(c, { name: $('pcName').value.trim() || 'My boat', kind: $('pcKind').value, spi: $('pcSpi').value, rules: $('pcRules').value, polarTxt: txt, polar: P }) : c; }));
        render(); if (window.RA && window.RA.toast) window.RA.toast('Class saved');
      }
      if (e.target.id === 'pcDel') { sset('customClasses', customs().filter(function (c) { return c.id !== cid; })); sset('boatClass', ''); render(); }
    });
  }
  window.Profile = { classes: all, get: get, current: current, parsePolar: parsePolar, speed: speed, targets: targets, guideAt: guideAt, estTws: estTws,
    // norme klase za dato stanje mora; ako za to stanje nema podataka, ravna voda + tolerancija (u talasu su gubici veći)
    norms: function (c, sea) { var L = c && c.learned; if (!L) return null; if (sea && L[sea]) return Object.assign({ sea: sea, exact: true }, L[sea]); return L.flat ? Object.assign({ sea: 'flat', exact: sea === 'flat' || !sea, tol: sea && sea !== 'flat' ? 1.6 : 1 }, L.flat) : null; }, theory: theory, render: render };
  if (document.readyState !== 'loading') { bind(); render(); } else document.addEventListener('DOMContentLoaded', function () { bind(); render(); });
})();
