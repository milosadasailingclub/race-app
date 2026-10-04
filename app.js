/* The Race App — v0.9.27 */
(function () {
  'use strict';
  var APP_VERSION = '0.9.27';
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
    ledMirror: store.get('ledMirror', false),
    heelStep: store.get('heelStep', 3),
    calOffset: store.get('calOffset', null),
    calTime: store.get('calTime', null),
    theme: store.get('theme', 'night'),
    preset: store.get('preset', 5),
    liftMode: store.get('liftMode', 'smart'),
    lockDelay: store.get('lockDelay', 10),
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
    document.body.setAttribute('data-view', v);
    if (v === 'race' || v === 'settings') { startSensors(); }
    if (v === 'race') { requestWakeLock(); }
    if (v === 'settings') { renderSettings(); }
    if (v === 'weather') { wxOpen(); }
    if (v === 'checklist' && window.Checklist) { window.Checklist.open(); }
    if (v === 'tracking' && window.Track) { window.Track.openList(); }
  }
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { unlockAudio(); show(b.getAttribute('data-go')); });
  });
  document.querySelectorAll('.menu-item.soon').forEach(function (b) {
    b.addEventListener('click', function () { toast('Coming in a later version.'); });
  });
  $('dndBtn').addEventListener('click', function () {
    toast('Automatic DND comes with the native app. For now, turn on Do Not Disturb manually.', null, null, 4000);
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
      if (i === 2 && window.Track) window.Track.showLive();
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
    if (T.state === 'idle') {
      el.textContent = cfg.preset + ':00'; el.classList.remove('last', 'up');
      sub.textContent = 'TTS'; btn.textContent = 'START';
    } else if (T.state === 'count') {
      var rem = T.end - now();
      el.textContent = fmt(rem); el.classList.toggle('last', rem <= 60000); el.classList.remove('up');
      sub.textContent = 'TTS'; btn.textContent = 'SYNC';
    } else {
      el.textContent = '+' + fmtUp(now() - T.end); el.classList.remove('last'); el.classList.add('up');
      sub.textContent = 'RACE TIME'; btn.textContent = 'FINISH';
    }
  }
  function tick() {
    if (T.state === 'count') {
      var rem = T.end - now();
      var sec = Math.ceil(rem / 1000);
      if (rem <= 0) {
        T.state = 'race'; signal('gun'); TAC.marks = { top: null, bottom: null }; TAC.axHist = [];
        (function () { var la = startAxis(); L.axis = la; L.leg = cfg.startLeg || 'up'; if (la !== null && S.hdg !== null) L.side = sideFromAxis(S.hdg); })();
        if (window.Track) window.Track.autoStart();
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

  var suppressClick = false;
  $('sync').addEventListener('click', function () {
    if (suppressClick) { suppressClick = false; return; }
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
    } else if (T.state === 'race') {
      var recOn = window.Track && window.Track._rec();
      toast(recOn ? 'Finish race and stop track?' : 'Finish race?', 'Finish', function () {
        if (window.Track) window.Track.stop();
        T.state = 'idle'; T.lastSec = null; tick();
      }, 5000);
      return;
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
  // Reset: dug pritisak (1.2 s) na SYNC/RACE dugme
  (function () {
    var el = $('sync'), tmr = null;
    el.addEventListener('pointerdown', function () {
      if (T.state === 'idle') return;
      tmr = setTimeout(function () {
        tmr = null; suppressClick = true; buzz(60);
        toast('Reset timer?', 'Reset', function () { T.state = 'idle'; T.lastSec = null; tick(); toast('Timer reset'); }, 4000);
      }, 1200);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { el.addEventListener(n, function () { if (tmr) { clearTimeout(tmr); tmr = null; } }); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();
  setPreset(cfg.preset);

  function renderElapsed() {
    var e = $('elapsed');
    if (T.state === 'race') e.textContent = '+' + fmtUp(now() - T.end);
    else if (T.state === 'count') e.textContent = 'TTS ' + fmt(T.end - now());
    else e.textContent = '—';
  }

  /* ---------- SENSORI: nagib ---------- */
  var S = {
    started: false, motionPerm: 'unknown', motionEvents: 0, lastMotion: 0,
    rawHeel: null, heel: null, lastT: 0, recent: [],
    geoPerm: 'unknown', geoError: '', fixes: 0, lastFix: null, acc: null,
    sog: null, hdg: null, prevFix: null, wake: 'not requested', fixBuf: []
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
    // Telefon je uvek ekranom ka posadi (ka krmi). Izmereno na vodi 2.10.: sirovi znak je bio obrnut,
    // pa je podrazumevano obrnuto: + = nagib na desno (starboard), LED-ovi svetle na strani na koju je brod nagnut.
    val = -val; // senzor: + = nagib na desno (starboard), uvek za telefon okrenut ka posadi
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
    if (cfg.ledMirror) side = -side; // samo prikaz: LED-ovi na suprotnoj strani
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
    if (!S.recent.length) { toast('No sensor data yet. Tap the screen and try again.'); return; }
    var prev = { off: cfg.calOffset, t: cfg.calTime };
    var sum = 0; S.recent.forEach(function (v) { sum += v; });
    cfg.calOffset = sum / S.recent.length; cfg.calTime = new Date().toISOString();
    store.set('calOffset', cfg.calOffset); store.set('calTime', cfg.calTime);
    S.heel = null; buzz(150);
    toast('Zero set', 'Undo', function () {
      cfg.calOffset = prev.off; cfg.calTime = prev.t;
      store.set('calOffset', cfg.calOffset); store.set('calTime', cfg.calTime); S.heel = null;
      toast('Previous zero restored');
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
    S.heel = null; renderSettings(); toast('Calibration cleared');
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
  // Android (Chrome/fused location) ume da "zamrzne" poziciju kad telefon miruje u odnosu na brod:
  // ista pozicija, brzina 0, i do ~30 s. Tada držimo poslednju brzinu/kurs i procenjujemo poziciju (dead reckoning).
  var FZ = { on: false, since: 0, after: 0, good: null, raw: null, count: 0 };
  var FZ_MAX = 40000;
  function onFix(p) {
    if (S.sim && !p.__sim) return;
    S.fixes++; S.geoPerm = 'granted'; S.geoError = '';
    var c = p.coords, fix = { lat: c.latitude, lon: c.longitude, t: p.timestamp || now() };
    var repKn = (c.speed !== null && c.speed !== undefined && !isNaN(c.speed)) ? c.speed * 1.943844 : null;
    var same = FZ.raw && FZ.raw.lat === c.latitude && FZ.raw.lon === c.longitude;
    FZ.raw = { lat: c.latitude, lon: c.longitude };
    var g = FZ.good, tn0 = now();
    if (g && g.kn > 1.2 && tn0 - g.t < FZ_MAX && ((repKn !== null && repKn < 0.05) || (repKn === null && same))) {
      if (!FZ.on) { FZ.on = true; FZ.since = tn0; FZ.count++; }
      var dm = g.kn / 1.943844 * (tn0 - g.t) / 1000;
      var dr = { lat: g.lat + dm * Math.cos(toRad(g.hdg)) / 111195, lon: g.lon + dm * Math.sin(toRad(g.hdg)) / (111195 * Math.cos(toRad(g.lat))) };
      S.acc = c.accuracy; S.lastFix = { lat: dr.lat, lon: dr.lon, t: fix.t };
      S.fixBuf.push({ lat: dr.lat, lon: dr.lon, acc: c.accuracy, t: fix.t, rt: tn0, dr: true }); if (S.fixBuf.length > 20) S.fixBuf.shift();
      lastGeoT = tn0;
      renderSog();
      liftOnFix(null, null, S.heel);
      logRow(null, null);
      return;
    }
    if (FZ.on) { FZ.on = false; FZ.after = tn0; S.fixBuf = S.fixBuf.filter(function (f) { return !f.dr; }); }
    S.acc = c.accuracy; S.lastFix = fix;
    S.fixBuf.push({ lat: fix.lat, lon: fix.lon, acc: c.accuracy, t: fix.t, rt: now() }); if (S.fixBuf.length > 20) S.fixBuf.shift();
    var sogMs = repKn === null ? null : c.speed;
    // prvi fix posle zamrzavanja zna da prijavi nerealan skok brzine
    if (sogMs !== null && g && now() - FZ.after < 3000 && repKn > Math.max(8, g.kn * 1.8)) sogMs = null;
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
    if (S.sog !== null && S.hdg !== null) FZ.good = { lat: fix.lat, lon: fix.lon, t: now(), kn: S.sog, hdg: S.hdg };
    var liftNow = (L.ref !== null && S.hdg !== null && L.side) ? Math.round((L.side === 'stbd' ? 1 : -1) * nrm(S.hdg - L.ref)) : null;
    if (window.Track) window.Track.onFix({ t: fix.t, lat: fix.lat, lon: fix.lon, sog: rawKn, cog: hdg === null ? S.hdg : hdg, heel: S.heel, acc: c.accuracy, sim: !!S.sim,
      x: [L.phase, L.leg, L.side || '', L.ref === null ? '' : Math.round(L.ref), liftNow === null ? '' : liftNow, L.axis === null ? '' : Math.round(L.axis), cfg.liftMode, L.refSrc || '', T.state] });
    logRow(hdg, rawKn);
  }
  function onGeoErr(e) {
    S.geoError = e.code + ': ' + e.message;
    if (e.code === 1) S.geoPerm = 'denied';
    renderSog(); updateSensorsBtn();
  }
  function renderSog() {
    $('sog').textContent = S.sog === null ? '–.–' : S.sog.toFixed(1);
    $('sog').classList.toggle('hold', FZ.on); $('hdg').classList.toggle('hold', FZ.on);
    $('hdg').textContent = S.hdg === null ? '–––' : ('00' + Math.round(S.hdg) % 360).slice(-3);
    var n = $('gpsNote');
    if (S.geoError) n.textContent = 'GPS error: ' + S.geoError;
    else if (!S.fixes) n.textContent = 'Waiting for GPS…';
    else if (FZ.on) n.textContent = 'Phone paused GPS · estimating ' + Math.round((now() - FZ.since) / 1000) + ' s';
    else n.textContent = 'GPS ±' + Math.round(S.acc) + ' m' + (S.sog !== null && S.sog <= 0.5 ? ' · heading shown above 0.5 kn' : '');
  }

  /* ---------- pokretanje senzora ---------- */
  function startMotion() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then(function (r) {
        S.motionPerm = r; if (r === 'granted') window.addEventListener('devicemotion', onMotion);
        updateSensorsBtn();
      }).catch(function (e) { S.motionPerm = 'error: ' + e.message; updateSensorsBtn(); });
    } else if ('DeviceMotionEvent' in window) {
      S.motionPerm = 'not required';
      window.addEventListener('devicemotion', onMotion);
    } else S.motionPerm = 'not supported';
  }
  var geoWatch = null;
  function startGeo() {
    if (!('geolocation' in navigator)) { S.geoError = 'geolocation not supported'; return; }
    if (geoWatch !== null) return;
    geoWatch = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function startSensors() {
    if (!S.started) { S.started = true; startMotion(); }
    startGeo();
    setTimeout(updateSensorsBtn, 2500);
  }
  function updateSensorsBtn() {
    var needMotion = S.motionEvents === 0 && S.motionPerm !== 'not supported';
    var needGeo = S.geoPerm === 'denied';
    $('sensorsBtn').classList.toggle('hidden', !(S.started && (needMotion || needGeo)));
    if (needGeo) $('sensorsBtn').textContent = 'Location blocked: Chrome ⋮ → Settings → Site settings → Location';
    else $('sensorsBtn').textContent = 'Tap to enable heel sensors';
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
    if (!('wakeLock' in navigator)) { S.wake = 'not supported'; return; }
    if (wakeLock) return;
    navigator.wakeLock.request('screen').then(function (wl) {
      wakeLock = wl; S.wake = 'active';
      wl.addEventListener('release', function () { wakeLock = null; S.wake = 'released'; });
    }).catch(function (e) { S.wake = 'error: ' + e.message; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (currentView === 'race') requestWakeLock(); checkVersion(); }
  });

  /* ---------- LIFT / HEADER ---------- */
  // Smer: +delta = okret u smeru kazaljke (CW). Na desnim uzdama (vetar s desne) lift = CW; na levim lift = CCW.
  // Uz vetar lift je povoljan (zeleno), niz vetar lift znači "idi u gybe" (crveno).
  // v0.9.3: brže zaključavanje (max ~15 s posle okreta), osa vetra iz halsova, nagib samo ako je telefon stabilno montiran
  var LP = { TURN: 50, TURN_DOWN: 40, TURN_WIN: 20, COOLDOWN: 5, SPEED_OK: 0.9, PLATEAU: 0.03, HDG_STD: 6, MIN_ACC: 4, QUIET: 8, SOFT: 10, HARD: 15, LOCK_WIN: 3, HEEL: 4, HEEL_STD: 3, UP_MAX: 75, DOWN_MIN: 105 };
  var L = {
    hist: [], phase: 'idle', leg: cfg.startLeg || 'up', side: null,
    ref: null, refSrc: null, lastT: 0, turnT: 0, turnDir: 0, v0: null, heelBefore: null,
    lockStart: 0, lastRef: { stbd: null, port: null }, note: '', taS: [], ta: null, axis: null, hdgBefore: null, heelPre: null
  };
  // v0.9.11: automatski mod je podrazumevan; stari default 'manual' prebaci jednom na 'smart'
  if (!store.get('liftModeMig', false)) { if (cfg.liftMode === 'manual') { cfg.liftMode = 'smart'; store.set('liftMode', 'smart'); } store.set('liftModeMig', true); }
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
  function heelStat(arr) {
    var v = arr.filter(function (e) { return e.heel !== null && e.heel !== undefined; }).map(function (e) { return e.heel; });
    if (v.length < 3) return { ok: false, mean: null };
    var m = 0; v.forEach(function (x) { m += x; }); m /= v.length;
    var sd = 0; v.forEach(function (x) { sd += (x - m) * (x - m); }); sd = Math.sqrt(sd / v.length);
    return { ok: heelOk() && sd < LP.HEEL_STD && Math.abs(m) < 35, mean: m, sd: sd }; // nemiran ili nerealan (>35°, pao nosač) -> ne koristi
  }
  function sideFromAxis(h) { return L.axis === null || h === null ? null : (nrm(h - L.axis) > 0 ? 'port' : 'stbd'); }
  function turnQuiet(t) { var w = win(t - 3000, t).filter(function (e) { return e.hdg !== null; }), s = 0; for (var i = 1; i < w.length; i++) s += nrm(w[i].hdg - w[i - 1].hdg); return w.length >= 2 && Math.abs(s) < LP.QUIET; }
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
  // Osa vetra iz startne linije: gledano u vetar PIN je levo, BOAT desno -> uz vetar = smer PIN->BOAT minus 90°
  function lineAxis() {
    if (typeof line === 'undefined' || !line.pin || !line.boat) return null;
    return (bearing(line.pin, line.boat) + 270) % 360;
  }
  function prestart() { return T.state === 'count'; } // samo dok teče odbrojavanje; bez tajmera (trening) učenje radi normalno
  // Pre starta: PIN levo / BOAT desno je iznad svega (pravila) i uvek određuje gde je uz vetar.
  // Sveže naučen vetar (LEARN) samo precizira smer, i to samo ako se slaže sa linijom (±45° od normale linije).
  function startAxis() {
    var la = lineAxis(), lr = (typeof LW !== 'undefined' && LW && LW.res && LW.res.t && Date.now() - Date.parse(LW.res.t) < 1200000) ? LW.res.axis : null;
    if (la === null) return lr;
    if (lr !== null && Math.abs(nrm(lr - la)) <= 45) return lr;
    return la;
  }
  // Taktika L1: bove naučene iz zaobilaženja (bear-away = gornja, round-up = donja) + istorija vetra
  var TAC = { marks: { top: null, bottom: null }, axHist: [] };
  setInterval(function () { if (L.axis !== null) { TAC.axHist.push({ t: now(), a: L.axis }); while (TAC.axHist.length && now() - TAC.axHist[0].t > 1800000) TAC.axHist.shift(); } }, 10000);
  function tacInfo() {
    var mean = TAC.axHist.length >= 6 ? cmean(TAC.axHist.map(function (e) { return e.a; })) : null;
    return { axis: L.axis, ta: L.ta || (LW.res ? LW.res.ta : null), leg: L.leg, side: L.side, marks: TAC.marks, shift: mean !== null && L.axis !== null ? nrm(L.axis - mean) : null };
  }
  function setMarkHere() {
    var f = S.lastFix; if (!f) { toast('No GPS position yet.'); return; }
    var k = L.leg === 'up' ? 'top' : 'bottom'; TAC.marks[k] = { lat: f.lat, lon: f.lon, auto: false };
    buzz(80); toast((k === 'top' ? 'Windward' : 'Leeward') + ' mark set here');
  }
  function pushTA(ta) {
    L.taS.push(ta); if (L.taS.length > 7) L.taS.shift();
    var a = L.taS.slice().sort(function (x, y) { return x - y; }); L.ta = a[Math.floor(a.length / 2)]; // medijana: otporna na šiftove
  }
  function finishManeuver(t) {
    if (typeof LW !== 'undefined' && LW.phase !== 'off') { L.leg = 'up'; var hq = hdgs(win(t - 3000, t)); L.side = sideFromAxis(hq.length ? cmean(hq) : S.hdg) || L.side; L.note = 'Learning'; return; }
    if (prestart()) {
      // pre starta kretanje je nepredvidivo: leg i osa se ne uče iz manevara
      var la = startAxis(); if (la !== null) L.axis = la;
      L.leg = cfg.startLeg || 'up';
      var hB = hdgs(win(t - 3000, t));
      L.side = sideFromAxis(hB.length ? cmean(hB) : S.hdg) || L.side;
      L.note = 'Pre-start';
      return;
    }
    var hA = hdgs(win(t - 3000, t)), after = hA.length ? cmean(hA) : S.hdg, before = L.hdgBefore;
    var kind = L.leg === 'up' ? 'Tack' : 'Gybe', newLeg = L.leg;
    var turnSide = L.leg === 'up' ? (L.turnDir < 0 ? 'stbd' : 'port') : (L.turnDir > 0 ? 'stbd' : 'port');
    if (L.axis !== null && after !== null) {
      // poznata osa vetra -> leg iz geometrije
      var rel = Math.abs(nrm(after - L.axis));
      if (rel <= LP.UP_MAX) newLeg = 'up'; else if (rel >= LP.DOWN_MIN) newLeg = 'down';
    } else {
      // bez ose: nagib samo ako je stabilan pre i posle (telefon montiran)
      var hb = L.heelPre, ha = heelStat(win(t - 5000, t));
      if (hb && hb.ok && ha.ok) {
        if (L.leg === 'up' && strong(hb.mean) && !strong(ha.mean) && Math.abs(L.turnSum) >= 70) newLeg = 'down';
        if (L.leg === 'down' && strong(ha.mean) && !strong(hb.mean)) newLeg = 'up';
      }
    }
    if (newLeg !== L.leg) {
      var was = L.leg; L.leg = newLeg;
      if (L.turnPos) { if (newLeg === 'down') TAC.marks.top = { lat: L.turnPos.lat, lon: L.turnPos.lon, auto: true }; else TAC.marks.bottom = { lat: L.turnPos.lat, lon: L.turnPos.lon, auto: true }; }
      kind = newLeg === 'down' ? 'Bear-away (downwind)' : 'Round-up (upwind)';
      toast(newLeg === 'down' ? 'Detected: downwind' : 'Detected: upwind', newLeg === 'down' ? 'No, upwind' : 'No, downwind', function () { L.leg = was; renderLift(); }, 6000);
    } else if (before !== null && after !== null) {
      // učenje ose vetra iz halsa / gybe-a
      var diff = Math.abs(nrm(after - before)), mid = cmean([before, after]), ax = null;
      if (L.leg === 'up' && diff >= 60 && diff <= 130) { ax = mid; pushTA(diff); }
      if (L.leg === 'down' && diff >= 35 && diff <= 130) ax = (mid + 180) % 360;
      // velik skok ose iz jednog manevra je sumnjiv: pomeri samo do pola (sledeći hals potvrđuje)
      if (ax !== null) {
        var jump = L.axis === null ? 0 : Math.abs(nrm(ax - L.axis));
        if (jump < 60) { L.axis = L.axis === null ? ax : cmean([L.axis, ax]); L.axCand = null; }
        else if (L.axCand !== null && L.axCand !== undefined && Math.abs(nrm(ax - L.axCand)) < 30) { L.axis = cmean([L.axCand, ax]); L.axCand = null; } // dva puta zaredom potvrđeno
        else L.axCand = ax;
      }
    }
    L.side = sideFromAxis(after) || (newLeg === 'up' && L.heelPre && L.heelPre.ok && kind.indexOf('Round') === 0 ? sideFromHeel(heelStat(win(t - 5000, t)).mean) : null) || turnSide;
    L.note = kind;
  }

  function liftOnFix(hdg, kn, heel) {
    var t = now();
    L.hist.push({ t: t, hdg: hdg, sog: kn, heel: heel });
    while (L.hist.length && t - L.hist[0].t > 120000) L.hist.shift();
    learnTick(t);
    if (prestart() && LW.phase === 'off') { var la0 = startAxis(); if (la0 !== null) L.axis = la0; L.leg = cfg.startLeg || 'up'; if (L.axis !== null && hdg !== null) L.side = sideFromAxis(hdg); }
    // Timed: referenca tačno lockDelay s posle početka okreta (radi i kad GPS zastane)
    if (L.phase === 'accel' && cfg.liftMode === 'timed' && t - L.turnT >= cfg.lockDelay * 1000) {
      finishManeuver(t); L.lastT = t;
      var ht = hdgs(win(t - 3000, t)); lockRef('timed', ht.length ? cmean(ht) : S.hdg);
      renderLift(); return;
    }
    if (kn === null || kn < 1.0 || hdg === null) { renderLift(); return; }

    // 1) detekcija manevra: zbir promena kursa u zadnjih 20 s (od poslednjeg manevra)
    if (L.phase !== 'accel' && t - L.lastT > LP.COOLDOWN * 1000) {
      var from = Math.max(t - LP.TURN_WIN * 1000, L.lastT), w = win(from, t).filter(function (e) { return e.hdg !== null && e.sog !== null && e.sog >= 1; });
      var sum = 0; for (var i = 1; i < w.length; i++) sum += nrm(w[i].hdg - w[i - 1].hdg);
      if (Math.abs(sum) >= (L.leg === 'down' ? LP.TURN_DOWN : LP.TURN)) {
        // kurs PRE okreta: nikad ne gledaj pre prethodnog manevra (inače meša stari leg, npr. krmu pre round-up-a)
        var pre = win(Math.max(t - 40000, L.lastT + 3000), t - 6000);
        if (hdgs(pre).length < 3) pre = win(Math.max(t - 40000, L.lastT), t - 4000);
        var ph = hdgs(pre);
        L.v0 = avg(pre, 'sog'); L.heelBefore = avg(pre, 'heel'); L.heelPre = heelStat(pre); L.hdgBefore = ph.length ? cmean(ph) : null;
        if (L.phase === 'locked' && L.ref !== null && L.side) L.lastRef[L.side] = L.ref;
        L.turnDir = sum > 0 ? 1 : -1; L.turnSum = sum; L.turnT = t; L.lastT = t;
        var pf = S.fixBuf.filter(function (f) { return !f.dr; }); L.turnPos = pf.length ? { lat: pf[0].lat, lon: pf[0].lon } : (S.lastFix ? { lat: S.lastFix.lat, lon: S.lastFix.lon } : null);
        L.phase = 'accel'; L.ref = null; L.refSrc = null; L.note = '';
        buzz(80);
      }
    }
    // 2) ubrzavanje -> kraj faze: najkasnije HARD s posle okreta
    if (L.phase === 'accel' && cfg.liftMode !== 'timed') {
      var st = settledNow(t), since = (t - L.turnT) / 1000, quiet = turnQuiet(t);
      var speedOk = !L.v0 || L.v0 < 1.5 || (st.v !== null && st.v >= LP.SPEED_OK * L.v0);
      if ((since >= LP.MIN_ACC && quiet && (speedOk || st.plateau || since >= LP.SOFT)) || since >= LP.HARD) {
        finishManeuver(t); L.lastT = t; // sledeći manevar se traži tek posle ovog trenutka
        if (cfg.liftMode === 'smart') { var hl = hdgs(win(t - LP.LOCK_WIN * 1000, t)); lockRef('smart', hl.length ? cmean(hl) : S.hdg); }
        else L.phase = 'wait';
      }
    }
    // 3) prvi hals bez prethodnog manevra (smart): ~6 s mirnog kursa
    if (L.phase === 'idle' && cfg.liftMode === 'smart' && kn >= 1.5) {
      var h6 = hdgs(win(t - 6000, t));
      if (h6.length >= 5 && cstd(h6) < LP.HDG_STD && turnQuiet(t)) {
        if (!L.side) L.side = sideFromAxis(S.hdg) || (heelStat(win(t - 5000, t)).ok ? sideFromHeel(avg(win(t - 5000, t), 'heel')) : null);
        lockRef('smart', cmean(hdgs(win(t - LP.LOCK_WIN * 1000, t))));
      }
    }
    renderLift();
  }

  function manualRef() {
    var t = now(), hh = hdgs(win(t - 3000, t));
    var v = hh.length ? cmean(hh) : S.hdg;
    if (v === null || v === undefined) { toast('No heading yet (needs speed above 1 kn).'); return; }
    if (L.phase === 'accel') finishManeuver(t);
    if (!L.side) L.side = sideFromAxis(v) || (heelStat(win(t - 5000, t)).ok ? sideFromHeel(S.heel) : null);
    lockRef('manual', v); buzz(60);
    toast('Reference set: ' + ('00' + Math.round(v) % 360).slice(-3) + '°');
    renderLift();
  }
  $('liftBox').addEventListener('click', function (e) { if (e.target.id === 'legChip') return; manualRef(); });
  $('legChip').addEventListener('click', function (e) {
    e.stopPropagation(); L.leg = L.leg === 'up' ? 'down' : 'up'; renderLift();
  });

  /* ---------- LEARN WIND: dva uzvetrena borda po ~20 s ---------- */
  var LW = { phase: 'off', t0: 0, h1: null, v1: null, side1: null, res: store.get('learnWind', null) };
  var LW_DUR = 20000, LW_TIMEOUT = 240000;
  function learnStart() {
    if (LW.phase !== 'off') { LW.phase = 'off'; toast('Learn cancelled'); renderLearn(); return; }
    if (S.sog === null || S.sog < 1.5) { toast('Learn needs speed above 1.5 kn. Sail upwind first.'); return; }
    LW.phase = 'a'; LW.t0 = now(); LW.tStart = now(); buzz(60);
    toast('Learn: hold a steady upwind course for 20 s', null, null, 4000); renderLearn();
  }
  function learnTick(t) {
    if (LW.phase === 'off') return;
    if (t - LW.tStart > LW_TIMEOUT) { LW.phase = 'off'; toast('Learn timed out. Try again.'); renderLearn(); return; }
    var w = win(LW.t0, t).filter(function (e) { return e.hdg !== null && e.sog !== null; });
    var hs2 = w.map(function (e) { return e.hdg; });
    if (LW.phase === 'a' || LW.phase === 'b') {
      // borda mora biti mirna; ako se kurs mnogo menja, počni merenje iznova
      if (hs2.length >= 4 && cstd(hs2) > 8) { LW.t0 = t; return; }
      if (t - LW.t0 >= LW_DUR && hs2.length >= 10) {
        var h = cmean(hs2), v = avg(w, 'sog');
        if (LW.phase === 'a') { LW.h1 = h; LW.v1 = v; LW.phase = 'tack'; buzz(200); toast('Now TACK and hold the other upwind course', null, null, 5000); }
        else { learnFinish(h, v); }
        renderLearn();
      }
    } else if (LW.phase === 'tack') {
      var h3 = hdgs(win(t - 5000, t));
      if (h3.length >= 4 && cstd(h3) < 6 && Math.abs(nrm(cmean(h3) - LW.h1)) > 60) { LW.phase = 'b'; LW.t0 = t; renderLearn(); }
    }
  }
  function learnFinish(h2, v2) {
    var ta = Math.abs(nrm(h2 - LW.h1));
    LW.phase = 'off';
    if (ta < 60 || ta > 130) { toast('Tack angle ' + Math.round(ta) + '° looks wrong. Try again.', null, null, 5000); renderLearn(); return; }
    var axis = cmean([LW.h1, h2]), vAvg = (LW.v1 + v2) / 2, vmg = vAvg * Math.cos(toRad(ta / 2));
    L.axis = axis; L.leg = 'up'; pushTA(ta);
    var sideA = sideFromAxis(LW.h1), sideB = sideFromAxis(h2);
    L.lastRef[sideA] = LW.h1;
    L.side = sideB; lockRef('learn', h2); L.lastRef[sideB] = h2;
    LW.res = { axis: Math.round(axis), ta: Math.round(ta), vmg: +vmg.toFixed(2), v: +vAvg.toFixed(2), t: new Date().toISOString() };
    store.set('learnWind', LW.res); buzz(300);
    toast('Wind ~' + ('00' + LW.res.axis % 360).slice(-3) + '° · tack angle ' + LW.res.ta + '° · VMG ' + vmg.toFixed(1) + ' kn', null, null, 7000);
    renderLearn(); renderLift();
  }
  function renderLearn() {
    if (typeof LW === 'undefined' || !LW) return;
    var b = $('learnBtn'); if (!b) return;
    b.classList.toggle('on', LW.phase !== 'off');
    b.textContent = LW.phase === 'off' ? 'LEARN' : (LW.phase === 'tack' ? 'TACK!' : 'LEARN ' + Math.max(0, Math.ceil((LW_DUR - (now() - LW.t0)) / 1000)) + 's');
    var v = $('vmg');
    if (L.axis !== null && S.sog !== null && S.hdg !== null && S.sog > 0.8) {
      var rel = nrm(S.hdg - L.axis), vm = S.sog * Math.cos(toRad(rel));
      var ta = L.ta !== null ? ' · TA ' + Math.round(L.ta) + '°' : '';
      v.textContent = 'VMG ' + Math.abs(vm).toFixed(1) + ' kn · wind ~' + ('00' + Math.round(L.axis) % 360).slice(-3) + '°' + ta;
    } else v.textContent = '';
  }
  $('learnBtn').addEventListener('click', function (e) { e.stopPropagation(); learnStart(); });

  function renderLift() {
    renderLearn();
    var chip = $('legChip'), val = $('liftVal'), sub = $('liftSub');
    chip.textContent = L.leg === 'up' ? '▲ UPWIND' : '▼ DOWNWIND';
    var sideTxt = L.side === 'stbd' ? 'Starboard' : (L.side === 'port' ? 'Port' : 'Tack ?');
    var MN = { smart: 'AUTO', timed: 'AUTO', manual: 'MANUAL', learn: 'LEARN' };
    var modeTxt = (MN[L.refSrc || cfg.liftMode] || '').toUpperCase() + (cfg.liftMode === 'timed' && L.refSrc !== 'manual' ? ' ' + cfg.lockDelay + 's' : '');
    $('lockDelayBox').classList.toggle('hidden', cfg.liftMode !== 'timed');
    $('ldVal').textContent = cfg.lockDelay + ' s';
    val.className = 'lift-val';
    if (L.phase === 'accel') {
      val.classList.add('wait');
      if (cfg.liftMode === 'timed') { val.textContent = 'REF IN ' + Math.max(0, Math.ceil(cfg.lockDelay - (now() - L.turnT) / 1000)) + ' s'; sub.textContent = 'Timed reference · tap = set now'; }
      else if (cfg.liftMode === 'manual') { val.textContent = 'TAP'; sub.textContent = 'Maneuver · tap when settled on course'; }
      else { val.textContent = 'ACCELERATING…'; sub.textContent = 'Waiting for speed and heading to settle · tap = manual reference'; }
      return;
    }
    if (L.phase === 'locking') { val.textContent = 'LOCKING…'; val.classList.add('wait'); sub.textContent = (L.note ? L.note + ' · ' : '') + sideTxt; return; }
    if (L.ref === null || S.hdg === null) {
      val.textContent = 'TAP'; val.classList.add('wait');
      sub.textContent = (L.phase === 'wait' ? (L.note ? L.note + ' · ' : '') : '') + 'Tap to set reference · ' + modeTxt;
      return;
    }
    var tn = now(), rw = win(tn - 4000, tn).filter(function (e) { return e.hdg !== null; }), rs = 0;
    for (var ri = 1; ri < rw.length; ri++) rs += nrm(rw[ri].hdg - rw[ri - 1].hdg);
    if (Math.abs(rs) > 15) { val.textContent = 'MANEUVER…'; val.classList.add('wait'); sub.textContent = 'Heading changing fast'; return; }
    var d = nrm(S.hdg - L.ref);
    var refTxt = 'ref ' + ('00' + Math.round(L.ref) % 360).slice(-3) + '° · ' + sideTxt + ' · ' + modeTxt + (L.axis !== null ? ' · wind ~' + ('00' + Math.round(L.axis) % 360).slice(-3) + '°' : '');
    if (!L.side) {
      val.textContent = (d >= 0 ? '► ' : '◄ ') + Math.abs(Math.round(d)) + '°';
      sub.textContent = refTxt + ' · tack unknown';
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
      extra = ' · vs last time on this tack ' + (sh >= 0 ? '+' : '') + Math.round(sh) + '°';
    }
    sub.textContent = refTxt + extra;
  }

  // podešavanja lift/header
  function renderLmode() {
    document.querySelectorAll('[data-lmode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lmode') === cfg.liftMode); });
    $('lmodeInfo').textContent = cfg.liftMode === 'smart'
      ? 'Auto (default): after each maneuver the app sets the reference by itself once the boat is up to speed and the heading settles (max ~15 s). A tap sets your own reference and it stays until the next maneuver; then Auto takes over again.'
      : cfg.liftMode === 'timed'
        ? 'Auto timed: the reference is set a fixed time after each maneuver (' + cfg.lockDelay + ' s). Adjust with − / + on the SOG screen. A tap overrides until the next maneuver.'
        : 'Manual only: no automatic reference. After each maneuver, tap the Lift/Header field once you are settled on course.';
  }
  document.querySelectorAll('[data-lmode]').forEach(function (b) {
    b.addEventListener('click', function () { cfg.liftMode = b.getAttribute('data-lmode'); store.set('liftMode', cfg.liftMode); renderLmode(); renderLift(); });
  });
  function setDelay(d) { cfg.lockDelay = Math.max(3, Math.min(40, cfg.lockDelay + d)); store.set('lockDelay', cfg.lockDelay); renderLmode(); renderLift(); }
  $('ldMinus').addEventListener('click', function (e) { e.stopPropagation(); setDelay(-1); buzz(20); });
  $('ldPlus').addEventListener('click', function (e) { e.stopPropagation(); setDelay(1); buzz(20); });
  $('lockDelayBox').addEventListener('click', function (e) { e.stopPropagation(); });

  // Daljinski taster (Bluetooth okidač/tastatura): postavi referencu
  var REMOTE_KEYS = ['Enter', ' ', 'NumpadEnter', 'AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown', 'MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Camera'];
  document.addEventListener('keydown', function (e) {
    var k = e.key || e.code; if ($('lastKey')) $('lastKey').textContent = k + (e.code && e.code !== k ? ' (' + e.code + ')' : '');
    if (currentView !== 'race' || e.repeat || REMOTE_KEYS.indexOf(k) < 0) return;
    e.preventDefault(); manualRef();
  });
  if ('mediaSession' in navigator) {
    ['play', 'pause', 'nexttrack', 'previoustrack'].forEach(function (a) { try { navigator.mediaSession.setActionHandler(a, function () { if ($('lastKey')) $('lastKey').textContent = 'media: ' + a; if (currentView === 'race') manualRef(); }); } catch (e) {} });
  }
  // Zaštita od kapi vode: bez zumiranja i višeprstnih gestova
  document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchstart', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'dblclick'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false }); });
  var swipeLock = store.get('swipeLock', false);
  function renderSwipeLock() { document.body.classList.toggle('swipe-lock', swipeLock); $('lockBtn').textContent = swipeLock ? '🔒' : '🔓'; }
  $('lockBtn').addEventListener('click', function () { swipeLock = !swipeLock; store.set('swipeLock', swipeLock); renderSwipeLock(); toast(swipeLock ? 'Screen locked: only buttons work. Use ‹ › to change page.' : 'Screen unlocked: swipe to change page'); });
  $('pgPrev').addEventListener('click', function () { goPage(Math.max(0, pageIdx - 1)); });
  $('pgNext').addEventListener('click', function () { goPage(Math.min(pager.children.length - 1, pageIdx + 1)); });
  renderSwipeLock();

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
    S.sim = true; L.leg = 'up'; L.side = null; L.phase = 'idle'; L.ref = null; L.lastT = 0; L.hist = []; L.axis = null;
    var badge = document.createElement('div'); badge.className = 'sim-badge'; badge.id = 'simBadge'; badge.textContent = 'SIMULATION'; document.body.appendChild(badge);
    var pos = S.lastFix ? { lat: S.lastFix.lat, lon: S.lastFix.lon } : { lat: 44.785, lon: 20.40 };
    var k = 0, h = 45, n = function (a) { return (Math.random() - 0.5) * 2 * a; };
    show('race'); setTimeout(function () { goPage(1); }, 100);
    toast('Simulation: wind 000°, full course: beat with tacks and a lift, run with gybes, round-up', null, null, 5000);
    // [trajanje s, kurs, brzina kn, nagib]; okreti su linearni prelazi
    var plan = [[30, 45, 5, 12], [7, 315, 3.2, -12], [30, 315, 5, -12], [5, 323, 5, -12], [25, 323, 5, -12], [7, 45, 3.2, 12], [30, 45, 5, 12],
      [7, 315, 3.2, -12], [25, 315, 5, -12], [8, 160, 5.5, 2], [30, 160, 6, 2], [6, 205, 5, -2], [30, 205, 6, -2], [6, 160, 5, 2], [25, 160, 6, 2], [8, 45, 3.5, 12], [30, 45, 5, 12]];
    var seg = 0, segT = 0, fromH = 45, fromK = 5;
    simTimer = setInterval(function () {
      k++;
      var P = plan[seg], f = Math.min(1, (segT + 1) / P[0]);
      var dh = nrm(P[1] - fromH), turning = Math.abs(dh) > 20;
      h = (fromH + dh * f + 360) % 360;
      var kn = turning ? (f < 0.5 ? fromK - (fromK - P[2]) * f * 2 : P[2]) : fromK + (P[2] - fromK) * Math.min(1, (segT + 1) / 8);
      var heel = window.__looseHeel ? n(15) : P[3];
      segT++;
      if (segT >= P[0]) { fromH = P[1]; fromK = P[2]; seg++; segT = 0; }
      var hh = (h + n(1.5) + 360) % 360, kk = kn + n(0.08);
      var dm = kk / 1.943844;
      pos.lat += dm * Math.cos(toRad(hh)) / 111195; pos.lon += dm * Math.sin(toRad(hh)) / (111195 * Math.cos(toRad(pos.lat)));
      simFix(pos, hh, kk, heel + n(1));
      if (seg >= plan.length) stopSim();
    }, 1000);
  }
  function stopSim() {
    clearInterval(simTimer); simTimer = null; S.sim = false;
    var b = $('simBadge'); if (b) b.remove();
    toast('Simulation finished');
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
      T.state, T.state === 'count' ? Math.round((T.end - now()) / 1000) : '', S.sim ? 1 : 0, L.axis === null ? '' : Math.round(L.axis), FZ.on ? 1 : 0].join(','));
    if (LOG.rows.length % 15 === 0) store.set('log', LOG.rows);
    renderLog();
  }
  function renderLog() {
    $('logBtn').textContent = LOG.on ? 'Stop logging' : 'Start logging';
    $('logInfo').textContent = LOG.rows.length ? ('Logged ' + LOG.rows.length + ' s (~' + Math.round(LOG.rows.length / 60) + ' min).') : 'No log yet.';
  }
  $('logBtn').addEventListener('click', function () {
    if (!LOG.on && LOG.rows.length) {
      toast('An old log exists.', 'Delete & start new', function () { LOG.rows = []; LOG.on = true; store.set('log', []); renderLog(); }, 5000);
      return;
    }
    LOG.on = !LOG.on; store.set('log', LOG.rows); renderLog();
  });
  $('logExport').addEventListener('click', function () {
    if (!LOG.rows.length) { toast('No log yet.'); return; }
    var head = 'time,lat,lon,acc_m,sog_raw_kn,cog_raw,sog_kn,hdg,heel,lift_phase,leg,side,ref,lift_deg,timer_state,tts_s,sim,wind_axis,gps_hold';
    var blob = new Blob([head + '\n' + LOG.rows.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a'), d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = 'race-log-' + d.toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Saved to the phone Downloads folder');
  });
  renderLog();

  /* ---------- START LINIJA ---------- */
  // Konvencija: gledano u vetar iza linije, BOAT (komisijski brod) je desno, PIN levo.
  var line = { pin: store.get('pin', null), boat: store.get('boat', null) };
  var LINE_TOL = 3; // sekunde tolerancije za "na vreme"

  function recentFix() {
    // najsvežija tačka (bez usrednjavanja: u pokretu prosek kasni nekoliko metara)
    var t = now(), lastF = S.fixBuf.length ? S.fixBuf[S.fixBuf.length - 1] : null;
    if (lastF && t - lastF.rt < 2500 && (S.sog || 0) > 1) return { lat: lastF.lat, lon: lastF.lon, acc: lastF.acc };
    var buf = S.fixBuf.filter(function (f) { return t - f.rt < 3000; });
    if (!buf.length && S.fixBuf.length && t - S.fixBuf[S.fixBuf.length - 1].rt < 5000) buf = [S.fixBuf[S.fixBuf.length - 1]];
    if (!buf.length) return null;
    var la = 0, lo = 0, ac = 0;
    buf.forEach(function (f) { la += f.lat; lo += f.lon; ac += f.acc; });
    return { lat: la / buf.length, lon: lo / buf.length, acc: ac / buf.length };
  }
  function setPoint(which) {
    var f = recentFix();
    if (!f) { toast('No GPS signal. Wait and try again.'); return; }
    line[which] = { lat: f.lat, lon: f.lon, acc: f.acc, t: new Date().toISOString() };
    store.set(which, line[which]); buzz(150);
    var msg = (which === 'pin' ? 'PIN' : 'BOAT') + ' set (±' + Math.round(f.acc) + ' m)';
    if (f.acc > 15) msg += '. Weak GPS, redo when it improves.';
    toast(msg); renderLine();
  }
  function pointBtn(which, el) {
    el.addEventListener('click', function () {
      unlockAudio();
      setPoint(which); // svaki pritisak = nova pozicija, bez potvrde
    });
  }
  pointBtn('pin', $('pinBtn')); pointBtn('boat', $('boatBtn'));
  $('lineClear').addEventListener('click', function () {
    toast('Clear the start line?', 'Clear', function () {
      line.pin = null; line.boat = null; store.set('pin', null); store.set('boat', null); renderLine(); toast('Line cleared');
    }, 4000);
  });

  function xy(ref, p) {
    return { x: toRad(p.lon - ref.lon) * 6371000 * Math.cos(toRad(ref.lat)), y: toRad(p.lat - ref.lat) * 6371000 };
  }
  function lineCalc(pos) {
    var b = xy(line.pin, line.boat), x = xy(line.pin, pos);
    var L2 = b.x * b.x + b.y * b.y, L = Math.sqrt(L2);
    var t = L2 ? (x.x * b.x + x.y * b.y) / L2 : 0; // beskonačna linija kroz PIN i BOAT (kao Velocitek/Vakaros)
    var cx = b.x * t, cy = b.y * t;
    var dist = Math.sqrt((x.x - cx) * (x.x - cx) + (x.y - cy) * (x.y - cy));
    var cross = b.x * x.y - b.y * x.x; // > 0 = strana kursa (preko linije)
    return { len: L, dist: dist, over: cross > 0, nx: L ? -b.y / L : 0, ny: L ? b.x / L : 0 }; // n = normala ka strani kursa (uz vetar)
  }
  function favoredEnd() {
    if (!line.pin || !line.boat || typeof LW === 'undefined' || !LW || !LW.res || !LW.res.t || Date.now() - Date.parse(LW.res.t) > 1800000) return null;
    var la = lineAxis(), W = LW.res.axis; if (la === null || Math.abs(nrm(W - la)) > 45) return null;
    var b = xy(line.pin, line.boat), L = Math.sqrt(b.x * b.x + b.y * b.y); if (L < 10) return null;
    var d = b.x * Math.sin(toRad(W)) + b.y * Math.cos(toRad(W)); // > 0: BOAT je bliže vetru
    var deg = Math.asin(Math.max(-1, Math.min(1, d / L))) * 180 / Math.PI;
    if (Math.abs(d) < 2) return { end: 'even', txt: 'SQUARE LINE · wind ' + ('00' + Math.round(W) % 360).slice(-3) + '°' };
    return { end: d > 0 ? 'boat' : 'pin', txt: (d > 0 ? 'BOAT' : 'PIN') + ' FAVORED +' + Math.round(Math.abs(d)) + ' m · ' + Math.abs(deg).toFixed(0) + '°' };
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

    var el = $('dtl'), info = $('lineInfo'), cls = 'none', txt = '––', burnTxt = '';
    var lenTxt = 'line ' + Math.round(lineCalc(line.boat).len) + ' m';
    // povoljan kraj: samo uz svež LEARN vetar koji se slaže sa linijom (inače nemamo pravi pravac vetra)
    var fav = favoredEnd(); $('lineFav').textContent = fav ? fav.txt : ''; $('lineFav').className = 'line-fav' + (fav ? ' ' + fav.end : '');
    var last = S.fixBuf.length ? S.fixBuf[S.fixBuf.length - 1] : null;
    if (!last || now() - last.rt > 5000) {
      info.textContent = lenTxt + ' · no GPS signal';
    } else {
      var r = lineCalc(last);
      var tts = T.state === 'count' ? (T.end - now()) / 1000 : cfg.preset * 60;
      if (r.over) { cls = 'ocs'; txt = '−' + Math.round(r.dist); }
      else {
        txt = String(Math.round(r.dist));
        // brzina PRILAZA liniji = komponenta brzine upravna na liniju (zavisi od ugla kretanja)
        var v = (S.sog || 0) / 1.943844, vn = 0;
        if (S.hdg !== null && r.len > 0) vn = v * (Math.sin(toRad(S.hdg)) * r.nx + Math.cos(toRad(S.hdg)) * r.ny);
        var ttl = vn > 0.15 ? r.dist / vn : Infinity;
        var margin = ttl - tts;
        cls = margin > LINE_TOL ? 'late' : (margin < -LINE_TOL ? 'early' : 'ok');
        burnTxt = isFinite(margin) ? (margin >= 0 ? 'late ' : 'early ') + Math.abs(Math.round(margin)) + ' s · ' : 'not approaching · ';
      }
      info.textContent = (r.over ? 'OCS · ' : burnTxt) + lenTxt + ' · GPS ±' + Math.round(last.acc) + ' m';
    }
    el.textContent = txt;
    el.className = 'dtl ' + cls;
  }

  /* ---------- settings ---------- */
  var damp = $('damp');
  damp.value = cfg.damp;
  damp.addEventListener('input', function () { cfg.damp = +damp.value; store.set('damp', cfg.damp); renderSettings(); });
  $('ledMirror').checked = cfg.ledMirror;
  $('ledMirror').addEventListener('change', function (e) { cfg.ledMirror = e.target.checked; store.set('ledMirror', cfg.ledMirror); });
  $('heelStep').value = String(cfg.heelStep);
  $('heelStep').addEventListener('change', function (e) { cfg.heelStep = +e.target.value; store.set('heelStep', cfg.heelStep); });
  function renderSettings() {
    $('dampVal').textContent = cfg.damp + (cfg.damp === 0 ? ' (off)' : ' (≈' + TAU[cfg.damp] + ' s)');
    $('calInfo').textContent = cfg.calOffset === null ? 'No calibration set.'
      : 'Zero set ' + new Date(cfg.calTime).toLocaleString('en-GB') + ' (offset ' + cfg.calOffset.toFixed(1) + '°).';
  }
  function diagText() {
    return [
      'version: ' + APP_VERSION,
      'secure context (HTTPS): ' + (window.isSecureContext ? 'yes' : 'NO'),
      'device: ' + navigator.userAgent,
      '— GPS —',
      'location permission: ' + S.geoPerm,
      'GPS fixes: ' + S.fixes,
      'accuracy: ' + (S.acc === null ? '—' : Math.round(S.acc) + ' m'),
      'error: ' + (S.geoError || 'none'),
      '— sensors —',
      'motion permission: ' + S.motionPerm,
      'motion events: ' + S.motionEvents,
      'raw heel: ' + (S.rawHeel === null ? '—' : S.rawHeel.toFixed(1) + '°'),
      'heel after calibration: ' + (S.heel === null ? '—' : S.heel.toFixed(1) + '°'),
      '— other —',
      'screen wake lock: ' + S.wake,
      'damping: ' + cfg.damp
    ].join('\n');
  }
  function renderDiag() { $('diag').textContent = diagText(); }
  $('diagCopy').addEventListener('click', function () {
    var txt = diagText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('Copied. Paste it in the chat'); }, function () { toast('Copy failed. Select the text manually'); });
    } else toast('Select the text manually and copy');
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
  /* ---------- WEATHER ---------- */
  var WX = {
    spots: store.get('wxSpots', [{ id: 'ada', name: 'Ada Ciganlija', lat: 44.7872, lon: 20.3985 }]),
    spot: store.get('wxSpot', 'gps'), model: store.get('wxModel', 'best_match'),
    loading: false, last: store.get('wxCache', null)
  };
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function wxRenderSpots() {
    var sel = $('wxSpot'), html = '<option value="gps">📍 My location (GPS)</option>';
    WX.spots.forEach(function (s) { html += '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; });
    if (WX.tmp) html += '<option value="tmp">🔎 ' + esc(WX.tmp.name) + ' (not saved)</option>';
    sel.innerHTML = html;
    if (WX.spot === 'tmp' && !WX.tmp) WX.spot = 'gps';
    if (WX.spot !== 'gps' && WX.spot !== 'tmp' && !WX.spots.some(function (s) { return s.id === WX.spot; })) WX.spot = 'gps';
    sel.value = WX.spot; $('wxModel').value = WX.model;
    var canSave = WX.spot === 'gps' || WX.spot === 'tmp';
    $('wxDelSpot').classList.toggle('hidden', canSave);
    $('wxSpotName').classList.toggle('hidden', !canSave);
    $('wxSaveSpot').classList.toggle('hidden', !canSave);
  }
  function wxStatus(msg, err) { var el = $('wxStatus'); el.textContent = msg; el.classList.toggle('err', !!err); }
  function wxLocate() {
    return new Promise(function (res) {
      if (WX.spot === 'tmp' && WX.tmp) return res({ lat: WX.tmp.lat, lon: WX.tmp.lon, name: WX.tmp.name });
      if (WX.spot !== 'gps') { var s = WX.spots.filter(function (x) { return x.id === WX.spot; })[0]; return res({ lat: s.lat, lon: s.lon, name: s.name }); }
      var lf = S.fixBuf.length ? S.fixBuf[S.fixBuf.length - 1] : null;
      if (lf && now() - lf.rt < 5 * 60000) return res({ lat: lf.lat, lon: lf.lon, name: 'My location' });
      if (!('geolocation' in navigator)) return res(null);
      navigator.geolocation.getCurrentPosition(function (p) { res({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'My location' }); },
        function () { res(null); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });
  }
  function pick(h, name) {
    if (!h) return null;
    if (h[name]) return h[name];
    for (var k in h) if (k.indexOf(name + '_') === 0) return h[k];
    return null;
  }
  function wxFetch() {
    if (WX.loading) return;
    WX.loading = true; wxStatus('Loading forecast…');
    wxLocate().then(function (loc) {
      if (!loc) { WX.loading = false; wxStatus('Location not available. Allow location or pick a saved spot.', true); return; }
      var base = 'latitude=' + loc.lat.toFixed(4) + '&longitude=' + loc.lon.toFixed(4) + '&timezone=auto&forecast_hours=24';
      var fu = 'https://api.open-meteo.com/v1/forecast?' + base +
        '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation_probability,precipitation,weather_code&wind_speed_unit=kn' +
        (WX.model !== 'best_match' ? '&models=' + WX.model : '');
      var mu = 'https://marine-api.open-meteo.com/v1/marine?' + base +
        '&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,ocean_current_velocity,ocean_current_direction';
      var getJ = function (u) { return fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }); };
      Promise.all([getJ(fu), getJ(mu).catch(function () { return null; })]).then(function (res) {
        var f = res[0], m = res[1];
        if (!f || f.error || !f.hourly) throw new Error((f && f.reason) || 'no data');
        WX.last = { key: WX.spot + '|' + WX.model, loc: loc, model: WX.model, at: new Date().toISOString(), f: f, m: (m && !m.error) ? m : null };
        store.set('wxCache', WX.last);
        WX.loading = false; wxRender();
      }).catch(function (e) {
        WX.loading = false;
        wxStatus('Could not load forecast (' + e.message + ').' + (WX.last ? ' Showing last saved forecast.' : ''), true);
        if (WX.last) wxRender(true);
      });
    });
  }
  function arrow(dir) { return '<span class="wx-arrow" style="transform:rotate(' + Math.round((dir + 180) % 360) + 'deg)">↑</span>'; }
  function d3(v) { return ('00' + Math.round(v) % 360).slice(-3); }
  // padavine: samo 1–3 kapljice iznad temperature (slabo / umereno / jako)
  function rainTxt(p, mm) {
    var n = 0;
    if (mm !== null && mm !== undefined) n = mm >= 4 ? 3 : mm >= 1 ? 2 : mm >= 0.2 ? 1 : 0;
    else if (p !== null && p !== undefined) n = p >= 70 ? 2 : p >= 40 ? 1 : 0;
    return n ? '<span class="wx-drops">' + '💧'.repeat(n) + '</span>' : '';
  }
  window.RA_rainTxt = rainTxt;
  function wxRender(stale) {
    var L = WX.last; if (!L) return;
    var h = L.f.hourly, times = h.time || [];
    var ws = pick(h, 'wind_speed_10m') || [], wg = pick(h, 'wind_gusts_10m') || [], wd = pick(h, 'wind_direction_10m') || [];
    var tp = pick(h, 'temperature_2m') || [], pp = pick(h, 'precipitation_probability') || [], pr = pick(h, 'precipitation') || [];
    var mh = L.m && L.m.hourly ? L.m.hourly : null, mi = {};
    if (mh && mh.time) mh.time.forEach(function (t, i) { mi[t] = i; });
    var curU = L.m && L.m.hourly_units ? (L.m.hourly_units.ocean_current_velocity || 'km/h') : 'km/h';
    var toKn = curU.indexOf('km') === 0 ? 1 / 1.852 : (curU.indexOf('m/s') === 0 ? 1.943844 : 1);
    var hasSea = !!mh && ['wave_height', 'swell_wave_height', 'wind_wave_height', 'ocean_current_velocity'].some(function (k) {
      return (mh[k] || []).some(function (v) { return v !== null && v !== undefined; });
    });
    var modelName = $('wxModel').selectedOptions[0] ? $('wxModel').selectedOptions[0].textContent : L.model;
    wxStatus((stale ? 'Offline · ' : '') + esc(L.loc.name) + ' · ' + L.loc.lat.toFixed(3) + ', ' + L.loc.lon.toFixed(3) + ' · ' + modelName +
      ' · updated ' + new Date(L.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + (hasSea ? '' : ' · no sea data (inland)'));
    // NOW
    var i0 = 0, n = $('wxNow');
    if (ws[i0] !== undefined && ws[i0] !== null) {
      n.innerHTML =
        '<div class="wx-tile"><div class="lbl">Wind</div><div class="v">' + Math.round(ws[i0]) + '<small>kn</small></div></div>' +
        '<div class="wx-tile' + (wg[i0] >= 20 ? ' hot' : '') + '"><div class="lbl">Gusts</div><div class="v">' + Math.round(wg[i0]) + '<small>kn</small></div></div>' +
        '<div class="wx-tile"><div class="lbl">Direction</div><div class="v">' + d3(wd[i0]) + '°' + arrow(wd[i0]) + '</div></div>' +
        '<div class="wx-tile"><div class="lbl">Air</div><div class="v">' + (tp[i0] === null || tp[i0] === undefined ? '–' : Math.round(tp[i0])) + '<small>°C</small></div></div>';
      n.classList.remove('hidden');
    }
    var N = times.length;
    // TABLE
    var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var dayLbl = function (iso) { var d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
    var num = function (x) { return x === null || x === undefined ? '–' : Math.round(x); };
    var rows = '<div class="wx-day">' + dayLbl(times[0]) + '</div>' +
      '<div class="wx-row head"><span>TIME</span><span class="wx-wg-h"><span>WIND</span><span>GUST</span></span><span style="text-align:right">DIR</span><span style="text-align:right">°C / 💧</span></div>', prevDay = times[0].slice(0, 10);
    for (var i = 0; i < N; i++) {
      var day = times[i].slice(0, 10);
      if (day !== prevDay) { rows += '<div class="wx-day">' + dayLbl(times[i]) + '</div>'; prevDay = day; }
      var a = ws[i], gg = wg[i];
      var ratio = (a !== null && gg) ? Math.max(0.15, Math.min(0.85, a / gg)) : 0.5;
      rows += '<div class="wx-row"><span class="t">' + times[i].slice(11, 13) + ':00</span>' +
        '<span class="wx-wg" style="--r:' + Math.round(ratio * 100) + '%"><b>' + num(a) + '</b><b>' + num(gg) + '</b></span>' +
        '<span class="wx-dir">' + (wd[i] === null || wd[i] === undefined ? '–' : d3(wd[i]) + arrow(wd[i])) + '</span>' +
        '<span class="wx-misc">' + rainTxt(pp[i], pr[i]) + num(tp[i]) + '°</span>';
      if (hasSea && mi[times[i]] !== undefined) {
        var k = mi[times[i]], v = function (key) { var x = (mh[key] || [])[k]; return x === null || x === undefined ? null : x; }, parts = [];
        if (v('wave_height') !== null) parts.push('Waves <b>' + v('wave_height').toFixed(1) + ' m</b>' + (v('wave_period') !== null ? ' ' + Math.round(v('wave_period')) + 's' : ''));
        if (v('swell_wave_height') !== null) parts.push('Swell <b>' + v('swell_wave_height').toFixed(1) + ' m</b>' + (v('swell_wave_direction') !== null ? ' ' + d3(v('swell_wave_direction')) + '°' : '') + (v('swell_wave_period') !== null ? ' ' + Math.round(v('swell_wave_period')) + 's' : ''));
        if (v('wind_wave_height') !== null) parts.push('Chop <b>' + v('wind_wave_height').toFixed(1) + ' m</b>');
        if (v('ocean_current_velocity') !== null) parts.push('Current <b>' + (v('ocean_current_velocity') * toKn).toFixed(1) + ' kn</b>' + (v('ocean_current_direction') !== null ? ' → ' + d3(v('ocean_current_direction')) + '°' : ''));
        if (parts.length) rows += '<div class="wx-sea">' + parts.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
      }
      rows += '</div>';
    }
    $('wxTable').innerHTML = rows;
    wxSetView(WX.view);
  }
  WX.view = store.get('wxView', 'table');
  function wxMap() {
    if (WX.view !== 'map') return;
    var box = $('wxMap'), L = WX.last;
    var loc = L ? L.loc : null;
    if (!loc) { var sp = WX.spots[0]; loc = { lat: sp.lat, lon: sp.lon }; }
    if (!window.WindMap) { box.innerHTML = '<p class="small" style="padding:16px">Map module not loaded.</p>'; return; }
    WindMap.open(box, loc, WX.model, function (st, msg) {
      if (st === 'error') toast('Map wind data failed: ' + (msg || '')); 
    }).catch(function (e) { box.innerHTML = '<p class="small" style="padding:16px">Map needs internet (' + esc(e.message) + ').</p>'; });
  }
  function wxSetView(v) {
    WX.view = v; store.set('wxView', v);
    document.querySelectorAll('[data-wxv]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-wxv') === v); });
    $('wxMap').classList.toggle('hidden', v !== 'map');
    $('wxTableWrap').classList.toggle('hidden', v !== 'table');
    $('wxNow').classList.toggle('hidden', v !== 'table' || !WX.last);
    wxMap();
  }
  document.querySelectorAll('[data-wxv]').forEach(function (b) { b.addEventListener('click', function () { wxSetView(b.getAttribute('data-wxv')); }); });
  function wxOpen() {
    wxRenderSpots(); wxSetView(WX.view);
    if (WX.last && WX.last.key === WX.spot + '|' + WX.model) wxRender(true);
    wxFetch();
  }
  $('wxSpot').addEventListener('change', function (e) { WX.spot = e.target.value; if (WX.spot !== 'tmp') store.set('wxSpot', WX.spot); wxRenderSpots(); wxFetch(); });
  $('wxModel').addEventListener('change', function (e) { WX.model = e.target.value; store.set('wxModel', WX.model); wxFetch(); });
  $('wxRefresh').addEventListener('click', wxFetch);
  $('wxSaveSpot').addEventListener('click', function () {
    var name = $('wxSpotName').value.trim();
    var L = WX.last;
    if (!name) { toast('Type a name for this spot first.'); return; }
    var src = WX.spot === 'tmp' && WX.tmp ? WX.tmp : (L && L.key.indexOf('gps|') === 0 ? L.loc : null);
    if (!src) { toast('Load the forecast for your location first.'); return; }
    var id = 's' + now();
    WX.spots.push({ id: id, name: name, lat: src.lat, lon: src.lon });
    if (WX.spot === 'tmp') WX.tmp = null;
    store.set('wxSpots', WX.spots); WX.spot = id; store.set('wxSpot', id); $('wxSpotName').value = '';
    wxRenderSpots(); toast('Spot saved: ' + name); wxFetch();
  });
  // pretraga mesta (Open-Meteo geocoding) ili koordinate "45.52, 13.57"
  function wxFind() {
    var q = $('wxFind').value.trim(), box = $('wxFindRes'); if (!q) return;
    var m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) { wxShowFound([{ name: (+m[1]).toFixed(4) + ', ' + (+m[2]).toFixed(4), sub: 'Coordinates', lat: +m[1], lon: +m[2] }]); return; }
    box.innerHTML = '<p class="small">Searching…</p>';
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) {
      wxShowFound(((j && j.results) || []).map(function (g) { return { name: g.name, sub: [g.admin1, g.country].filter(Boolean).join(', '), lat: g.latitude, lon: g.longitude }; }));
    }).catch(function () { box.innerHTML = '<p class="small">No connection. Try again.</p>'; });
  }
  function wxShowFound(list) {
    var box = $('wxFindRes'); WX.found = list;
    box.innerHTML = list.length ? list.map(function (g, i) { return '<button data-found="' + i + '">' + esc(g.name) + '<span>' + esc(g.sub || '') + '</span></button>'; }).join('') : '<p class="small">Nothing found. Try a nearby town, or type coordinates like 45.52, 13.57.</p>';
  }
  $('wxFindGo').addEventListener('click', wxFind);
  $('wxFind').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); wxFind(); } });
  $('wxFindRes').addEventListener('click', function (e) {
    var b = e.target.closest('[data-found]'); if (!b) return;
    var g = WX.found[+b.getAttribute('data-found')], name = g.name.slice(0, 24);
    // samo prikaz; čuva se tek na Save spot
    var ex = WX.spots.filter(function (s) { return Math.abs(s.lat - g.lat) < 0.005 && Math.abs(s.lon - g.lon) < 0.005; })[0];
    if (ex) { WX.spot = ex.id; store.set('wxSpot', ex.id); }
    else { WX.tmp = { lat: g.lat, lon: g.lon, name: name }; WX.spot = 'tmp'; }
    $('wxFind').value = ''; $('wxFindRes').innerHTML = '';
    wxRenderSpots(); if (!ex) $('wxSpotName').value = name; wxFetch();
  });
  $('wxDelSpot').addEventListener('click', function () {
    var s = WX.spots.filter(function (x) { return x.id === WX.spot; })[0]; if (!s) return;
    toast('Delete ' + s.name + '?', 'Delete', function () {
      WX.spots = WX.spots.filter(function (x) { return x.id !== s.id; }); store.set('wxSpots', WX.spots);
      WX.spot = 'gps'; store.set('wxSpot', 'gps'); wxRenderSpots(); wxFetch();
    }, 4000);
  });

  window.RA = { tac: function () { return tacInfo(); }, setMark: function () { setMarkHere(); }, toast: toast, store: store, show: show };
  window.__ra = { S: S, T: T, L: L, FZ: FZ, LW: LW, cfg: cfg, calibrate: calibrate, show: show };
})();
