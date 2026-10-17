/* The Race App — RaceBox Mini / Mini S / Micro (GNSS 25 Hz + akcelerometar + žiroskop) preko Web Bluetooth-a.
   Protokol: RaceBox BLE Protocol rev 9 — Nordic UART servis, UBX okviri (B5 62 · klasa · ID · dužina · payload · CK_A CK_B),
   poruka podataka 0xFF 0x01 (80 B). Okviri mogu biti podeljeni na više notifikacija → bafer + provera checksum-a.
   Kad je povezan, RaceBox zamenjuje GPS telefona (5 Hz u aplikaciju; puna brzina ostaje dostupna za kasnije). */
(function () {
  'use strict';
  var UART = '6e400001-b5a3-f393-e0a9-e50e24dcca9e', RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e', TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  var S = { dev: null, rx: null, state: 'off', err: '', n: 0, bad: 0, last: null, at: 0, hz: 0, model: '', fw: '', bat: null, platform: null }, subs = [], buf = new Uint8Array(0), feedEvery = 5, cnt = 0, hzT = 0, hzN = 0;
  function emit() { subs.forEach(function (f) { try { f(S); } catch (e) {} }); }
  function cat(a, b) { var c = new Uint8Array(a.length + b.length); c.set(a, 0); c.set(b, a.length); return c; }
  function ck(arr, from, to) { var A = 0, B = 0; for (var i = from; i < to; i++) { A = (A + arr[i]) & 255; B = (B + A) & 255; } return [A, B]; }
  function packet(cls, id, payload) {
    payload = payload || []; var n = payload.length, p = new Uint8Array(8 + n);
    p[0] = 0xB5; p[1] = 0x62; p[2] = cls; p[3] = id; p[4] = n & 255; p[5] = n >> 8; p.set(payload, 6);
    var c = ck(p, 2, 6 + n); p[6 + n] = c[0]; p[7 + n] = c[1]; return p;
  }
  function parseData(dv) {
    var o = 6, u32 = function (k) { return dv.getUint32(o + k, true); }, i32 = function (k) { return dv.getInt32(o + k, true); }, i16 = function (k) { return dv.getInt16(o + k, true); };
    var y = dv.getUint16(o + 4, true), t = Date.UTC(y, dv.getUint8(o + 6) - 1, dv.getUint8(o + 7), dv.getUint8(o + 8), dv.getUint8(o + 9), dv.getUint8(o + 10)) + Math.round(i32(16) / 1e6);
    var fix = dv.getUint8(o + 20), ok = (dv.getUint8(o + 21) & 1) === 1 && fix === 3 && (dv.getUint8(o + 66) & 1) === 0;
    var gx = i16(68) / 1000, gy = i16(70) / 1000, gz = i16(72) / 1000, b = dv.getUint8(o + 67);
    return { t: t, ok: ok, fix: fix, sv: dv.getUint8(o + 23), lon: i32(24) / 1e7, lat: i32(28) / 1e7, hAcc: u32(40) / 1000, sog: i32(48) / 1000 * 1.943844, cog: i32(52) / 1e5, sAcc: u32(56) / 1000 * 1.943844, hdgAcc: u32(60) / 1e5,
      bat: b & 127, chg: !!(b & 128), g: [gx, gy, gz], rot: [i16(74) / 100, i16(76) / 100, i16(78) / 100],
      // nagib (roll) iz gravitacije, ako je uređaj montiran sa X ka pramcu: + = desno
      heel: Math.atan2(gy, gz) * 180 / Math.PI };
  }
  function onNotify(ev) {
    var v = new Uint8Array(ev.target.value.buffer.slice(ev.target.value.byteOffset, ev.target.value.byteOffset + ev.target.value.byteLength));
    buf = cat(buf, v);
    for (;;) {
      var s = -1; for (var i = 0; i + 1 < buf.length; i++) if (buf[i] === 0xB5 && buf[i + 1] === 0x62) { s = i; break; }
      if (s < 0) { buf = buf.length ? buf.slice(-1) : buf; return; }
      if (s > 0) buf = buf.slice(s);
      if (buf.length < 8) return;
      var len = buf[4] | (buf[5] << 8); if (len > 504) { buf = buf.slice(2); continue; }
      if (buf.length < 8 + len) return;
      var c = ck(buf, 2, 6 + len);
      if (c[0] !== buf[6 + len] || c[1] !== buf[7 + len]) { S.bad++; buf = buf.slice(2); continue; }
      var pk = buf.slice(0, 8 + len); buf = buf.slice(8 + len);
      handle(pk);
    }
  }
  function handle(pk) {
    var cls = pk[2], id = pk[3], dv = new DataView(pk.buffer);
    if (cls === 0xFF && id === 0x01 && pk.length >= 86) {
      var d = parseData(dv); S.last = d; S.n++; S.at = Date.now(); S.bat = d.bat;
      hzN++; if (S.at - hzT > 2000) { S.hz = Math.round(hzN * 1000 / (S.at - hzT)); hzN = 0; hzT = S.at; }
      if (d.ok && ++cnt % feedEvery === 0 && window.RA && window.RA.extFix) {
        window.RA.extFix({ timestamp: d.t, coords: { latitude: d.lat, longitude: d.lon, accuracy: d.hAcc, speed: d.sog / 1.943844, heading: d.sog > 0.5 ? d.cog : null } });
      }
      if (S.n % 5 === 0) emit();
    } else if (cls === 0xFF && id === 0x27 && pk.length >= 11) { S.platform = pk[6]; emit(); }
  }
  function send(p) { return S.rx ? S.rx.writeValueWithoutResponse ? S.rx.writeValueWithoutResponse(p) : S.rx.writeValue(p) : Promise.reject(new Error('not connected')); }
  function supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }
  function readStr(svc, uuid) { return svc.getCharacteristic(uuid).then(function (c) { return c.readValue(); }).then(function (v) { return new TextDecoder().decode(v); }).catch(function () { return ''; }); }
  function setup(srv) {
    srv.getPrimaryService(0x180A).then(function (di) { return Promise.all([readStr(di, 0x2A24), readStr(di, 0x2A26)]); }).then(function (r) { S.model = r[0]; S.fw = r[1]; emit(); }).catch(function () {});
    return srv.getPrimaryService(UART).then(function (svc) { return Promise.all([svc.getCharacteristic(RX), svc.getCharacteristic(TX)]); })
      .then(function (c) { S.rx = c[0]; c[1].addEventListener('characteristicvaluechanged', onNotify); return c[1].startNotifications(); })
      .then(function () { S.state = 'on'; hzT = Date.now(); emit(); send(packet(0xFF, 0x27, [])).catch(function () {}); });
  }
  function connect() {
    if (!supported()) { S.state = 'unsupported'; S.err = 'This browser has no Bluetooth. Use Chrome on Android.'; emit(); return Promise.resolve(); }
    S.state = 'connecting'; S.err = ''; emit();
    return navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'RaceBox' }], optionalServices: [UART, 0x180A] })
      .then(function (dev) { S.dev = dev; dev.addEventListener('gattserverdisconnected', function () { if (S.state === 'off') return; S.state = 'lost'; S.rx = null; emit(); setTimeout(reconnect, 2000); }); return dev.gatt.connect(); })
      .then(setup)
      .catch(function (e) { S.state = 'off'; S.err = e && e.message ? e.message : String(e); emit(); });
  }
  function reconnect() { if (!S.dev || S.state === 'off') return; S.state = 'connecting'; emit(); S.dev.gatt.connect().then(setup).catch(function () { S.state = 'lost'; emit(); setTimeout(reconnect, 5000); }); }
  function disconnect() { var d = S.dev; S.state = 'off'; S.dev = null; S.rx = null; buf = new Uint8Array(0); if (d && d.gatt.connected) d.gatt.disconnect(); emit(); }
  // brodski režim GNSS filtera (Dynamic Platform Model 5 = sea), ground speed, min. tačnost 3 m; čuva se u uređaju (FW 3.3+)
  function marine() { return send(packet(0xFF, 0x27, [5, 0, 3])).then(function () { setTimeout(function () { send(packet(0xFF, 0x27, [])).catch(function () {}); }, 400); }); }
  function active() { return S.state === 'on' && Date.now() - S.at < 2500 && S.last && S.last.ok; }
  window.RaceBox = { supported: supported, connect: connect, disconnect: disconnect, marine: marine, active: active, state: function () { return S; }, on: function (f) { subs.push(f); }, _packet: packet, _handle: handle, _notify: onNotify };
})();
