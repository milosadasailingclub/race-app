/* The Race App — v0.3.0 */
(function () {
  'use strict';
  var APP_VERSION = '0.3.0';
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function $(id) { return document.getElementById(id); }
  function now() { return Date.now(); }

  /* ---------- storage ---------- */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var cfg = {
    damp: store.get('damp', 2),
    heelInvert: store.get('heelInvert', false),
    heelStep: store.get('heelStep', 3),
    calOffset: store.get('calOffset', null),
    calTime: store.get('calTime', null),
    theme: store.get('theme', 'day'),
    preset: store.get('preset', 5),
    liftMode: store.get('liftMode', 'manual'),
    startLeg: store.get('startLeg', 'up')
  };
  var TAU = [0, 0.3, 0.7, 1.5, 3, 5]; // sekunde, po nivou dampeninga

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg, actionLabel, action, ms) {
    var t = $('toast');
    t.innerHTML = '';
    var s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
    if (actionLabel) {
      var b = document.createElement('button'); b.textContent = actionLabel;
      b.onclick = function () { t.classList.add('hidden'); action(); };
      t.appendChild(b);
    }
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3000);
  }

  /* ---------- views ---------- */
  var currentView = 'menu', prevView = 'menu';
  function show(v) {
    if (v === 'back') v = prevView || 'menu';
    if (v !== currentView) prevView = currentView;
    document.querySelectorAll('.view').forEach(function (el) { el.classList.toggle('active', el.id === v); });
    currentView = v;
    if (v === 'race' || v === 'settings') { startSensors(); }
    if (v === 'race') { requestWakeLock(); }
    if (v === 'settings') { renderSettings(); }
  }
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { unlockAudio(); show(b.getAttribute('data-go')); });
  });
  document.querySelectorAll('.menu-item.soon').forEach(function (b) {
    b.addEventListener('click', function () { toast('Ova celina stiže u sledećim verzijama.'); });
  });
  $('dndBtn').addEventListener('click', function () {
    toast('Automatski DND stiže sa nativnom verzijom. Za sada uključi „Ne uznemiravaj“ ručno.', null, null, 4000);
  });

  /* ---------- theme ---------- */
  function applyTheme() {
    document.body.classList.toggle('theme-night', cfg.theme === 'night');
    document.body.classList.toggle('theme-day', cfg.theme !== 'night');
  }
  document.querySelectorAll('[data-theme]').forEach(function (b) {
    b.addEventListener('click', function () { cfg.theme = b.getAttribute('data-theme'); store.set('theme', cfg.theme); applyTheme(); });
  });
  applyTheme();

  /* ---------- pager ---------- */
  var pager = $('pager'), pageIdx = 0;
  function goPage(i, smooth) {
    pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth === false ? 'auto' : 'smooth' });
  }
  pager.addEventListener('scroll', function () {
    var i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
    if (i !== pageIdx) {
      pageIdx = i;
      document.querySelectorAll('#dots i').forEach(function (d, k) { d.classList.toggle('on', k === i); });
    }
  }, { passive: true });
  window.addEventListener('resize', function () { goPage(pageIdx, false); });

  /* ---------- audio / vibration ---------- */
  var actx = null;
  function unlockAudio() {
    try {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  function beep(ms, freq) {
    try {
      if (!actx) return;
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = freq || 1500; o.type = 'square';
      g.gain.value = 0.25;
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + ms / 1000);
    } catch (e) {}
  }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function signal(kind) {
    if (kind === 'gun') { beep(900, 1200); buzz(900); }
    else if (kind === 'minute') { beep(400); buzz([200, 100, 200]); }
    else { beep(120); buzz(120); }
  }

  /* ---------- TIMER ---------- */
  var T = { state: 'idle', end: 0, lastSec: null, autoSwitched: false };
  var resetArmed = 0;

  function fmt(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60); s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtUp(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function setPreset(m) {
    cfg.preset = Math.min(10, Math.max(1, m)); store.set('preset', cfg.preset);
    document.querySelectorAll('.preset[data-min]').forEach(function (b) {
      b.classList.toggle('on', +b.getAttribute('data-min') === cfg.preset);
    });
  }
  function renderTimer() {
    var el = $('timer'), sub = $('timerSub'), btn = $('sync');
    $('presets').classList.toggle('locked', T.state !== 'idle');
    if (T.state === 'idle') {
      el.textContent = cfg.preset + ':00'; el.classList.remove('last', 'up');
      sub.textContent = 'spreman'; btn.textContent = 'START';
    } else if (T.state === 'count') {
      var rem = T.end - now();
      el.textContent = fmt(rem); el.classList.toggle('last', rem <= 60000); el.classList.remove('up');
      sub.textContent = 'do starta'; btn.textContent = 'SYNC';
    } else {
      el.textContent = '+' + fmtUp(now() - T.end); el.classList.remove('last'); el.classList.add('up');
      sub.textContent = 'od starta'; btn.textContent = 'TRKA';
    }
  }
  function tick() {
    if (T.state === 'count') {
      var rem = T.end - now();
      var sec = Math.ceil(rem / 1000);
      if (rem <= 0) {
        T.state = 'race'; signal('gun');
        if (!T.autoSwitched) { T.autoSwitched = true; goPage(1); }
      } else if (sec !== T.lastSec) {
        if (T.lastSec !== null) {
          if (sec % 60 === 0) signal('minute');
          else if (sec === 30 || sec === 20 || sec <= 10) signal('sec');
        }
        T.lastSec = sec;
      }
    }
    renderTimer();
    renderElapsed();
    renderLine();
  }
  setInterval(tick, 100);

  $('sync').addEventListener('click', function () {
    unlockAudio();
    if (T.state === 'idle') {
      T.state = 'count'; T.end = now() + cfg.preset * 60000; T.lastSec = null; T.autoSwitched = false;
      signal('minute');
    } else if (T.state === 'count') {
      var rem = T.end - now();
      // sync nadole na pun minut prema prikazanoj vrednosti: 4:46 -> 4:00, 4:00 -> 4:00, 3:59 -> 3:00
      var shownSec = Math.ceil(rem / 1000);
      var m = Math.floor(shownSec / 60);
      T.end = now() + m * 60000; T.lastSec = null;
      signal('sec');
    }
    tick();
  });
  function adjust(d) {
    unlockAudio();
    if (T.state === 'idle') setPreset(cfg.preset + d);
    else if (T.state === 'count') {
      T.end += d * 60000;
      if (T.end <= now()) T.end = now() + 1000;
      T.lastSec = null;
    }
    tick();
  }
  $('minus').addEventListener('click', function () { adjust(-1); });
  $('plus').addEventListener('click', function () { adjust(1); });
  document.querySelectorAll('.preset[data-min]').forEach(function (b) {
    b.addEventListener('click', function () { if (T.state === 'idle') { setPreset(+b.getAttribute('data-min')); tick(); } });
  });
  $('reset').addEventListener('click', function () {
    if (T.state === 'idle') return;
    if (now() - resetArmed < 3000) {
      T.state = 'idle'; T.lastSec = null; resetArmed = 0; tick(); toast('Tajmer resetovan');
    } else {
      resetArmed = now(); toast('Dodirni Reset još jednom za potvrdu');
    }
  });
  setPreset(cfg.preset);

  function renderElapsed() {
    var e = $('elapsed');
    if (T.state === 'race') e.textContent = '+' + fmtUp(now() - T.end);
    else if (T.state === 'count') e.textContent = 'start za ' + fmt(T.end - now());
    else e.textContent = '—';
  }

  /* ---------- SENSORI: nagib ---------- */
  var S = {
    started: false, motionPerm: 'nepoznato', motionEvents: 0, lastMotion: 0,
    rawHeel: null, heel: null, lastT: 0, recent: [],
    geoPerm: 'nepoznato', geoError: '', fixes: 0, lastFix: null, acc: null,
    sog: null, hdg: null, prevFix: null, wake: 'nije traženo', fixBuf: []
  };

  function heelFromGravity(gx, gy, gz) {
    // bočni nagib = ugao gravitacije prema x osi telefona; radi i uspravno i položeno
    var r = Math.atan2(gx, Math.sqrt(gy * gy + gz * gz)) * 180 / Math.PI;
    return IS_IOS ? r : -r; // iOS ima obrnut znak
  }
  function onMotion(ev) {
    if (S.sim) return;
    var g = ev.accelerationIncludingGravity;
    if (!g || g.x === null || g.x === undefined) return;
    S.motionEvents++; S.lastMotion = now();
    var raw = heelFromGravity(g.x, g.y, g.z);
    S.rawHeel = raw;
    S.recent.push(raw); if (S.recent.length > 30) S.recent.shift();
    var val = raw - (cfg.calOffset || 0);
    if (cfg.heelInvert) val = -val;
    var t = now(), dt = S.lastT ? (t - S.lastT) / 1000 : 0; S.lastT = t;
    var tau = TAU[cfg.damp] || 0;
    if (S.heel === null || tau === 0 || dt <= 0) S.heel = val;
    else S.heel += (val - S.heel) * (1 - Math.exp(-dt / tau));
  }

  function buildHeel(el) {
    el.innerHTML = '';
    for (var i = -6; i <= 6; i++) {
      var d = document.createElement('i'); if (i === 0) d.className = 'c';
      d.setAttribute('data-k', i); el.appendChild(d);
    }
  }
  buildHeel($('heel')); buildHeel($('heelSet'));
  function renderHeel(el) {
    var h = S.heel, step = cfg.heelStep;
    var n = h === null ? null : Math.min(6, Math.round(Math.abs(h) / step));
    var side = h === null ? 0 : (h > 0 ? 1 : -1);
    el.querySelectorAll('i').forEach(function (d) {
      var k = +d.getAttribute('data-k'), cls = k === 0 ? 'c' : '';
      if (n !== null) {
        if (k === 0 && n === 0) cls += ' g';
        else if (k !== 0 && Math.sign(k) === side && Math.abs(k) <= n) {
          var a = Math.abs(k); cls += a <= 2 ? ' g' : (a <= 4 ? ' w' : ' b');
        }
      }
      d.className = cls.trim();
    });
  }
  setInterval(function () {
    if (currentView === 'race') renderHeel($('heel'));
    if (currentView === 'settings') { renderHeel($('heelSet')); renderDiag(); }
  }, 100);

  /* ---------- kalibracija ---------- */
  function calibrate() {
    if (!S.recent.length) { toast('Senzor još ne šalje podatke. Dodirni ekran pa pokušaj ponovo.'); return; }
    var prev = { off: cfg.calOffset, t: cfg.calTime };
    var sum = 0; S.recent.forEach(function (v) { sum += v; });
    cfg.calOffset = sum / S.recent.length; cfg.calTime = new Date().toISOString();
    store.set('calOffset', cfg.calOffset); store.set('calTime', cfg.calTime);
    S.heel = null; buzz(150);
    toast('Nula postavljena', 'Poništi', function () {
      cfg.calOffset = prev.off; cfg.calTime = prev.t;
      store.set('calOffset', cfg.calOffset); store.set('calTime', cfg.calTime); S.heel = null;
      toast('Vraćena prethodna nula');
    }, 5000);
    renderSettings();
  }
  (function longPress(el) {
    var tmr = null;
    function start(e) {
      e.preventDefault(); el.classList.add('pressing');
      tmr = setTimeout(function () { tmr = null; el.classList.remove('pressing'); calibrate(); }, 1000);
    }
    function cancel() { if (tmr) { clearTimeout(tmr); tmr = null; } el.classList.remove('pressing'); }
    el.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { el.addEventListener(n, cancel); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })($('heel'));
  $('calBtn').addEventListener('click', calibrate);
  $('calClear').addEventListener('click', function () {
    cfg.calOffset = null; cfg.calTime = null; store.set('calOffset', null); store.set('calTime', null);
    S.heel = null; renderSettings(); toast('Kalibracija obrisana');
  });

  /* ---------- GPS ---------- */
  function toRad(d) { return d * Math.PI / 180; }
  function dist(a, b) {
    var R = 6371000, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function bearing(a, b) {
    var y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
    var x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  var hs = null, hc = null, lastGeoT = 0;
  function onFix(p) {
    if (S.sim && !p.__sim) return;
    S.fixes++; S.geoPerm = 'granted'; S.geoError = '';
    var c = p.coords, fix = { lat: c.latitude, lon: c.longitude, t: p.timestamp || now() };
    S.acc = c.accuracy; S.lastFix = fix;
    S.fixBuf.push({ lat: fix.lat, lon: fix.lon, acc: c.accuracy, t: fix.t, rt: now() }); if (S.fixBuf.length > 20) S.fixBuf.shift();
    var sogMs = (c.speed !== null && c.speed !== undefined && !isNaN(c.speed)) ? c.speed : null;
    var hdg = (c.heading !== null && c.heading !== undefined && !isNaN(c.heading)) ? c.heading : null;
    // rezerva kad telefon ne da brzinu/kurs: poredi sa očitavanjem od pre 1-4 s
    var ref = null;
    for (var i = 0; i < S.fixBuf.length - 1; i++) {
      var age = (fix.t - S.fixBuf[i].t) / 1000;
      if (age <= 4 && age >= 0.9) { ref = S.fixBuf[i]; break; }
    }
    if (ref) {
      var d = dist(ref, fix), dt = (fix.t - ref.t) / 1000;
      if (sogMs === null && dt > 0) sogMs = d / dt;
      if (hdg === null && d > 3) hdg = bearing(ref, fix);
    }

    var t = now(), dts = lastGeoT ? (t - lastGeoT) / 1000 : 0; lastGeoT = t;
    var tau = TAU[cfg.damp] || 0, a = (tau === 0 || dts <= 0) ? 1 : 1 - Math.exp(-dts / tau);
    if (sogMs !== null) {
      var kn = sogMs * 1.943844;
      S.sog = S.sog === null ? kn : S.sog + (kn - S.sog) * a;
    }
    if (hdg !== null && (S.sog === null || S.sog > 0.5)) {
      var sx = Math.sin(toRad(hdg)), cx = Math.cos(toRad(hdg));
      if (hs === null) { hs = sx; hc = cx; } else { hs += (sx - hs) * a; hc += (cx - hc) * a; }
      S.hdg = (Math.atan2(hs, hc) * 180 / Math.PI + 360) % 360;
    }
    renderSog();
    var rawKn = sogMs === null ? null : sogMs * 1.943844;
    liftOnFix(hdg, rawKn, S.heel);
    logRow(hdg, rawKn);
  }
  function onGeoErr(e) {
    S.geoError = e.code + ': ' + e.message;
    if (e.code === 1) S.geoPerm = 'denied';
    renderSog(); updateSensorsBtn();
  }
  function renderSog() {
    $('sog').textContent = S.sog === null ? '–.–' : S.sog.toFixed(1);
    $('hdg').textContent = S.hdg === null ? '–––' : ('00' + Math.round(S.hdg) % 360).slice(-3);
    var n = $('gpsNote');
    if (S.geoError) n.textContent = 'GPS greška: ' + S.geoError;
    else if (!S.fixes) n.textContent = 'čekam GPS…';
    else n.textContent = 'GPS ±' + Math.round(S.acc) + ' m' + (S.sog !== null && S.sog <= 0.5 ? ' · heading se prikazuje iznad 0.5 kn' : '');
  }

  /* ---------- pokretanje senzora ---------- */
  function startMotion() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then(function (r) {
        S.motionPerm = r; if (r === 'granted') window.addEventListener('devicemotion', onMotion);
        updateSensorsBtn();
      }).catch(function (e) { S.motionPerm = 'greška: ' + e.message; updateSensorsBtn(); });
    } else if ('DeviceMotionEvent' in window) {
      S.motionPerm = 'nije potrebna';
      window.addEventListener('devicemotion', onMotion);
    } else S.motionPerm = 'nije podržano';
  }
  var geoWatch = null;
  function startGeo() {
    if (!('geolocation' in navigator)) { S.geoError = 'geolocation nije podržan'; return; }
    if (geoWatch !== null) return;
    geoWatch = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function startSensors() {
    if (!S.started) { S.started = true; startMotion(); }
    startGeo();
    setTimeout(updateSensorsBtn, 2500);
  }
  function updateSensorsBtn() {
    var needMotion = S.motionEvents === 0 && S.motionPerm !== 'nije podržano';
    var needGeo = S.geoPerm === 'denied';
    $('sensorsBtn').classList.toggle('hidden', !(S.started && (needMotion || needGeo)));
    if (needGeo) $('sensorsBtn').textContent = 'Lokacija je blokirana: Chrome ⋮ → Settings → Site settings → Location';
    else $('sensorsBtn').textContent = 'Dodirni da uključiš senzore nagiba';
  }
  $('sensorsBtn').addEventListener('click', function () {
    S.started = false; startSensors();
  });
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(function (st) {
      S.geoPerm = st.state; st.onchange = function () { S.geoPerm = st.state; };
    }).catch(function () {});
  }

  /* ---------- wake lock ---------- */
  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) { S.wake = 'nije podržano'; return; }
    if (wakeLock) return;
    navigator.wakeLock.request('screen').then(function (wl) {
      wakeLock = wl; S.wake = 'aktivno';
      wl.addEventListener('release', function () { wakeLock = null; S.wake = 'otpušteno'; });
    }).catch(function (e) { S.wake = 'greška: ' + e.message; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (currentView === 'race') requestWakeLock(); checkVersion(); }
  });

  /* ---------- LIFT / HEADER ---------- */
  // Smer: +delta = okret u smeru kazaljke (CW). Na desnim uzdama (vetar s desne) lift = CW; na levim lift = CCW.
  // Uz vetar lift je povoljan (zeleno), niz vetar lift znači "idi u gybe" (crveno).
  var LP = { TURN: 50, TURN_WIN: 20, COOLDOWN: 15, SPEED_OK: 0.9, PLATEAU: 0.03, HDG_STD: 4, TIMEOUT: 60, HARD: 90, LOCK: 8, HEEL: 4 };
  var L = {
    hist: [], phase: 'idle', leg: cfg.startLeg || 'up', side: null,
    ref: null, refSrc: null, lastT: 0, turnT: 0, turnDir: 0, v0: null, heelBefore: null,
    lockStart: 0, lastRef: { stbd: null, port: null }, note: ''
  };
  function nrm(d) { d = ((d % 360) + 540) % 360 - 180; return d; }
  function cmean(arr) {
    var sx = 0, cx = 0; arr.forEach(function (h) { sx += Math.sin(toRad(h)); cx += Math.cos(toRad(h)); });
    return (Math.atan2(sx, cx) * 180 / Math.PI + 360) % 360;
  }
  function cstd(arr) {
    if (arr.length < 2) return 99; var m = cmean(arr), s = 0;
    arr.forEach(function (h) { var d = nrm(h - m); s += d * d; }); return Math.sqrt(s / arr.length);
  }
  function win(from, to) { return L.hist.filter(function (e) { return e.t >= from && e.t <= to; }); }
  function avg(arr, k) { var v = arr.filter(function (e) { return e[k] !== null && e[k] !== undefined; }); if (!v.length) return null; var s = 0; v.forEach(function (e) { s += e[k]; }); return s / v.length; }
  function hdgs(arr) { return arr.filter(function (e) { return e.hdg !== null; }).map(function (e) { return e.hdg; }); }
  function heelOk() { return S.motionEvents > 0; }
  function strong(h) { return h !== null && Math.abs(h) >= LP.HEEL; }
  function sideFromHeel(h) { return strong(h) ? (h > 0 ? 'port' : 'stbd') : null; } // nagib na desnu stranu = vetar s leve = leve uzde

  function settledNow(t) {
    var last8 = hdgs(win(t - 8000, t)), a = win(t - 2000, t), b = win(t - 5000, t - 3000);
    var va = avg(a, 'sog'), vb = avg(b, 'sog');
    var plateau = va !== null && vb !== null && va > 0.8 && Math.abs(va - vb) / va < LP.PLATEAU + 0.02;
    var h3 = hdgs(win(t - 3000, t)), hOld = hdgs(win(t - 8000, t - 5000));
    var drift = (h3.length && hOld.length) ? Math.abs(nrm(cmean(h3) - cmean(hOld))) : 99;
    var stable = last8.length >= 5 && cstd(last8) < LP.HDG_STD && drift < 3;
    return { plateau: plateau, stable: stable, v: va };
  }
  function lockRef(src, value) {
    L.ref = value; L.refSrc = src; L.phase = 'locked';
    if (L.side && src === 'smart') { /* zapamti za poređenje posle sledećeg okreta na isti hals */ }
  }
  function finishManeuver(t) {
    var ha = avg(win(t - 5000, t), 'heel'), hb = L.heelBefore, kind = L.leg === 'up' ? 'okret' : 'gybe';
    var turnSide = L.leg === 'up' ? (L.turnDir < 0 ? 'stbd' : 'port') : (L.turnDir > 0 ? 'stbd' : 'port');
    if (L.leg === 'up') {
      if (heelOk() && strong(hb) && !strong(ha) && Math.abs(L.turnSum) >= 70) {
        L.leg = 'down'; kind = 'oborio (niz vetar)';
        toast('Prepoznato: niz vetar', 'Ne, uz vetar', function () { L.leg = 'up'; renderLift(); }, 6000);
      } else { L.side = turnSide; }
    } else {
      if (heelOk() && strong(ha) && !strong(hb)) {
        L.leg = 'up'; L.side = sideFromHeel(ha) || turnSide; kind = 'orcao (uz vetar)';
        toast('Prepoznato: uz vetar', 'Ne, niz vetar', function () { L.leg = 'down'; renderLift(); }, 6000);
      } else { L.side = turnSide; }
    }
    L.note = kind;
  }

  function liftOnFix(hdg, kn, heel) {
    var t = now();
    L.hist.push({ t: t, hdg: hdg, sog: kn, heel: heel });
    while (L.hist.length && t - L.hist[0].t > 120000) L.hist.shift();
    if (kn === null || kn < 1.0 || hdg === null) { renderLift(); return; }

    // 1) detekcija manevra: zbir promena kursa u zadnjih 20 s (od poslednjeg manevra)
    if (t - L.lastT > LP.COOLDOWN * 1000) {
      var from = Math.max(t - LP.TURN_WIN * 1000, L.lastT), w = win(from, t).filter(function (e) { return e.hdg !== null && e.sog !== null && e.sog >= 1; });
      var sum = 0; for (var i = 1; i < w.length; i++) sum += nrm(w[i].hdg - w[i - 1].hdg);
      if (Math.abs(sum) >= LP.TURN) {
        var pre = win(t - 50000, t - LP.TURN_WIN * 1000);
        L.v0 = avg(pre, 'sog'); L.heelBefore = avg(pre, 'heel');
        if (L.phase === 'locked' && L.ref !== null && L.side) L.lastRef[L.side] = L.ref;
        L.turnDir = sum > 0 ? 1 : -1; L.turnSum = sum; L.turnT = t; L.lastT = t;
        L.phase = 'accel'; L.ref = null; L.refSrc = null; L.note = '';
        buzz(80);
      }
    }
    // 2) ubrzavanje -> kraj faze
    if (L.phase === 'accel' && t - L.turnT > 6000) {
      var st = settledNow(t), since = (t - L.turnT) / 1000;
      var speedOk = !L.v0 || L.v0 < 1.5 || (st.v !== null && st.v >= LP.SPEED_OK * L.v0);
      if ((speedOk && st.plateau && st.stable) || (since > LP.TIMEOUT && st.plateau && st.stable) || since > LP.HARD) {
        finishManeuver(t);
        if (cfg.liftMode === 'smart') { L.phase = 'locking'; L.lockStart = t; } else L.phase = 'wait';
      }
    }
    // 3) prvi hals bez prethodnog manevra (smart)
    if (L.phase === 'idle' && cfg.liftMode === 'smart') {
      var s0 = settledNow(t);
      if (s0.plateau && s0.stable && kn >= 1.5) {
        if (!L.side) L.side = sideFromHeel(avg(win(t - 5000, t), 'heel'));
        L.phase = 'locking'; L.lockStart = t;
      }
    }
    // 4) zaključavanje reference (prosek ~8 s)
    if (L.phase === 'locking' && t - L.lockStart >= LP.LOCK * 1000) {
      var hh = hdgs(win(L.lockStart - 2000, t));
      if (cstd(hh) < LP.HDG_STD * 1.5 && settledNow(t).stable) lockRef('smart', cmean(hh));
      else L.lockStart = t; // još se koleba, probaj ponovo
    }
    renderLift();
  }

  function manualRef() {
    var t = now(), hh = hdgs(win(t - 3000, t));
    var v = hh.length ? cmean(hh) : S.hdg;
    if (v === null || v === undefined) { toast('Još nema kursa (treba brzina iznad 1 čvora).'); return; }
    if (L.phase === 'accel') finishManeuver(t);
    if (!L.side) L.side = sideFromHeel(S.heel);
    lockRef('manual', v); buzz(60);
    toast('Referenca postavljena: ' + ('00' + Math.round(v) % 360).slice(-3) + '°');
    renderLift();
  }
  $('liftBox').addEventListener('click', function (e) { if (e.target.id === 'legChip') return; manualRef(); });
  $('legChip').addEventListener('click', function (e) {
    e.stopPropagation(); L.leg = L.leg === 'up' ? 'down' : 'up'; renderLift();
  });

  function renderLift() {
    var chip = $('legChip'), val = $('liftVal'), sub = $('liftSub');
    chip.textContent = L.leg === 'up' ? '▲ UZ VETAR' : '▼ NIZ VETAR';
    var sideTxt = L.side === 'stbd' ? 'desne uzde' : (L.side === 'port' ? 'leve uzde' : 'strana ?');
    var modeTxt = L.refSrc === 'manual' ? 'MANUAL' : (L.refSrc === 'smart' ? 'SMART' : (cfg.liftMode === 'smart' ? 'SMART' : 'MANUAL'));
    val.className = 'lift-val';
    if (L.phase === 'accel') { val.textContent = 'ubrzavanje…'; val.classList.add('wait'); sub.textContent = 'čekam da brod ubrza i smiri kurs · dodir = ručna referenca'; return; }
    if (L.phase === 'locking') { val.textContent = 'uzimam kurs…'; val.classList.add('wait'); sub.textContent = (L.note ? L.note + ' · ' : '') + sideTxt; return; }
    if (L.ref === null || S.hdg === null) {
      val.textContent = 'dodirni'; val.classList.add('wait');
      sub.textContent = (L.phase === 'wait' ? (L.note ? L.note + ' · ' : '') : '') + 'dodir ovde = referentni kurs · ' + modeTxt;
      return;
    }
    var tn = now(), rw = win(tn - 4000, tn).filter(function (e) { return e.hdg !== null; }), rs = 0;
    for (var ri = 1; ri < rw.length; ri++) rs += nrm(rw[ri].hdg - rw[ri - 1].hdg);
    if (Math.abs(rs) > 15) { val.textContent = 'manevar…'; val.classList.add('wait'); sub.textContent = 'kurs se brzo menja'; return; }
    var d = nrm(S.hdg - L.ref);
    var refTxt = 'ref ' + ('00' + Math.round(L.ref) % 360).slice(-3) + '° · ' + sideTxt + ' · ' + modeTxt;
    if (!L.side) {
      val.textContent = (d >= 0 ? '► ' : '◄ ') + Math.abs(Math.round(d)) + '°';
      sub.textContent = refTxt + ' · strana nepoznata';
      return;
    }
    var lift = L.side === 'stbd' ? d : -d, a = Math.abs(Math.round(lift));
    if (a < 2) { val.textContent = '= 0°'; }
    else {
      val.textContent = (lift > 0 ? '▲ ' : '▼ ') + a + '° ' + (lift > 0 ? 'LIFT' : 'HEADER');
      var good = L.leg === 'up' ? lift > 0 : lift < 0;
      val.classList.add(good ? 'good' : 'bad');
    }
    var prev = L.lastRef[L.side], extra = '';
    if (prev !== null && L.refSrc === 'smart') {
      var sh = nrm(L.ref - prev); sh = L.side === 'stbd' ? sh : -sh;
      extra = ' · prošli put na ovom halsu ' + (sh >= 0 ? '+' : '') + Math.round(sh) + '°';
    }
    sub.textContent = refTxt + extra;
  }

  // podešavanja lift/header
  function renderLmode() {
    document.querySelectorAll('[data-lmode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lmode') === cfg.liftMode); });
    $('lmodeInfo').textContent = cfg.liftMode === 'smart'
      ? 'Smart: posle svakog manevra aplikacija sama uzima referencu kad brod ubrza i smiri kurs. (Pro funkcija, za sada otključana za test.)'
      : 'Manual: posle svakog manevra dodirni lift/header polje kad se smiriš na kursu.';
  }
  document.querySelectorAll('[data-lmode]').forEach(function (b) {
    b.addEventListener('click', function () { cfg.liftMode = b.getAttribute('data-lmode'); store.set('liftMode', cfg.liftMode); renderLmode(); renderLift(); });
  });
  $('startLeg').value = cfg.startLeg || 'up';
  $('startLeg').addEventListener('change', function (e) { cfg.startLeg = e.target.value; store.set('startLeg', cfg.startLeg); L.leg = cfg.startLeg; renderLift(); });
  renderLmode();

  /* ---------- SIMULACIJA OKRETA ---------- */
  var simTimer = null;
  function simFix(pos, hdg, kn, heel) {
    S.heel = heel; S.motionEvents = Math.max(S.motionEvents, 1);
    onFix({ __sim: true, timestamp: now(), coords: { latitude: pos.lat, longitude: pos.lon, accuracy: 3, speed: kn / 1.943844, heading: hdg } });
  }
  function startSim() {
    if (simTimer) return;
    S.sim = true; L.leg = 'up'; L.side = null; L.phase = 'idle'; L.ref = null; L.lastT = 0; L.hist = [];
    var badge = document.createElement('div'); badge.className = 'sim-badge'; badge.id = 'simBadge'; badge.textContent = 'SIMULACIJA'; document.body.appendChild(badge);
    var pos = S.lastFix ? { lat: S.lastFix.lat, lon: S.lastFix.lon } : { lat: 44.785, lon: 20.40 };
    var k = 0, h = 45, n = function (a) { return (Math.random() - 0.5) * 2 * a; };
    show('race'); setTimeout(function () { goPage(1); }, 100);
    toast('Simulacija: leve uzde 045°, okret oko 35. s, zatim lift 8° oko 90. s', null, null, 5000);
    simTimer = setInterval(function () {
      k++;
      var kn, heel;
      if (k <= 35) { h = 45; kn = 5; heel = 12; }
      else if (k <= 41) { h = 45 - (k - 35) * 15; kn = 5 - (k - 35) * 0.37; heel = 12 - (k - 35) * 4; }
      else if (k <= 47) { h = 305; kn = 3 + (k - 41) * 0.2; heel = -12; }
      else if (k <= 55) { h = 305 + (k - 47) * 1.25; kn = 4.2 + (k - 47) * 0.08; heel = -12; }
      else if (k <= 88) { h = 315; kn = 4.95; heel = -12; }
      else if (k <= 93) { h = 315 + (k - 88) * 1.6; kn = 4.95; heel = -12; }
      else { h = 323; kn = 4.95; heel = -12; }
      var hh = (h + n(1.5) + 360) % 360, kk = kn + n(0.08);
      var dm = kk / 1.943844;
      pos.lat += dm * Math.cos(toRad(hh)) / 111195; pos.lon += dm * Math.sin(toRad(hh)) / (111195 * Math.cos(toRad(pos.lat)));
      simFix(pos, hh, kk, heel + n(1));
      if (k >= 125) stopSim();
    }, 1000);
  }
  function stopSim() {
    clearInterval(simTimer); simTimer = null; S.sim = false;
    var b = $('simBadge'); if (b) b.remove();
    toast('Simulacija završena');
  }
  $('simBtn').addEventListener('click', function () { if (simTimer) stopSim(); else startSim(); });

  /* ---------- SNIMANJE ---------- */
  var LOG = { on: false, rows: store.get('log', []) };
  function logRow(hdg, kn) {
    if (!LOG.on || !S.lastFix) return;
    var lift = (L.ref !== null && S.hdg !== null && L.side) ? (L.side === 'stbd' ? 1 : -1) * nrm(S.hdg - L.ref) : '';
    LOG.rows.push([new Date().toISOString(), S.lastFix.lat.toFixed(6), S.lastFix.lon.toFixed(6), S.acc === null ? '' : Math.round(S.acc),
      kn === null ? '' : kn.toFixed(2), hdg === null ? '' : Math.round(hdg), S.sog === null ? '' : S.sog.toFixed(2), S.hdg === null ? '' : Math.round(S.hdg),
      S.heel === null ? '' : S.heel.toFixed(1), L.phase, L.leg, L.side || '', L.ref === null ? '' : Math.round(L.ref), lift === '' ? '' : Math.round(lift),
      T.state, T.state === 'count' ? Math.round((T.end - now()) / 1000) : '', S.sim ? 1 : 0].join(','));
    if (LOG.rows.length % 15 === 0) store.set('log', LOG.rows);
    renderLog();
  }
  function renderLog() {
    $('logBtn').textContent = LOG.on ? 'Zaustavi snimanje' : 'Počni snimanje';
    $('logInfo').textContent = LOG.rows.length ? ('Snimljeno ' + LOG.rows.length + ' sekundi (~' + Math.round(LOG.rows.length / 60) + ' min).') : 'Nema snimka.';
  }
  $('logBtn').addEventListener('click', function () {
    if (!LOG.on && LOG.rows.length) {
      toast('Postoji stari snimak.', 'Obriši i počni nov', function () { LOG.rows = []; LOG.on = true; store.set('log', []); renderLog(); }, 5000);
      return;
    }
    LOG.on = !LOG.on; store.set('log', LOG.rows); renderLog();
  });
  $('logExport').addEventListener('click', function () {
    if (!LOG.rows.length) { toast('Nema snimka.'); return; }
    var head = 'time,lat,lon,acc_m,sog_raw_kn,cog_raw,sog_kn,hdg,heel,lift_phase,leg,side,ref,lift_deg,timer_state,tts_s,sim';
    var blob = new Blob([head + '\n' + LOG.rows.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a'), d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'race-log-' + d.toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Fajl je u Downloads folderu telefona');
  });
  renderLog();

  /* ---------- START LINIJA ---------- */
  // Konvencija: gledano u vetar iza linije, BOAT (komisijski brod) je desno, PIN levo.
  var line = { pin: store.get('pin', null), boat: store.get('boat', null) };
  var LINE_TOL = 3; // sekunde tolerancije za "na vreme"

  function recentFix() {
    var t = now(), buf = S.fixBuf.filter(function (f) { return t - f.rt < 3000; });
    if (!buf.length && S.fixBuf.length && t - S.fixBuf[S.fixBuf.length - 1].rt < 5000) buf = [S.fixBuf[S.fixBuf.length - 1]];
    if (!buf.length) return null;
    var la = 0, lo = 0, ac = 0;
    buf.forEach(function (f) { la += f.lat; lo += f.lon; ac += f.acc; });
    return { lat: la / buf.length, lon: lo / buf.length, acc: ac / buf.length };
  }
  function setPoint(which) {
    var f = recentFix();
    if (!f) { toast('Nema GPS signala, sačekaj pa pokušaj ponovo.'); return; }
    line[which] = { lat: f.lat, lon: f.lon, acc: f.acc, t: new Date().toISOString() };
    store.set(which, line[which]); buzz(150);
    var msg = (which === 'pin' ? 'PIN' : 'BOAT') + ' postavljen (±' + Math.round(f.acc) + ' m)';
    if (f.acc > 15) msg += '. Slab GPS, ponovi kad se popravi.';
    toast(msg); renderLine();
  }
  function pointBtn(which, el) {
    el.addEventListener('click', function () {
      unlockAudio();
      if (!line[which]) setPoint(which);
      else toast((which === 'pin' ? 'PIN' : 'BOAT') + ' je već postavljen.', 'Postavi ponovo', function () { setPoint(which); }, 4000);
    });
  }
  pointBtn('pin', $('pinBtn')); pointBtn('boat', $('boatBtn'));
  $('lineClear').addEventListener('click', function () {
    toast('Obrisati liniju?', 'Obriši', function () {
      line.pin = null; line.boat = null; store.set('pin', null); store.set('boat', null); renderLine(); toast('Linija obrisana');
    }, 4000);
  });

  function xy(ref, p) {
    return { x: toRad(p.lon - ref.lon) * 6371000 * Math.cos(toRad(ref.lat)), y: toRad(p.lat - ref.lat) * 6371000 };
  }
  function lineCalc(pos) {
    var b = xy(line.pin, line.boat), x = xy(line.pin, pos);
    var L2 = b.x * b.x + b.y * b.y, L = Math.sqrt(L2);
    var t = L2 ? Math.max(0, Math.min(1, (x.x * b.x + x.y * b.y) / L2)) : 0;
    var cx = b.x * t, cy = b.y * t;
    var dist = Math.sqrt((x.x - cx) * (x.x - cx) + (x.y - cy) * (x.y - cy));
    var cross = b.x * x.y - b.y * x.x; // > 0 = strana kursa (preko linije)
    return { len: L, dist: dist, over: cross > 0 };
  }
  function renderLine() {
    var both = !!(line.pin && line.boat);
    $('pinBtn').classList.toggle('set', !!line.pin);
    $('boatBtn').classList.toggle('set', !!line.boat);
    $('pinBtn').textContent = line.pin ? 'PIN ✓' : 'PIN';
    $('boatBtn').textContent = line.boat ? 'BOAT ✓' : 'BOAT';
    $('lineClear').classList.toggle('hidden', !(line.pin || line.boat));
    var show = both && T.state !== 'race';
    $('p-timer').classList.toggle('lined', show);
    $('lineBlock').classList.toggle('hidden', !show);
    if (!show) return;

    var el = $('dtl'), info = $('lineInfo'), cls = 'none', txt = '––';
    var lenTxt = 'linija ' + Math.round(lineCalc(line.boat).len) + ' m';
    var last = S.fixBuf.length ? S.fixBuf[S.fixBuf.length - 1] : null;
    if (!last || now() - last.rt > 5000) {
      info.textContent = lenTxt + ' · nema GPS signala';
    } else {
      var r = lineCalc(last);
      var tts = T.state === 'count' ? (T.end - now()) / 1000 : cfg.preset * 60;
      if (r.over) { cls = 'ocs'; txt = '−' + Math.round(r.dist); }
      else {
        txt = String(Math.round(r.dist));
        var v = (S.sog || 0) / 1.943844;
        var ttl = v > 0.26 ? r.dist / v : Infinity;
        var margin = ttl - tts;
        cls = margin > LINE_TOL ? 'late' : (margin < -LINE_TOL ? 'early' : 'ok');
      }
      info.textContent = (r.over ? 'PREKO LINIJE · ' : '') + lenTxt + ' · GPS ±' + Math.round(last.acc) + ' m';
    }
    el.textContent = txt;
    el.className = 'dtl ' + cls;
  }

  /* ---------- settings ---------- */
  var damp = $('damp');
  damp.value = cfg.damp;
  damp.addEventListener('input', function () { cfg.damp = +damp.value; store.set('damp', cfg.damp); renderSettings(); });
  $('heelInvert').checked = cfg.heelInvert;
  $('heelInvert').addEventListener('change', function (e) { cfg.heelInvert = e.target.checked; store.set('heelInvert', cfg.heelInvert); S.heel = null; });
  $('heelStep').value = String(cfg.heelStep);
  $('heelStep').addEventListener('change', function (e) { cfg.heelStep = +e.target.value; store.set('heelStep', cfg.heelStep); });
  function renderSettings() {
    $('dampVal').textContent = cfg.damp + (cfg.damp === 0 ? ' (bez ublažavanja)' : ' (≈' + TAU[cfg.damp] + ' s)');
    $('calInfo').textContent = cfg.calOffset === null ? 'Kalibracija nije postavljena.'
      : 'Nula postavljena ' + new Date(cfg.calTime).toLocaleString('sr-RS') + ' (pomak ' + cfg.calOffset.toFixed(1) + '°).';
  }
  function diagText() {
    return [
      'verzija: ' + APP_VERSION,
      'bezbedna veza (HTTPS): ' + (window.isSecureContext ? 'da' : 'NE'),
      'uređaj: ' + navigator.userAgent,
      '— GPS —',
      'dozvola lokacije: ' + S.geoPerm,
      'broj GPS očitavanja: ' + S.fixes,
      'tačnost: ' + (S.acc === null ? '—' : Math.round(S.acc) + ' m'),
      'greška: ' + (S.geoError || 'nema'),
      '— senzori —',
      'dozvola senzora: ' + S.motionPerm,
      'broj očitavanja senzora: ' + S.motionEvents,
      'sirovi nagib: ' + (S.rawHeel === null ? '—' : S.rawHeel.toFixed(1) + '°'),
      'nagib posle kalibracije: ' + (S.heel === null ? '—' : S.heel.toFixed(1) + '°'),
      '— ostalo —',
      'ekran ostaje upaljen: ' + S.wake,
      'dampening: ' + cfg.damp
    ].join('\n');
  }
  function renderDiag() { $('diag').textContent = diagText(); }
  $('diagCopy').addEventListener('click', function () {
    var txt = diagText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('Kopirano, nalepi mi u razgovor'); }, function () { toast('Kopiranje nije uspelo, označi tekst ručno'); });
    } else toast('Označi tekst ručno i kopiraj');
  });
  renderSettings();

  /* ---------- provera nove verzije ---------- */
  function checkVersion() {
    if (location.protocol === 'file:') return;
    fetch('version.json?t=' + now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.version && j.version !== APP_VERSION) {
        var u = $('update'); u.classList.remove('hidden');
        u.onclick = function () { location.replace(location.pathname + '?v=' + j.version); };
      }
    }).catch(function () {});
  }
  checkVersion();
  setInterval(checkVersion, 60000);

  // test hook
  window.__ra = { S: S, T: T, cfg: cfg, calibrate: calibrate, show: show };
})();
