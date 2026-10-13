/* The Race App — Calypso Ultrasonic Portable (vetromer) preko Web Bluetooth-a (Chrome na Androidu).
   Protokol (Calypso "Ultrasonic Portable BLE"): servis 0x180D, karakteristika 0x2A39 (notify), 10 bajtova little-endian:
   brzina vetra uint16 (1/100 m/s), smer uint16 (°, prividni, u odnosu na oznaku na senzoru), baterija uint8 (×10 %),
   temperatura uint8 (−100 °C), roll uint8 (−90), pitch uint8 (−90), kompas uint16 (360 − vrednost).
   Pošto ovo testiramo prvi put, čuvamo i sirove bajtove (Settings → Wind sensor) da možemo da ispravimo čitanje. */
(function () {
  'use strict';
  var SVC = 0x180D, CHR = 0x2A39, RATE = 0xA001;
  var S = { dev: null, chr: null, state: 'off', aws: null, awa: null, bat: null, temp: null, at: 0, raw: '', n: 0, err: '' }, subs = [];
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) {} }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function emit() { subs.forEach(function (f) { try { f(S); } catch (e) {} }); }
  function hex(dv) { var a = []; for (var i = 0; i < dv.byteLength; i++) a.push(('0' + dv.getUint8(i).toString(16)).slice(-2)); return a.join(' '); }
  function onData(ev) {
    var dv = ev.target.value; S.raw = hex(dv); S.n++; S.at = Date.now();
    if (dv.byteLength >= 4) {
      var ms = dv.getUint16(0, true) / 100, dir = dv.getUint16(2, true), off = +sget('windOffset', 0) || 0;
      S.aws = ms * 1.943844; S.awa = nrm(dir + off);
      if (dv.byteLength >= 5) S.bat = dv.getUint8(4) * 10;
      if (dv.byteLength >= 6) S.temp = dv.getUint8(5) - 100;
    }
    emit();
  }
  function supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }
  function connect() {
    if (!supported()) { S.state = 'unsupported'; S.err = 'This browser has no Bluetooth. Use Chrome on Android.'; emit(); return Promise.resolve(); }
    S.state = 'connecting'; S.err = ''; emit();
    return navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'ULTRA' }, { namePrefix: 'Calypso' }, { namePrefix: 'CALYPSO' }, { services: [SVC] }], optionalServices: [SVC, 0x180A, 0x180F] })
      .then(function (dev) {
        S.dev = dev; sset('windDev', dev.name || '');
        dev.addEventListener('gattserverdisconnected', function () { S.state = 'lost'; S.chr = null; emit(); setTimeout(reconnect, 2000); });
        return dev.gatt.connect();
      })
      .then(function (srv) { return srv.getPrimaryService(SVC); })
      .then(function (svc) {
        // 4 Hz ako uređaj dozvoljava (nije obavezno)
        svc.getCharacteristic(RATE).then(function (c) { return c.writeValue(new Uint8Array([4])); }).catch(function () {});
        return svc.getCharacteristic(CHR);
      })
      .then(function (c) { S.chr = c; c.addEventListener('characteristicvaluechanged', onData); return c.startNotifications(); })
      .then(function () { S.state = 'on'; emit(); })
      .catch(function (e) { S.state = 'off'; S.err = e && e.message ? e.message : String(e); emit(); });
  }
  function reconnect() {
    if (!S.dev || S.state === 'off') return;
    S.state = 'connecting'; emit();
    S.dev.gatt.connect().then(function (srv) { return srv.getPrimaryService(SVC); }).then(function (svc) { return svc.getCharacteristic(CHR); })
      .then(function (c) { S.chr = c; c.addEventListener('characteristicvaluechanged', onData); return c.startNotifications(); })
      .then(function () { S.state = 'on'; emit(); })
      .catch(function () { S.state = 'lost'; emit(); setTimeout(reconnect, 5000); });
  }
  function disconnect() { var d = S.dev; S.state = 'off'; S.dev = null; S.chr = null; if (d && d.gatt.connected) d.gatt.disconnect(); emit(); }
  // sveže očitavanje (do 3 s staro)
  function now() { return S.state === 'on' && Date.now() - S.at < 3000 && S.aws !== null ? { aws: S.aws, awa: S.awa } : null; }
  // pravi vetar iz prividnog + brzine i kursa broda (brzina kroz vodu ≈ SOG, bez struje i zanošenja)
  function trueWind(aws, awa, bs, hdg) {
    if (aws === null || awa === null || bs === null || bs === undefined) return null;
    var a = awa * Math.PI / 180, x = aws * Math.cos(a) - bs, y = aws * Math.sin(a), tws = Math.hypot(x, y), twa = Math.atan2(y, x) * 180 / Math.PI;
    return { tws: tws, twa: twa, twd: hdg === null || hdg === undefined ? null : ((hdg + twa) % 360 + 360) % 360 };
  }
  window.Calypso = { supported: supported, connect: connect, disconnect: disconnect, state: function () { return S; }, now: now, trueWind: trueWind, on: function (f) { subs.push(f); } };
})();
