/* The Race App — kamera telefona sinhronizovana sa telemetrijom.
   Režimi (Settings → Camera): "clips" = čuva samo ~10 s pre i posle svakog manevra, "all" = sve dok je kamera uključena.
   Snimak se deli na samostalne delove od 5 s (MediaRecorder se restartuje), svaki deo ima tačno vreme početka/kraja (Date.now),
   pa se u Debrief replay-u video poklapa sa brzinom, kursom i položajem u istom trenutku.
   U "clips" režimu poslednjih ~30 s stoji samo u memoriji; na manevar se čuva prozor [kraj manevra − 25 s, kraj + 10 s].
   Kamera radi samo dok je aplikacija na ekranu (Racing mode drži ekran upaljen); gasi se sama kad se zaustavi tracking. */
(function () {
  'use strict';
  var SEG = 5000, RING = 7, PRE = 25000, POST = 10000;
  var S = { on: false, stream: null, rec: null, seg: null, ring: [], keep: [], clip: null, seq: 0, parts: 0, err: '', mime: '' }, subs = [];
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function emit() { subs.forEach(function (f) { try { f(S); } catch (e) {} }); }
  function mode() { return sget('camMode', 'clips') === 'all' ? 'all' : 'clips'; }
  function facing() { return sget('camFacing', 'user') === 'environment' ? 'environment' : 'user'; }

  /* ---- IndexedDB: delovi snimka ---- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) { var r = indexedDB.open('raVideo', 1); r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('parts')) { var s = d.createObjectStore('parts', { keyPath: 'id' }); s.createIndex('t0', 't0'); } }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
    return dbp;
  }
  function put(p) { return db().then(function (d) { return new Promise(function (res) { var tx = d.transaction('parts', 'readwrite'); tx.objectStore('parts').put(p); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; }); }); }
  function all() { return db().then(function (d) { return new Promise(function (res) { var g = d.transaction('parts', 'readonly').objectStore('parts').getAll(); g.onsuccess = function () { res(g.result || []); }; g.onerror = function () { res([]); }; }); }).catch(function () { return []; }); }
  function inRange(a, b) { return all().then(function (P) { return P.filter(function (p) { return p.t1 >= a && p.t0 <= b; }).sort(function (x, y) { return x.t0 - y.t0; }); }); }
  function clearAll() { return db().then(function (d) { return new Promise(function (res) { var tx = d.transaction('parts', 'readwrite'); tx.objectStore('parts').clear(); tx.oncomplete = function () { res(); }; }); }); }

  /* ---- snimanje ---- */
  function pickMime() { var c = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']; for (var i = 0; i < c.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i]; return ''; }
  function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function newSeg() {
    if (!S.on || !S.stream) return;
    var chunks = [], t0 = Date.now(), r;
    try { r = new MediaRecorder(S.stream, S.mime ? { mimeType: S.mime, videoBitsPerSecond: 2000000 } : { videoBitsPerSecond: 2000000 }); } catch (e) { S.err = e.message; stop(); return; }
    r.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    r.onstop = function () { var t1 = Date.now(), blob = new Blob(chunks, { type: S.mime || 'video/webm' }); done({ t0: t0, t1: t1, blob: blob }); };
    r.onstart = function () { t0 = Date.now(); };
    S.rec = r; r.start();
    S.segT = setTimeout(function () { if (r.state !== 'inactive') r.stop(); newSeg(); }, SEG);
  }
  function save(seg) {
    if (seg.saved) return; seg.saved = true; S.parts++;
    put({ id: 'v' + seg.t0 + '_' + Math.random().toString(36).slice(2, 6), t0: seg.t0, t1: seg.t1, mode: mode(), mime: S.mime, size: seg.blob.size, blob: seg.blob }); emit();
  }
  function wanted(seg) { return S.keep.some(function (w) { return seg.t1 >= w[0] && seg.t0 <= w[1]; }); }
  function done(seg) {
    if (mode() === 'all') { save(seg); return; }
    S.ring.push(seg); while (S.ring.length > RING) S.ring.shift();
    if (wanted(seg)) save(seg);
    var now = Date.now(); S.keep = S.keep.filter(function (w) { return w[1] > now - SEG; });
  }
  // manevar završen u trenutku t: sačuvaj ono što je već u memoriji i nastavi do t + 10 s
  function onManeuver(t) {
    if (!S.on || mode() !== 'clips') return;
    var w = [t - PRE, t + POST]; S.keep.push(w);
    S.ring.forEach(function (seg) { if (seg.t1 >= w[0] && seg.t0 <= w[1]) save(seg); });
    S.clips = (S.clips || 0) + 1; emit();
  }
  function start() {
    if (S.on) return Promise.resolve();
    if (!supported()) { S.err = 'This browser cannot record video.'; emit(); return Promise.resolve(); }
    S.err = '';
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: facing(), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false })
      .then(function (st) { S.stream = st; S.mime = pickMime(); S.on = true; S.ring = []; S.keep = []; S.parts = 0; S.clips = 0; S.t = Date.now(); newSeg(); emit(); })
      .catch(function (e) { S.err = e && e.name === 'NotAllowedError' ? 'Camera permission denied.' : (e && e.message) || String(e); emit(); });
  }
  function stop() {
    clearTimeout(S.segT); S.on = false;
    try { if (S.rec && S.rec.state !== 'inactive') S.rec.stop(); } catch (e) {}
    if (S.stream) S.stream.getTracks().forEach(function (tr) { tr.stop(); });
    S.stream = null; S.rec = null; emit();
  }
  // telefon u pozadini / ekran ugašen: kamera staje; kad se vrati, nastavlja
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.on) { S.paused = true; stop(); }
    else if (!document.hidden && S.paused) { S.paused = false; start(); }
  });
  window.addEventListener('ra:maneuver', function (e) { onManeuver(e.detail && e.detail.t || Date.now()); });
  window.addEventListener('ra:trackstop', function () { if (S.on || S.paused) { S.paused = false; stop(); if (window.RA && window.RA.toast) window.RA.toast('Tracking stopped: camera off'); } });

  /* ---- reprodukcija uz replay (Debrief) ---- */
  var V = { el: null, box: null, parts: [], cur: null, url: null };
  function attach(box, a, b) {
    V.box = box; V.parts = []; V.cur = null; if (V.url) { URL.revokeObjectURL(V.url); V.url = null; }
    box.innerHTML = '<video playsinline muted></video><span class="cv-tag">VIDEO</span>'; V.el = box.querySelector('video'); box.hidden = true;
    return inRange(a, b).then(function (P) { V.parts = P; return P.length; });
  }
  function sync(t, playing, speed) {
    if (!V.el || !V.parts.length) return;
    var p = null; for (var i = 0; i < V.parts.length; i++) if (t >= V.parts[i].t0 && t <= V.parts[i].t1) { p = V.parts[i]; break; }
    if (!p) { V.box.hidden = true; if (!V.el.paused) V.el.pause(); return; }
    V.box.hidden = false;
    var off = (t - p.t0) / 1000;
    if (V.cur !== p.id) { if (V.url) URL.revokeObjectURL(V.url); V.url = URL.createObjectURL(p.blob); V.cur = p.id; V.el.src = V.url; V.el.currentTime = off; }
    if (playing && speed === 1) { if (Math.abs(V.el.currentTime - off) > 0.6) V.el.currentTime = off; if (V.el.paused) V.el.play().catch(function () {}); }
    else { if (!V.el.paused) V.el.pause(); if (Math.abs(V.el.currentTime - off) > 0.15) V.el.currentTime = off; }
  }
  function stats() { return all().then(function (P) { return { n: P.length, mb: P.reduce(function (s, p) { return s + (p.size || 0); }, 0) / 1048576, min: P.reduce(function (s, p) { return s + (p.t1 - p.t0); }, 0) / 60000 }; }); }

  window.CamRec = { supported: supported, start: start, stop: stop, toggle: function () { return S.on ? (stop(), Promise.resolve()) : start(); }, state: function () { return S; }, on: function (f) { subs.push(f); }, maneuver: onManeuver, attach: attach, sync: sync, stats: stats, clear: clearAll, _all: all };
})();
