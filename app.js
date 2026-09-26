/* The Race App — v0.1.1 */
(function () {
  'use strict';
  var APP_VERSION = '0.1.1';
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
    preset: store.get('preset', 5)
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
    sog: null, hdg: null, prevFix: null, wake: 'nije traženo'
  };

  function heelFromGravity(gx, gy, gz) {
    // bočni nagib = ugao gravitacije prema x osi telefona; radi i uspravno i položeno
    var r = Math.atan2(gx, Math.sqrt(gy * gy + gz * gz)) * 180 / Math.PI;
    return IS_IOS ? r : -r; // iOS ima obrnut znak
  }
  function onMotion(ev) {
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
    S.fixes++; S.geoPerm = 'granted'; S.geoError = '';
    var c = p.coords, fix = { lat: c.latitude, lon: c.longitude, t: p.timestamp || now() };
    S.acc = c.accuracy; S.lastFix = fix;
    var sogMs = (c.speed !== null && c.speed !== undefined && !isNaN(c.speed)) ? c.speed : null;
    var hdg = (c.heading !== null && c.heading !== undefined && !isNaN(c.heading)) ? c.heading : null;
    if (S.prevFix) {
      var d = dist(S.prevFix, fix), dt = (fix.t - S.prevFix.t) / 1000;
      if (sogMs === null && dt > 0) sogMs = d / dt;
      if (hdg === null && d > 3) hdg = bearing(S.prevFix, fix);
      if (d > 3 || dt > 5) S.prevFix = fix;
    } else S.prevFix = fix;

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
