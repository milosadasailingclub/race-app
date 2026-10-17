/* The Race App — BRIEF (pre jedrenja): šta ti ide, na šta da paziš danas, podsetnici iz prognoze
   i mapa polja (gde je bio jači vetar) iz ranijih trka na istom mestu sa sličnim smerom vetra.
   Regata: podaci sa prethodnih dana eventa; prvi dan / trening: poslednjih 12 meseci. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function avg(a) { a = a.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); }); return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function rad(d) { return d * Math.PI / 180; }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function cmean(a) { var s = 0, c = 0; a.forEach(function (h) { s += Math.sin(rad(h)); c += Math.cos(rad(h)); }); return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360; }
  function d3(d) { return ('00' + Math.round(((d % 360) + 360) % 360)).slice(-3); }
  function compass(d) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8]; }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function km(a, b) { return Math.hypot((a.lon - b.lon) * 111.32 * Math.cos(rad(a.lat)), (a.lat - b.lat) * 110.54); }
  var DAY = 864e5, FC = {}, state = { map: null };

  /* ---- 1) kontekst: regata danas ili trening ---- */
  function context() {
    var today = ymd(new Date()), ev = (sget('norEvents', []) || []).filter(function (e) { return e.loc && e.dateFrom && e.dateFrom <= today && (e.dateTo || e.dateFrom) >= today; })[0];
    if (ev) return Promise.resolve({ mode: 'event', ev: ev, loc: ev.loc, day: Math.round((new Date(today) - new Date(ev.dateFrom)) / DAY) + 1 });
    return locate().then(function (loc) { return { mode: 'training', loc: loc }; });
  }
  function locate() {
    var spots = sget('wxSpots', [{ id: 'ada', name: 'Ada Ciganlija', lat: 44.7872, lon: 20.3985 }]), sp = sget('wxSpot', 'gps');
    var fixed = spots.filter(function (s) { return s.id === sp; })[0];
    if (fixed) return Promise.resolve({ name: fixed.name, lat: fixed.lat, lon: fixed.lon });
    return new Promise(function (res) {
      var fb = function () { res(spots[0] ? { name: spots[0].name, lat: spots[0].lat, lon: spots[0].lon } : null); };
      if (!('geolocation' in navigator)) return fb();
      navigator.geolocation.getCurrentPosition(function (p) { res({ name: 'My location', lat: p.coords.latitude, lon: p.coords.longitude }); }, fb, { timeout: 8000, maximumAge: 600000 });
    });
  }

  /* ---- 2) performanse iz baze ---- */
  var MET = {
    vmgUp: { name: 'Upwind VMG', desc: true }, up: { name: 'Upwind boat speed', desc: true }, vmgDown: { name: 'Downwind VMG', desc: true },
    ta: { name: 'Pointing (tacking angle)', desc: false }, tackLoss: { name: 'Tacks', desc: false }, start: { name: 'Starts', desc: false }
  };
  function racesFor(ctx) {
    var now = Date.now(), all = [];
    (sget('regattas', []) || []).forEach(function (rg) {
      if (!rg.me) return;
      var cls = sget('boatClass', ''); if (cls && rg.cls && rg.cls !== cls) return; // samo moja klasa (stare regate bez oznake ulaze)
      rg.races.forEach(function (r) { if (r.rows.some(function (x) { return x.id === rg.me; })) all.push({ rg: rg, r: r }); });
    });
    if (ctx.mode === 'event' && ctx.day > 1) {
      var from = new Date(ctx.ev.dateFrom).getTime() - 12 * 3600e3, to = new Date(ymd(new Date())).getTime();
      var ev = all.filter(function (x) { return x.r.gun >= from && x.r.gun < to; });
      if (ev.length) return { list: ev, src: 'previous days of ' + (ctx.ev.name || 'this event') };
    }
    return { list: all.filter(function (x) { return now - x.r.gun < 365 * DAY; }), src: 'last 12 months', year: true };
  }
  function median(a) { a = a.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); }).sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : null; }
  function perf(ctx) {
    var R = racesFor(ctx), acc = {}, byRg = {};
    Object.keys(MET).forEach(function (k) { acc[k] = { rk: [], n: [], mine: [], best: [], firsts: 0, races: 0 }; });
    R.list.forEach(function (x) { (byRg[x.rg.id] = byRg[x.rg.id] || { rg: x.rg, races: [] }).races.push(x.r); });
    Object.keys(byRg).forEach(function (id) {
      var G = byRg[id], me = G.rg.me, per = {};
      // vrednosti po brodu kroz trke ove regate (proseci za brzine/ugao, medijana za letanja i start — manje šuma)
      G.races.forEach(function (r) {
        r.rows.forEach(function (y) { var p = per[y.id] || (per[y.id] = { id: y.id }); Object.keys(MET).forEach(function (k) { if (y[k] !== null && y[k] !== undefined && !isNaN(y[k])) (p[k] = p[k] || []).push(y[k]); }); });
        ['up', 'vmgUp', 'vmgDown'].forEach(function (k) { // "najbolji u X od Y trka"
          var v = r.rows.filter(function (y) { return y[k] !== null && y[k] !== undefined; }); if (v.length < 3 || !v.some(function (y) { return y.id === me; })) return;
          v.sort(function (a, b) { return b[k] - a[k]; }); acc[k].races++; if (v[0].id === me) acc[k].firsts++;
        });
      });
      var boats = Object.keys(per).map(function (i) { return per[i]; });
      Object.keys(MET).forEach(function (k) {
        var agg = (k === 'tackLoss' || k === 'start') ? median : avg;
        var v = boats.map(function (p) { return { id: p.id, v: p[k] ? agg(p[k]) : null }; }).filter(function (o) { return o.v !== null; });
        if (v.length < 3) return;
        v.sort(function (a, b) { return MET[k].desc ? b.v - a.v : a.v - b.v; });
        var i = v.map(function (o) { return o.id; }).indexOf(me); if (i < 0) return;
        var A = acc[k]; A.rk.push(i + 1); A.n.push(v.length); A.mine.push(v[i].v);
        if (k === 'ta') { var top = boats.filter(function (p) { return p.vmgUp && p.ta; }).sort(function (a, b) { return avg(b.vmgUp) - avg(a.vmgUp); }).slice(0, 2); A.best.push(avg(top.map(function (p) { return avg(p.ta); }))); }
        else A.best.push(v[0].v);
      });
    });
    var out = [];
    Object.keys(MET).forEach(function (k) {
      var A = acc[k]; if (!A.rk.length) return;
      var r = avg(A.rk), N = Math.round(avg(A.n));
      out.push({ k: k, rank: r, N: N, races: A.races, first: A.firsts, score: N > 1 ? (r - 1) / (N - 1) : 0.5, mine: avg(A.mine), best: avg(A.best) });
    });
    // trening (bez flote): sopstveni brojevi
    var myCls = sget('boatClass', ''), tr = (sget('raceLog', []) || []).filter(function (e) { return !e.regatta && e.m && Date.now() - (e.m.start || 0) < 365 * DAY && (!myCls || !e.cls || e.cls === myCls); });
    var own = { n: tr.length, heel: avg(tr.map(function (e) { return e.m.heelUp; })), ta: avg(tr.map(function (e) { return e.m.ta; })), tackLoss: avg(tr.map(function (e) { return e.m.tackLoss; })), up: avg(tr.map(function (e) { return e.m.up; })), down: avg(tr.map(function (e) { return e.m.down; })) };
    return { src: R.src, races: R.list.length, regattas: R.list.reduce(function (s, x) { if (s.indexOf(x.rg.id) < 0) s.push(x.rg.id); return s; }, []).length, m: out, own: own };
  }
  function place(o) { return (o.rank % 1 ? 'average place ' + o.rank.toFixed(1) : 'place ' + o.rank) + ' of ' + o.N + (o.first ? ', best in ' + o.first + ' of ' + o.races + ' races' : ''); }
  function perfItems(P) {
    var S = [], F = [], by = {}; P.m.forEach(function (o) { by[o.k] = o; });
    var ta = by.ta, taGap = ta && ta.best ? ta.mine - ta.best : 0;
    P.m.slice().sort(function (a, b) { return a.score - b.score; }).forEach(function (o) {
      if (o.score <= 0.25) {
        var t = { up: 'Fast boat upwind', vmgUp: 'You get to the windward mark fast', vmgDown: 'Strong downwind', ta: 'You point well', tackLoss: 'Clean tacks', start: 'Quick off the line' }[o.k];
        S.push({ h: MET[o.k].name, t: t + ' (' + place(o) + ').' + (o.k === 'tackLoss' ? ' ' + o.mine.toFixed(1) + ' m lost per tack.' : o.k === 'start' ? ' Over the line ' + Math.round(o.mine) + ' s after the gun.' : '') });
      }
    });
    P.m.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (o) {
      if (o.score < 0.33) return;
      var t = null;
      if (o.k === 'ta' && taGap >= 3) { var MCg = window.Profile && window.Profile.current(), gu = MCg && MCg.guide ? MCg.guide.up.turn : null; t = 'Tacking angle ' + Math.round(o.mine) + '° against ' + Math.round(o.best) + '° for the best VMG boats' + (gu ? ' (' + (MCg.guideSrc || 'class guide') + ': ' + Math.min.apply(null, gu) + '–' + Math.max.apply(null, gu) + '° depending on the wind)' : '') + '. Point higher: aim for about ' + Math.round(o.best + 3) + '° and judge it by VMG, not speed.'; }
      else if (o.k === 'vmgUp') t = place(o) + '.' + (taGap >= 3 ? ' Mostly pointing (see tacking angle).' : ' Play the shifts: tack on headers, stay in the pressure, avoid the laylines early.');
      else if (o.k === 'up') t = place(o) + '. Check the trim: jib leads and sheet tension, main twist, keep the heel in the green.';
      else if (o.k === 'vmgDown') t = place(o) + (o.best ? ' (best ' + o.best.toFixed(2) + ' kn VMG, you ' + o.mine.toFixed(2) + ')' : '') + '. Sail lower in the puffs, heat up in the lulls, gybe on the shifts and stay in the pressure.';
      else if (o.k === 'tackLoss') t = o.mine.toFixed(1) + ' m lost per tack (best ' + o.best.toFixed(1) + ' m). Smooth turn, do not over-steer, build speed before pointing.';
      else if (o.k === 'start') t = 'Over the line ' + Math.round(o.mine) + ' s after the gun (best ' + Math.round(o.best) + ' s). Time-distance runs before the start, be on the line at full speed.';
      if (t) F.push({ h: MET[o.k].name, t: t });
    });
    var w = P.own;
    if (w.n && w.heel !== null && w.heel > 21) F.push({ h: 'Heel upwind', t: 'Average ' + Math.round(w.heel) + '° in your trainings. Depower earlier: traveller down, more backstay / outhaul, hike hard. Keep the LEDs green.' });
    var CL = window.Profile && window.Profile.current(), LN = CL && CL.learned;
    if (LN && !P.races && w.n && w.tackLoss !== null) {
      if (w.tackLoss > LN.tackLossM * 1.6) F.push({ h: 'Tacks', t: w.tackLoss.toFixed(1) + ' m lost per tack in your trainings; good crews in this class lose about ' + LN.tackLossM.toFixed(0) + ' m and are back to speed in ~' + LN.tackRecS + ' s. Smooth turn, flat boat, build speed before pointing.' });
      else if (w.tackLoss <= LN.tackLossM) S.push({ h: 'Tacks', t: 'Clean tacks: ' + w.tackLoss.toFixed(1) + ' m lost per tack, as good as the best crews in this class.' });
    }
    return { S: S.slice(0, 3), F: F.slice(0, 3) };
  }

  /* ---- 3) prognoza za danas i podsetnici ---- */
  function forecast(loc) {
    var key = loc.lat.toFixed(2) + ',' + loc.lon.toFixed(2) + ',' + ymd(new Date());
    if (FC[key] && Date.now() - FC[key].at < 30 * 60000) return Promise.resolve(FC[key]);
    var base = 'latitude=' + loc.lat.toFixed(4) + '&longitude=' + loc.lon.toFixed(4) + '&timezone=auto&forecast_days=2';
    var getJ = function (u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }); };
    return Promise.all([
      getJ('https://api.open-meteo.com/v1/forecast?' + base + '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation_probability&wind_speed_unit=kn'),
      getJ('https://marine-api.open-meteo.com/v1/marine?' + base + '&hourly=wave_height,wind_wave_height').catch(function () { return null; })
    ]).then(function (r) {
      var f = r[0], m = r[1]; if (!f || !f.hourly) throw new Error('no forecast');
      var H = f.hourly, now = new Date(), today = ymd(now), h0 = Math.max(9, now.getHours()), rows = [];
      if (h0 > 18) { h0 = 9; today = ymd(new Date(Date.now() + DAY)); }
      H.time.forEach(function (t, i) {
        var hh = +t.slice(11, 13); if (t.slice(0, 10) !== today || hh < h0 || hh > Math.max(h0 + 6, 18)) return;
        var mi = m && m.hourly ? m.hourly.time.indexOf(t) : -1;
        rows.push({ h: hh, w: H.wind_speed_10m[i], g: H.wind_gusts_10m[i], d: H.wind_direction_10m[i], t: H.temperature_2m[i], p: H.precipitation_probability[i], wave: mi >= 0 ? (m.hourly.wind_wave_height[mi] !== null ? m.hourly.wind_wave_height[mi] : m.hourly.wave_height[mi]) : null });
      });
      var o = { at: Date.now(), day: today, rows: rows }; FC[key] = o; return o;
    });
  }
  function fcStats(F) {
    var R = F.rows.filter(function (r) { return r.w !== null; }); if (!R.length) return null;
    var ws = R.map(function (r) { return r.w; }), gs = R.map(function (r) { return r.g; }), ds = R.map(function (r) { return r.d; }), mean = cmean(ds);
    var rel = ds.map(function (d) { return nrm(d - mean); }), n3 = Math.min(3, R.length);
    return { from: R[0].h, to: R[R.length - 1].h, wMin: Math.min.apply(null, ws), wMax: Math.max.apply(null, ws), w: avg(ws), g: Math.max.apply(null, gs), dir: mean, dMin: Math.min.apply(null, rel), dMax: Math.max.apply(null, rel),
      d0: avg(ds.slice(0, n3).map(function (d) { return nrm(d - mean); })), d1: avg(ds.slice(-n3).map(function (d) { return nrm(d - mean); })),
      trend: avg(ws.slice(-n3)) - avg(ws.slice(0, n3)), tMin: Math.min.apply(null, R.map(function (r) { return r.t; })), rain: Math.max.apply(null, R.map(function (r) { return r.p || 0; })),
      wave: avg(R.map(function (r) { return r.wave; })) };
  }
  function reminders(s) {
    var L = [];
    if (s.wMax < 6) L.push({ h: 'Light air', t: 'Crew weight forward and to leeward, ease outhaul and halyards, soft sheets. Sail for speed, do not pinch, fewer tacks, move the helm smoothly.' });
    else if (s.w < 12) L.push({ h: 'Medium wind', t: 'Full power: base rig tension, full sails, hike flat and steer for speed in the lulls, point in the puffs.' });
    else if (s.w < 16) L.push({ h: 'Fresh wind', t: 'Set up for the top of the range: more shroud / backstay tension, flatten the main (outhaul, cunningham), traveller down in the puffs, keep the heel under 20°.' });
    else L.push({ h: 'Strong wind', t: 'Depower before the start: max rig tension, flattest sails, consider the small jib. Gybe at full speed with a smooth bear-away, keep the crew together.' });
    if (s.g - s.w >= 8 || s.g / Math.max(1, s.w) >= 1.5) L.push({ h: 'Gusty (up to ' + Math.round(s.g) + ' kn)', t: 'Play the main and traveller all the time, call the puffs early, bear away in the big ones downwind to keep control.' });
    if (s.wave !== null && s.wave !== undefined ? s.wave >= 0.35 : s.w >= 12) L.push({ h: 'Chop', t: 'Foot a few degrees for speed, more twist and power (ease jib and main a little), steer through the waves, weight together in the middle.' });
    if (s.dMax - s.dMin >= 25) L.push({ h: 'Shifty / turning wind', t: 'Forecast turns from ' + d3(s.dir + s.d0) + '° to ' + d3(s.dir + s.d1) + '° (' + (nrm(s.d1 - s.d0) > 0 ? 'veering, right' : 'backing, left') + '). Take compass readings before the start, tack on the headers, do not hit a layline early.' });
    if (Math.abs(s.trend) >= 5) L.push({ h: s.trend > 0 ? 'Building wind' : 'Dropping wind', t: (s.trend > 0 ? 'About ' + Math.round(s.trend) + ' kn more later: set up one step harder than it feels at the start.' : 'About ' + Math.round(-s.trend) + ' kn less later: be ready to add power between races.') });
    if (s.tMin < 14) L.push({ h: 'Cold (' + Math.round(s.tMin) + ' °C)', t: 'Layers and spray top, eat and drink between races.' });
    if (s.rain >= 50) L.push({ h: 'Rain likely', t: 'Rain can bring sudden wind changes: watch the sky upwind.' });
    return L;
  }

  // ciljevi iz polara klase za prognoziranu jačinu vetra
  function polarCard(s) {
    var PR = window.Profile, c = PR && PR.current(); if (!c || !(c.polar || c.guide)) return '';
    var w = Math.round(s.w), G = c.guide ? PR.guideAt(c.guide, w) : null;
    if (G) return card('wx', 'Targets for ' + w + ' kn (' + (c.guideSrc || c.name) + ')', 'Upwind: ' + G.up.bs.toFixed(1) + ' kn, ' + Math.round(G.up.twa) + '° to the wind, tacking angle ' + Math.round(G.up.turn) + '°, heel ' + Math.round(G.up.heel) + '°. Downwind: ' + G.dn.bs.toFixed(1) + ' kn, ' + Math.round(G.dn.twa) + '° to the wind, gybing angle ' + Math.round(G.dn.turn) + '°.');
    var T = PR.targets(c.polar, w); if (!T) return '';
    return card('wx', 'Targets for ' + w + ' kn (' + c.name + ' polar)', 'Upwind: ' + T.upTwa + '° to the wind, ' + T.upBs.toFixed(1) + ' kn boat speed, VMG ' + T.upVmg.toFixed(1) + ' kn. Downwind: ' + T.dnTwa + '° to the wind, ' + T.dnBs.toFixed(1) + ' kn, VMG ' + T.dnVmg.toFixed(1) + ' kn.');
  }
  // profili lokacija (naučeno iz trekera; raste sa svakom regatom)
  var LOCS = [{ name: 'Palić', lat: 46.088, lon: 19.757, r: 6, src: '9 races, Oct 2026',
    t: 'Shifty lake: the wind oscillates about ±5–11° (up to 45° in a race) every 9–30 minutes, in two regimes (NW 330–340° and ENE 55–65°). Take compass readings before the start, tack on the headers, stay away from the laylines early and keep near the middle until the pattern is clear.' }];
  function locCard(loc) { if (!loc) return ''; var L = LOCS.filter(function (x) { return km(x, loc) <= x.r; })[0]; return L ? card('wx', L.name + ': what this place is like (' + L.src + ')', L.t) : ''; }
  /* ---- 4) mapa polja iz istorije ---- */
  function historyRaces(ctx, dir) {
    var out = [];
    (sget('regattas', []) || []).forEach(function (rg) {
      rg.races.forEach(function (r) {
        var m = (r.marks || [])[0]; if (!m || !r.legs || km(m, ctx.loc) > 6) return;
        if (dir !== null && Math.abs(nrm(r.wind - dir)) > 25) return;
        out.push({ rg: rg, r: r });
      });
    });
    return out.sort(function (a, b) { return b.r.gun - a.r.gun; }).slice(0, 6);
  }
  function fieldFrom(list, dir) {
    if (!window.Router || !window.Track) return Promise.resolve(null);
    var G = {}, fav = { left: 0, right: 0, middle: 0 }, marks = null, DS = 60, o = null;
    var p = Promise.resolve();
    list.forEach(function (x) {
      p = p.then(function () { return window.Track.get('f' + x.rg.id + '_' + x.r.n); }).then(function (f) {
        if (!f || !f.boats) return;
        var race = { gun: x.r.gun, wind: x.r.wind, legs: x.r.legs, marks: x.r.marks }, info = {};
        (x.r.rows || []).forEach(function (y) { info[y.id] = { ta: y.ta, tackLoss: y.tackLoss, up: y.up, down: y.down }; });
        var cells = window.Router.buildModel(race, f.boats, info).summaryCells();
        if (!o) { o = cells.length ? { lat: cells[0].lat, lon: cells[0].lon } : null; marks = x.r.marks; }
        if (!o) return;
        cells.forEach(function (c) {
          var gx = Math.round((c.lon - o.lon) * 111320 * Math.cos(rad(o.lat)) / DS), gy = Math.round((c.lat - o.lat) * 110540 / DS), k = gx + ',' + gy;
          var g = G[k] || (G[k] = { gx: gx, gy: gy, p: 0, w: 0, s: 0, c: 0, n: 0 });
          g.p += c.p * c.w; g.w += c.w; if (c.rel !== null) { var d = (dir !== null ? dir : x.r.wind) + c.rel; g.s += Math.sin(rad(d)) * c.w; g.c += Math.cos(rad(d)) * c.w; } g.n++;
        });
        x.r.legs.forEach(function (L) { if (L.up && L.fav) fav[L.fav] = (fav[L.fav] || 0) + 1; });
      });
    });
    return p.then(function () { var cells = Object.keys(G).map(function (k) { return G[k]; }); return cells.length ? { cells: cells, o: o, DS: DS, fav: fav, marks: marks } : null; });
  }
  function rampC(p) {
    var R = [[0.8, [59, 76, 192]], [0.9, [47, 163, 214]], [1.0, [53, 183, 121]], [1.1, [242, 193, 46]], [1.2, [232, 87, 47]]];
    if (p <= R[0][0]) return R[0][1];
    for (var i = 1; i < R.length; i++) if (p <= R[i][0]) { var f = (p - R[i - 1][0]) / (R[i][0] - R[i - 1][0]), a = R[i - 1][1], b = R[i][1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
    return R[R.length - 1][1];
  }
  function drawField(el, F) {
    if (state.map) { try { state.map.remove(); } catch (e) {} state.map = null; }
    var xs = F.cells.map(function (c) { return c.gx; }), ys = F.cells.map(function (c) { return c.gy; });
    var gx0 = Math.min.apply(null, xs) - 2, gx1 = Math.max.apply(null, xs) + 2, gy0 = Math.min.apply(null, ys) - 2, gy1 = Math.max.apply(null, ys) + 2, NX = gx1 - gx0 + 1, NY = gy1 - gy0 + 1;
    var wMax = Math.max.apply(null, F.cells.map(function (c) { return c.w; }));
    // razvuci boje na raspon ovog polja (prosek više trka je blizu 1.0, razlike su male ali stalne)
    var pv = F.cells.filter(function (c) { return c.w > wMax * 0.2; }).map(function (c) { return c.p / c.w; }).sort(function (a, b) { return a - b; });
    var lo = pv.length ? pv[Math.floor(pv.length * 0.1)] : 0.9, hi = pv.length ? pv[Math.floor(pv.length * 0.9)] : 1.1; if (hi - lo < 0.02) { lo -= 0.01; hi += 0.01; }
    var stretch = function (p) { return 0.8 + 0.4 * Math.max(0, Math.min(1, (p - lo) / (hi - lo))); };
    var cv = document.createElement('canvas'); cv.width = NX; cv.height = NY; var g = cv.getContext('2d'), id = g.createImageData(NX, NY), arrows = [];
    var kx = 111320 * Math.cos(rad(F.o.lat)), ky = 110540, ll = function (gx, gy) { return [F.o.lon + gx * F.DS / kx, F.o.lat + gy * F.DS / ky]; };
    F.cells.forEach(function (c) {
      var u = Math.min(1, c.w / (wMax * 0.25)), al = u * u * (3 - 2 * u), col = rampC(stretch(c.p / c.w)), o4 = ((gy1 - c.gy) * NX + (c.gx - gx0)) * 4;
      id.data[o4] = col[0]; id.data[o4 + 1] = col[1]; id.data[o4 + 2] = col[2]; id.data[o4 + 3] = Math.round(al * 255);
      if (al > 0.2 && (c.s || c.c)) arrows.push({ type: 'Feature', properties: { r: Math.round((Math.atan2(c.s, c.c) * 180 / Math.PI + 540) % 360), a: al }, geometry: { type: 'Point', coordinates: ll(c.gx, c.gy) } });
    });
    g.putImageData(id, 0, 0);
    var tl = ll(gx0 - 0.5, gy1 + 0.5), br = ll(gx1 + 0.5, gy0 - 0.5);
    window.Track.lib().then(function () {
      var map = window.Track.makeMap(el, [(tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2]); state.map = map;
      map.on('load', function () { map.fitBounds([[tl[0], br[1]], [br[0], tl[1]]], { padding: 10, duration: 0 }); });
      map.on('style.load', function () {
        if (map.getSource('bf')) return;
        map.addSource('bf', { type: 'image', url: cv.toDataURL('image/png'), coordinates: [tl, [br[0], tl[1]], br, [tl[0], br[1]]] });
        map.addLayer({ id: 'bf', type: 'raster', source: 'bf', paint: { 'raster-opacity': 0.6, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } });
        if (!map.hasImage('wArrow')) {
          var c2 = document.createElement('canvas'); c2.width = c2.height = 32; var q = c2.getContext('2d');
          q.strokeStyle = q.fillStyle = 'rgba(255,255,255,.85)'; q.lineWidth = 2.5; q.lineCap = 'round';
          q.beginPath(); q.moveTo(16, 27); q.lineTo(16, 8); q.stroke(); q.beginPath(); q.moveTo(16, 3); q.lineTo(10, 12); q.lineTo(22, 12); q.closePath(); q.fill();
          map.addImage('wArrow', { width: 32, height: 32, data: q.getImageData(0, 0, 32, 32).data });
        }
        map.addSource('ba', { type: 'geojson', data: { type: 'FeatureCollection', features: arrows } });
        map.addLayer({ id: 'ba', type: 'symbol', source: 'ba', layout: { 'icon-image': 'wArrow', 'icon-rotate': ['get', 'r'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.2, 15, 0.38, 18, 0.7] }, paint: { 'icon-opacity': ['*', 0.85, ['get', 'a']] } });
        map.addSource('bm', { type: 'geojson', data: { type: 'FeatureCollection', features: (F.marks || []).map(function (m) { return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [m.lon, m.lat] } }; }) } });
        map.addLayer({ id: 'bm', type: 'circle', source: 'bm', paint: { 'circle-radius': 4, 'circle-color': '#ff6b00', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#05070a' } });
      });
    }).catch(function () { el.innerHTML = '<p class="small" style="padding:12px">Map needs internet.</p>'; });
  }

  /* ---- render ---- */
  function card(cls, h, t) { return '<div class="br-item ' + cls + '"><b>' + esc(h) + '</b><span>' + esc(t) + '</span></div>'; }
  var busy = false;
  function render() {
    var box = $('brBody'); if (!box || busy) return; busy = true;
    context().then(function (ctx) {
      busy = false;
      var P = perf(ctx), I = perfItems(P), h = '<div class="nor-title"><b>BRIEF</b><span>' + (ctx.mode === 'event' ? esc(ctx.ev.name) + ' · day ' + ctx.day : 'Training' + (ctx.loc ? ' · ' + esc(ctx.loc.name) : '')) + '</span></div>';
      var MC = window.Profile && window.Profile.current();
      if (P.races) h += '<p class="small">' + (MC ? esc(MC.name) + ' · ' : '') + 'Based on ' + P.races + ' race' + (P.races > 1 ? 's' : '') + ' from ' + P.regattas + ' regatta' + (P.regattas > 1 ? 's' : '') + ' (' + P.src + ')' + (P.own.n ? ' and ' + P.own.n + ' training' + (P.own.n > 1 ? 's' : '') : '') + '.</p>';
      else if (P.own.n) h += '<p class="small">Based on ' + P.own.n + ' training' + (P.own.n > 1 ? 's' : '') + ' (last 12 months). Import regatta files in Debrief to compare with the fleet.</p>';
      else h += '<p class="small">No races or trainings yet. Record with Tracking or import files in Debrief, and the Brief fills in.</p>';
      if (I.F.length) h += '<div class="br-sec"><h3>WATCH TODAY</h3>' + I.F.map(function (x) { return card('focus', x.h, x.t); }).join('') + '</div>';
      if (I.S.length) h += '<div class="br-sec"><h3>YOUR STRENGTHS</h3>' + I.S.map(function (x) { return card('good', x.h, x.t); }).join('') + '</div>';
      if (P.own.n && !P.races) h += '<div class="br-sec"><h3>YOUR NUMBERS</h3><p class="small">' + [P.own.ta !== null ? 'tacking angle ' + Math.round(P.own.ta) + '°' : null, P.own.up !== null ? 'upwind ' + P.own.up.toFixed(1) + ' kn' : null, P.own.down !== null ? 'downwind ' + P.own.down.toFixed(1) + ' kn' : null, P.own.heel !== null ? 'heel ' + Math.round(P.own.heel) + '°' : null, P.own.tackLoss !== null ? P.own.tackLoss.toFixed(1) + ' m per tack' + (MC && MC.learned ? ' (good crews in this class ~' + MC.learned.tackLossM.toFixed(0) + ' m)' : '') : null].filter(Boolean).join(' · ') + '</p></div>';
      h += '<div class="br-sec"><h3>CONDITIONS</h3><div id="brWx"><p class="small">Loading the forecast…</p></div></div><div class="br-sec" id="brHist"></div>';
      box.innerHTML = h;
      if (!ctx.loc) { $('brWx').innerHTML = '<p class="small">No location: allow location or pick a spot in Weather.</p>'; return; }
      forecast(ctx.loc).then(function (F) {
        var s = fcStats(F), W = $('brWx'); if (!W) return null;
        if (!s) { W.innerHTML = '<p class="small">No forecast for today.</p>'; return null; }
        W.innerHTML = '<p class="br-fc"><b>' + Math.round(s.wMin) + '–' + Math.round(s.wMax) + ' kn</b>, gusts ' + Math.round(s.g) + ' · ' + compass(s.dir) + ' ' + d3(s.dir + s.d0) + '° → ' + d3(s.dir + s.d1) + '° · ' + s.from + '–' + s.to + ' h' + (s.wave !== null && s.wave !== undefined ? ' · waves ' + s.wave.toFixed(1) + ' m' : '') + '</p>' +
          reminders(s).map(function (x) { return card('wx', x.h, x.t); }).join('') + polarCard(s) + locCard(ctx.loc);
        return s.dir;
      }).catch(function () { var W = $('brWx'); if (W) W.innerHTML = '<p class="small">Forecast not available (offline?).</p>'; return null; }).then(function (dir) {
        var list = historyRaces(ctx, dir === undefined ? null : dir), Hh = $('brHist'); if (!Hh) return;
        if (!list.length) { Hh.innerHTML = '<h3>THE FIELD HERE</h3><p class="small">No races in the database at this place' + (dir !== null && dir !== undefined ? ' with a similar wind (' + d3(dir) + '° ±25°)' : '') + '. Import regatta files in Debrief and this map shows where the wind was stronger.</p>'; return; }
        Hh.innerHTML = '<h3>THE FIELD HERE</h3><p class="small">Building the map from ' + list.length + ' race' + (list.length > 1 ? 's' : '') + '…</p>';
        setTimeout(function () {
          fieldFrom(list, dir === undefined ? null : dir).then(function (F) {
            var H2 = $('brHist'); if (!H2) return;
            if (!F) { H2.innerHTML = '<h3>THE FIELD HERE</h3><p class="small">Fleet tracks not found. Import the regatta files again in Debrief.</p>'; return; }
            var n = F.fav.left + F.fav.right + F.fav.middle, favT = n ? 'Upwind legs: left paid in ' + F.fav.left + ', right in ' + F.fav.right + ', no clear side in ' + F.fav.middle + ' (of ' + n + ').' : '';
            H2.innerHTML = '<h3>THE FIELD HERE</h3><p class="small">' + list.length + ' race' + (list.length > 1 ? 's' : '') + ' at this place' + (dir !== null && dir !== undefined ? ' with wind ' + d3(dir - 25) + '–' + d3(dir + 25) + '°' : '') + '. ' + esc(favT) + '</p><div class="br-map" id="brMap"></div>' +
              '<div class="rr-wkey"><span>less wind</span><i></i><span>more wind</span><small>colour = where there was more (orange) or less (blue) wind than on the rest of the course at the same moment, averaged over these races · arrows = wind direction (turned to today\'s forecast)</small></div>';
            drawField($('brMap'), F);
          });
        }, 50);
      });
    }).catch(function () { busy = false; });
  }
  window.Brief = { render: render, _perf: perf, _reminders: reminders, _fcStats: fcStats };
})();
