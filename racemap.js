/* The Race App — RACE MAP: navigacione trke. Ruta (waypointi, strana obilaska) pripada eventu sa NoR / SI strane.
   Dokumenti se uploaduju na NoR / SI kao i do sada; ovde se samo povezuju. Waypointi: ručni unos / izmena
   (i kasnije AI čitanje iz SI-ja). Na vodi: sledeća tačka, smer, razdaljina, VMC, ETA, strana obilaska, auto-prelazak. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) {} }
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function rad(d) { return d * Math.PI / 180; }
  function d3(v) { return ('00' + Math.round(((v % 360) + 360) % 360)).slice(-3); }
  function nrm(d) { return ((d % 360) + 540) % 360 - 180; }
  function distNm(a, b) { var R = 3440.065, la1 = rad(a.lat), la2 = rad(b.lat), dla = la2 - la1, dlo = rad(b.lon - a.lon), h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) * Math.sin(dlo / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function brg(a, b) { var la1 = rad(a.lat), la2 = rad(b.lat), dlo = rad(b.lon - a.lon), y = Math.sin(dlo) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function fmtLL(v, pos, neg) { var a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60; return d + '°' + (m < 10 ? '0' : '') + m.toFixed(3) + '′' + (v >= 0 ? pos : neg); }

  /* ---- koordinate: 45.123456 · 45 7.407 N · 45°07.407'N · 45°07'24.4"N · N45 07.407 · i par "lat, lon" ---- */
  function parseOne(s, isLon) {
    s = String(s || '').trim().toUpperCase().replace(/,/g, '.'); if (!s) return null;
    var hemi = (s.match(/[NSEW]/) || [null])[0]; s = s.replace(/[NSEW]/g, ' ');
    var nums = s.replace(/[°º'′"″]/g, ' ').trim().split(/\s+/).map(parseFloat).filter(function (x) { return !isNaN(x); });
    if (!nums.length) return null;
    var v = Math.abs(nums[0]) + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600; if (nums[0] < 0) v = -v;
    if (hemi === 'S' || hemi === 'W') v = -Math.abs(v);
    if (isLon ? Math.abs(v) > 180 : Math.abs(v) > 90) return null;
    return v;
  }
  function parsePair(s) {
    s = String(s || '').trim(); if (!s) return null;
    var m = s.toUpperCase().match(/^(.*?[NS])\s*[,;\s]\s*(.*[EW])$/) || s.toUpperCase().match(/^([NS].*?)\s*[,;\s]\s*([EW].*)$/);
    if (m) { var a = parseOne(m[1], false), b = parseOne(m[2], true); return a !== null && b !== null ? { lat: a, lon: b } : null; }
    var p = s.split(/\s*[;,]\s*|\s+(?=-?\d+\.\d+$)/); if (p.length === 2) { var x = parseOne(p[0], false), y = parseOne(p[1], true); return x !== null && y !== null ? { lat: x, lon: y } : null; }
    return null;
  }

  /* ---- event i ruta ---- */
  function events() { return sget('norEvents', []); }
  // Race Map koristi samo event koji korisnik sam poveže (ne prati automatski izabrani event sa NoR / SI)
  function curEv() { var id = sget('rmEv', null); return id ? events().filter(function (x) { return x.id === id; })[0] || null : null; }
  function saveEv(ev) { sset('norEvents', events().map(function (x) { return x.id === ev.id ? ev : x; })); }
  // više staza po eventu (po klasama); aktivna staza = ev.courses[ev.ci]
  function route(ev) {
    if (!ev.courses) { ev.courses = [Object.assign({ name: 'Course', wps: [], k: 0, r: 50 }, ev.route || {})]; delete ev.route; ev.ci = 0; }
    if (!ev.courses.length) ev.courses.push({ name: 'Course', wps: [], k: 0, r: 50 });
    ev.ci = Math.max(0, Math.min(ev.courses.length - 1, ev.ci || 0)); return ev.courses[ev.ci];
  }
  function has(p) { return p && p.lat !== null && p.lat !== undefined && p.lon !== null && p.lon !== undefined; }
  /* ---- uvoz staze iz teksta SI-ja: red po tački, "Ime (STBD) 44.01, 15.17" / "Ime (PORT)" / Start / Finish ---- */
  function parseCourse(txt) {
    var out = [];
    String(txt || '').split(/\r?\n/).forEach(function (l) {
      l = l.replace(/\s+/g, ' ').trim(); if (!l) return;
      var side = /\((?:STBD|STARBOARD|S|DESNO)\)|\bSTBD\b|\bSTARBOARD\b/i.test(l) ? 'S' : /\((?:PORT|P|LIJEVO|LEVO)\)|\bPORT\b/i.test(l) ? 'P' : '';
      var rest = l.replace(/\((?:STBD|STARBOARD|PORT|S|P|DESNO|LIJEVO|LEVO)\)/ig, ' ').replace(/\b(?:STBD|STARBOARD|PORT)\b/ig, ' ').trim();
      var ll = null, m = rest.match(/(-?\d{1,2}[.,]\d+)\s*[,;]?\s+(-?\d{1,3}[.,]\d+)\s*$/);
      if (m) { ll = { lat: parseFloat(m[1].replace(',', '.')), lon: parseFloat(m[2].replace(',', '.')) }; rest = rest.slice(0, m.index).trim(); }
      else { var m2 = rest.match(/([NS]?\s*\d{1,2}[°\s]+\d{1,2}[.,]\d+.*)$/i); if (m2) { var q = parsePair(m2[1]); if (q) { ll = q; rest = rest.slice(0, m2.index).trim(); } } }
      var name = rest.replace(/^\(NEW\)\s*/i, '').replace(/[,;:]+$/, '').trim(); if (!name || /^(race course|list of|start\s*&)/i.test(name)) return;
      var type = /^start\b/i.test(name) ? 'start' : /^finish\b|^cilj\b/i.test(name) ? 'finish' : 'mark';
      out.push({ name: name, lat: ll ? ll.lat : null, lon: ll ? ll.lon : null, side: type === 'mark' ? side : '', type: type });
    });
    return out;
  }
  // staze iz SI-ja koje smo već pročitali (The Challenge 2026, Jezera / Murter); tačke bez koordinata dopunjava korisnik
  // Attachment A SI-ja (lista dostupnih waypointa sa koordinatama)
  var LIB_CHALLENGE = 'A Korotan island 43.89193, 15.18491\nB Taljurić island 43.86417, 15.19362\nC Sestrica vela (Tajer lighthouse) 43.85311, 15.20514\nD Lavdara mala island 43.91681, 15.23008\nE Balabra mala island 43.94664, 15.27964\nE1 Hrid Galiolica 43.87713, 15.37027\nE2 Brusnjak island 43.80050, 15.37130\nF Gustac island 43.74699, 15.38266\nG Gangaro island 43.86710, 15.43756\nG1 South point of Opat 43.73378, 15.45922\nH Gira island 43.82736, 15.50128\nI Veli Žavinac island 43.89164, 15.52362\nJ Vela Artica Island 43.86605, 15.52728\nK Mrtovnjak island 43.70696, 15.53498\nL Hrid Čavlin (isolated danger) 43.74080, 15.55772\nM Hrid Mišine 43.81224, 15.56471\nN Blitvenica island (lighthouse) 43.62495, 15.57461\nO Hrid Mala Mare 43.71326, 15.63433\nP Greben Bačvica (isolated danger) 43.74815, 15.70271\nQ Mažirina island 43.62719, 15.74008\nR Ravan island 43.66029, 15.74318\nS Logorun island 43.74230, 15.75052\nS1 Otok Sokol 43.66421, 15.78769\nT Plič Sestre (isolated danger) 43.68443, 15.81104\nU Dugo island 43.64551, 15.81817\nV Komorica island 43.64903, 15.84005\nV1 Zlarin island 43.69735, 15.83768\nW Lukovnjak island 43.57687, 15.87149\nX Tmara island 43.63104, 15.90022\nY Hrid Mulo (lighthouse) 43.51438, 15.91867\nZ Isolated danger NW of Iž 44.08914, 15.04220';
  var TEMPLATES = [
    { name: 'The Challenge 2026 · First 18 / Seascape 18', cls: ['seascape18'], lib: LIB_CHALLENGE, txt: 'Start\nWP 2 (on the course map, not named in the SI)\nZ isolated danger NW of Iž (STBD)\nOtočič Mrtovnjak (STBD) 44.010643, 15.175301\nOtočič Krknata (PORT) 43.966763, 15.138605\nD Lavdara mala island (PORT)\nE Balabra mala island (STBD)\nFinish' },
    { name: 'The Challenge 2026 · First 24 / Seascape 24', cls: ['seascape24'], lib: LIB_CHALLENGE, txt: 'Start\nWP 2 (on the course map, not named in the SI)\nZ isolated danger NW of Iž (STBD)\nOtočič Mrtovnjak (STBD) 44.010643, 15.175301\nOtočič Krknata (PORT) 43.966763, 15.138605\nD Lavdara mala island (PORT)\nE Balabra mala island (STBD)\nFinish' },
    { name: 'The Challenge 2026 · First 27 / Seascape 27', cls: ['seascape27'], lib: LIB_CHALLENGE, txt: 'Start\nWP 2 (on the course map, not named in the SI)\nM Hrid Mišine (PORT)\nE2 Brusnjak island (STBD)\nE1 Hrid Galiolica (PORT)\nZ isolated danger NW of Iž (STBD)\nOtočič Mrtovnjak (STBD) 44.010643, 15.175301\nOtočič Krknata (PORT) 43.966763, 15.138605\nD Lavdara mala island (PORT)\nE Balabra mala island (STBD)\nO Hrid Mala Mare (STBD)\nK Mrtovnjak island (STBD)\nFinish' }
  ];
  function myCls() { return sget('boatClass', ''); }
  // lista waypointa: "ID Ime lat, lon" (oznaka 1–2 znaka, npr. D, E1, S1)
  function parseLib(txt) {
    var L = {};
    String(txt || '').split(/\r?\n/).forEach(function (l) {
      var m = l.trim().match(/^([A-Z][0-9]?)\s+(.+?)\s+(-?\d{1,2}\.\d{3,})\s*[,;]?\s+(-?\d{1,3}\.\d{3,})/); if (!m) return;
      L[m[1]] = { name: m[2].trim(), lat: parseFloat(m[3]), lon: parseFloat(m[4]) };
    });
    return L;
  }
  // tačke staze bez koordinata dobijaju ih iz liste po oznaci (prva reč imena: "D Lavdara mala island" → D)
  function fillFromLib(list, L) {
    var n = 0; list.forEach(function (p) { if (has(p) || p.type !== 'mark') return; var code = (p.name.match(/^([A-Z][0-9]?)\s/) || [])[1]; var q = code && L[code]; if (!q) { var nm = p.name.toLowerCase(); Object.keys(L).forEach(function (k) { if (!q && L[k].name.toLowerCase() === nm) q = L[k]; }); } if (q) { p.lat = q.lat; p.lon = q.lon; n++; } }); return n;
  }
  // iz SI-ja sa više staza ("Race course First 18 SE / Seascape 18 class ...") uzmi samo stazu moje klase
  var CLS_RE = { seascape18: /\b18\b/, seascape24: /\b24\b/, seascape27: /\b27\b/ };
  function pickSection(txt, cls) {
    var parts = String(txt || '').split(/(?=^\s*Race course\b)/im); if (parts.length < 2 || !CLS_RE[cls]) return txt;
    // zaglavlja koja stoje jedno ispod drugog dele istu listu tačaka
    var hit = null; for (var i = 0; i < parts.length; i++) { var head = parts[i].split(/\r?\n/)[0]; if (/^\s*Race course/i.test(head) && CLS_RE[cls].test(head)) { hit = i; break; } }
    if (hit === null) return txt;
    for (var j = hit; j < parts.length; j++) { var body = parts[j].split(/\r?\n/).slice(1).join('\n'); if (/\S/.test(body.replace(/^\s*Race course.*$/gim, ''))) return body; }
    return txt;
  }
  var S = { map: null, ready: false, edit: false, timer: null, boat: null, near: false, minD: null, close: null, paste: false, rep: null };

  function docsOf(ev) {
    return new Promise(function (res) {
      try { var rq = indexedDB.open('raNor', 1); rq.onupgradeneeded = function () { rq.result.createObjectStore('docs', { keyPath: 'id' }); }; rq.onsuccess = function () { try { var db = rq.result, tx = db.transaction('docs', 'readonly'), st = tx.objectStore('docs'), g = st.getAll(); g.onsuccess = function () { res((g.result || []).filter(function (d) { return d.eventId === ev.id && d.kind !== 'diagram'; })); }; g.onerror = function () { res([]); }; } catch (e) { res([]); } }; rq.onerror = function () { res([]); }; } catch (e) { res([]); }
    });
  }

  function render() {
    var box = $('rmBody'); if (!box) return;
    var ev = curEv();
    if (!ev) {
      var E = events().slice().sort(function (a, b) { return String(b.dateFrom || '').localeCompare(String(a.dateFrom || '')); });
      box.innerHTML = '<div class="nor-empty"><h2>RACE MAP</h2><p>For distance races with waypoints. Add the event and its NoR / SI on the <b>NOR / SI</b> page, then link it here.</p>' +
        (E.length ? '<div class="row rm-link"><select id="rmPick">' + E.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc((x.summary && x.summary.event) || x.name) + (x.dateFrom ? ' · ' + x.dateFrom : '') + '</option>'; }).join('') + '</select><button class="btn primary" id="rmLink">Link event</button></div>' : '') + '</div>';
      return;
    }
    var R = route(ev), w = R.wps;
    var h = '<div class="nor-title"><b>RACE MAP</b><span>' + esc((ev.summary && ev.summary.event) || ev.name) + ' <button class="btn sm" id="rmUnlink">Change</button></span></div>';
    h += '<div class="rm-docs" id="rmDocs"><span class="small">Documents from this event…</span></div>';
    h += '<div class="row rm-cs"><select id="rmCourse">' + ev.courses.map(function (c, i) { return '<option value="' + i + '"' + (i === ev.ci ? ' selected' : '') + '>' + esc(c.name) + ' (' + c.wps.length + ')</option>'; }).join('') + '</select><button class="btn sm" id="rmPasteBtn">+ Course</button></div>';
    if (S.paste) h += '<div class="rm-paste"><input id="rmCName" placeholder="Course name (e.g. First 18 / 24)"><textarea id="rmPasteTxt" rows="7" placeholder="Paste the course list from the SI (only your class is used), one point per line:\nStart\nZ isolated danger NW of Iž (STBD)\nOtočič Mrtovnjak (STBD) 44.010643, 15.175301\n…\nFinish"></textarea>' +
      '<div class="row"><select id="rmTpl"><option value="">…or a course we already read</option>' + (function () { var c = myCls(), mine = [], oth = []; TEMPLATES.forEach(function (t, i) { (c && t.cls.indexOf(c) >= 0 ? mine : oth).push('<option value="' + i + '">' + esc(t.name) + '</option>'); }); return (mine.length ? '<optgroup label="Your class">' + mine.join('') + '</optgroup>' : '') + (oth.length ? '<optgroup label="Other classes">' + oth.join('') + '</optgroup>' : ''); })() + '</select></div><div class="row"><button class="btn primary" id="rmImport">Create course</button><button class="btn" id="rmPasteX">Cancel</button>' + (ev.courses.length > 1 || w.length ? '<button class="btn danger" id="rmCDel">Delete this course</button>' : '') + '</div><p class="small" id="rmPMsg">Points without coordinates (natural marks named in the SI) are marked orange: add their coordinates from the NoR list of waypoints or by tapping the map.</p></div>';
    if (w.length) {
      h += '<div class="rm-nav" id="rmNav"></div>';
      if (w.some(has)) h += '<div class="rm-map" id="rmMap"></div>';
    } else h += '<p class="small">No waypoints yet. Add them below (from the SI), or read them from the SI when AI reading is ready.</p>';
    h += '<div class="rm-sec"><div class="rm-head"><h3>ROUTE · ' + w.length + ' point' + (w.length === 1 ? '' : 's') + '</h3><button class="btn sm" id="rmEdit">' + (S.edit ? 'Done' : 'Edit') + '</button></div>';
    h += w.map(function (p, i) {
      var side = p.side === 'P' ? '<b class="rm-side p">PORT</b>' : p.side === 'S' ? '<b class="rm-side s">STBD</b>' : '<b class="rm-side">PASS</b>';
      if (!S.edit) return '<div class="rm-wp' + (i === R.k ? ' on' : '') + '" data-go="' + i + '"><span class="rm-n">' + (i + 1) + '</span><span class="rm-nm">' + esc(p.name || 'WP ' + (i + 1)) + (has(p) ? '<small>' + fmtLL(p.lat, 'N', 'S') + ' ' + fmtLL(p.lon, 'E', 'W') + '</small>' : '<small class="rm-miss">no coordinates yet · tap Edit</small>') + '</span>' + (p.type === 'start' ? '<b class="rm-side">START</b>' : p.type === 'finish' ? '<b class="rm-side">FINISH</b>' : side) + '</div>';
      return '<div class="rm-wp ed" data-i="' + i + '"><span class="rm-n">' + (i + 1) + '</span><div class="rm-edf"><input class="rm-in" data-f="name" value="' + esc(p.name || '') + '" placeholder="Name"><input class="rm-in" data-f="ll" value="' + (has(p) ? esc(fmtLL(p.lat, 'N', 'S') + ' ' + fmtLL(p.lon, 'E', 'W')) : '') + '" placeholder="45°07.407′N 13°36.200′E">' +
        '<div class="row"><select class="rm-in" data-f="side"><option value="P"' + (p.side === 'P' ? ' selected' : '') + '>Leave to PORT</option><option value="S"' + (p.side === 'S' ? ' selected' : '') + '>Leave to STARBOARD</option><option value=""' + (!p.side ? ' selected' : '') + '>Pass (no rounding)</option></select>' +
        '<button class="icon-btn" data-mv="-1">↑</button><button class="icon-btn" data-mv="1">↓</button><button class="cl-del" data-del="' + i + '">✕</button></div></div></div>';
    }).join('');
    if (S.edit) h += '<div class="rm-add"><input id="rmNewName" placeholder="Name (e.g. Mark 3)"><input id="rmNewLL" placeholder="Coordinates, e.g. 45 07.407 N 13 36.200 E"><div class="row"><select id="rmNewSide"><option value="P">Leave to PORT</option><option value="S">Leave to STARBOARD</option><option value="">Pass</option></select><button class="btn" id="rmHere">📍 Here</button><button class="btn primary" id="rmAdd">+ Add</button></div><p class="small" id="rmMsg">Tip: you can also tap the map to place a point while editing.</p>' +
      '<label class="small">Rounding radius <input id="rmRad" type="number" min="15" max="2000" step="5" value="' + R.r + '" style="width:70px"> m (when you are this close the next point is selected; for islands use 300–1000 m)</label></div>';
    h += '</div>';
    box.innerHTML = h;
    docsOf(ev).then(function (d) {
      var el = $('rmDocs'); if (!el) return;
      var si = d.filter(function (x) { return /\bsi\b|sailing.?instr|upute|instruc/i.test(x.name || ''); });
      el.innerHTML = d.length ? '<span class="small">From the event: ' + d.map(function (x) { return '<b>' + esc(x.name) + '</b>'; }).join(', ') + '</span> <button class="btn sm" disabled title="AI reading of courses is coming">Read course from SI (AI) · soon</button>' :
        '<span class="small">This event has no NoR / SI yet: add them on the <b>NOR / SI</b> page, or enter the course here.</span>';
      if (si.length) el.querySelector('button').title = 'SI found: ' + si[0].name;
    });
    if (w.some(has)) { drawMap(ev); } tick();
  }

  /* ---- mapa ---- */
  function fc(ev) {
    var w = route(ev).wps, k = route(ev).k;
    var wc = w.filter(has), lc = wc.map(function (p) { return [p.lon, p.lat]; });
    return { line: { type: 'Feature', geometry: { type: 'LineString', coordinates: lc.length > 1 ? lc : [[0, 0], [0, 0]] } },
      pts: { type: 'FeatureCollection', features: w.map(function (p, i) { return has(p) ? { type: 'Feature', properties: { n: String(i + 1), s: p.side || '', on: i === k ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } } : null; }).filter(Boolean) } };
  }
  function drawMap(ev) {
    if (!window.Track || !$('rmMap')) return;
    if (S.map) { try { S.map.remove(); } catch (e) {} S.map = null; S.ready = false; }
    window.Track.lib().then(function () {
      var w = route(ev).wps, b = new maplibregl.LngLatBounds(); w.forEach(function (p) { if (has(p)) b.extend([p.lon, p.lat]); });
      var m = window.Track.makeMap($('rmMap'), b.getCenter().toArray()); S.map = m;
      m.on('load', function () { m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 15 }); });
      m.on('style.load', function () {
        if (m.getSource('rl')) return; var F = fc(ev);
        m.addSource('rl', { type: 'geojson', data: F.line }); m.addLayer({ id: 'rl', type: 'line', source: 'rl', paint: { 'line-color': '#00e0c6', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 } });
        m.addSource('rp', { type: 'geojson', data: F.pts });
        m.addLayer({ id: 'rp', type: 'circle', source: 'rp', paint: { 'circle-radius': ['case', ['==', ['get', 'on'], 1], 11, 8], 'circle-color': ['match', ['get', 's'], 'P', '#e8413a', 'S', '#2bbf5a', '#c8c8c8'], 'circle-stroke-width': ['case', ['==', ['get', 'on'], 1], 3, 1.5], 'circle-stroke-color': ['case', ['==', ['get', 'on'], 1], '#ffffff', '#05070a'] } });
        m.addLayer({ id: 'rpn', type: 'symbol', source: 'rp', layout: { 'text-field': ['get', 'n'], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#05070a' } });
        m.addSource('bt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'btl', type: 'line', source: 'bt', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.7 } });
        m.addLayer({ id: 'bt', type: 'circle', source: 'bt', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#05070a' } });
        S.ready = true; tick();
      });
      m.on('click', function (e) {
        if (!S.edit) return; var ll = $('rmNewLL'); if (!ll) return;
        ll.value = fmtLL(e.lngLat.lat, 'N', 'S') + ' ' + fmtLL(e.lngLat.lng, 'E', 'W'); $('rmMsg').textContent = 'Point placed from the map. Name it and tap + Add.';
      });
    }).catch(function () { var el = $('rmMap'); if (el) el.innerHTML = '<p class="small" style="padding:12px">Map needs internet.</p>'; });
  }

  /* ---- navigacija ---- */
  function tick() {
    var ev = curEv(); if (!ev) return; var R = route(ev), w = R.wps, nav = $('rmNav'); if (!nav || !w.length) return;
    var me = window.RA && window.RA.nav ? window.RA.nav() : null, T = w[Math.min(R.k, w.length - 1)];
    var side = T.side === 'P' ? '<b class="rm-side p big">LEAVE TO PORT</b>' : T.side === 'S' ? '<b class="rm-side s big">LEAVE TO STARBOARD</b>' : '<b class="rm-side big">PASS</b>';
    var h = '<div class="rm-next"><span class="rm-k">' + (R.k + 1) + '/' + w.length + '</span><b class="rm-tn">' + esc(T.name || 'WP ' + (R.k + 1)) + '</b>' + side + '</div>';
    if (!has(T)) h += '<p class="small rm-miss">No coordinates for this point. Tap Edit and add them (NoR list of waypoints, or tap the map).</p>';
    else if (me && me.lat) {
      var d = distNm(me, T), b = brg(me, T), vmc = me.sog !== null && me.hdg !== null ? me.sog * Math.cos(rad(nrm(me.hdg - b))) : null, eta = vmc && vmc > 0.3 ? d / vmc * 3600 : null;
      h += '<div class="rm-nums"><div><span>BRG</span><b>' + d3(b) + '°</b></div><div><span>DST nm</span><b>' + (d < 10 ? d.toFixed(2) : d.toFixed(1)) + '</b></div><div><span>VMC kn</span><b>' + (vmc === null ? '–' : vmc.toFixed(1)) + '</b></div><div><span>ETA</span><b>' + (eta === null ? '–' : (eta >= 3600 ? Math.floor(eta / 3600) + 'h' + ('0' + Math.floor(eta % 3600 / 60)).slice(-2) : Math.floor(eta / 60) + ':' + ('0' + Math.round(eta % 60)).slice(-2))) + '</b></div></div>';
      // auto-prelazak: ušao u krug obilaska, pa počeo da se udaljava
      var dm = d * 1852;
      // strana obilaska: na najbližem prolasku, da li je tačka levo ili desno od kursa
      if (dm <= R.r) { S.near = true; if (S.minD === null || dm < S.minD) { S.minD = dm; S.close = me.hdg !== null ? nrm(brg(me, T) - me.hdg) : null; } }
      else if (S.near && dm > R.r * 1.3 && R.k < w.length - 1) {
        var was = S.close, ok = !T.side || was === null ? null : (T.side === 'P' ? was < 0 : was > 0);
        S.near = false; S.minD = null; S.close = null; R.k++; saveEv(ev);
        if (ok === false) { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]); if (window.RA && window.RA.toast) window.RA.toast('⚠ ' + (T.name || 'Mark') + ' looks passed on the WRONG side (should be ' + (T.side === 'P' ? 'PORT' : 'STARBOARD') + '). Check and go back if needed.', null, null, 8000); }
        else if (window.RA && window.RA.toast) window.RA.toast('Next: ' + (w[R.k].name || 'WP ' + (R.k + 1)));
        return render();
      }
      if (S.map && S.ready) { var bt = S.boat = S.boat || []; bt.push([me.lon, me.lat]); if (bt.length > 600) bt.shift(); S.map.getSource('bt').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: bt.length > 1 ? bt : [[me.lon, me.lat], [me.lon, me.lat]] } }, { type: 'Feature', geometry: { type: 'Point', coordinates: [me.lon, me.lat] } }] }); }
    } else h += '<p class="small">Waiting for GPS…</p>';
    var fi = w.map(function (p) { return p.type; }).lastIndexOf('finish');
    h += '<div class="row rm-step"><button class="btn sm" id="rmPrev">◀ Prev</button>' + (fi > R.k ? '<button class="btn sm" id="rmFlagC" title="Flag C at the mark: after rounding it, sail directly to the finish">Flag C → finish</button>' : '') + '<button class="btn sm" id="rmCopy">Copy position</button><button class="btn sm" id="rmNext">Next ▶</button></div>';
    h += '<label class="small rm-rep"><input type="checkbox" id="rmRep"' + (R.rep ? ' checked' : '') + '> Remind me to report position every ' + (R.repH || 4) + ' h (SI: progress update)' + (R.rep && S.rep ? ' · next ' + new Date(S.rep).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '') + '</label>';
    if (R.rep) { if (!S.rep) S.rep = Date.now() + (R.repH || 4) * 3600000; if (Date.now() >= S.rep) { S.rep = Date.now() + (R.repH || 4) * 3600000; if (navigator.vibrate) navigator.vibrate([300, 100, 300]); if (window.RA && window.RA.toast) window.RA.toast('Time to report: tap Copy position and send it to the race WhatsApp group.', null, null, 10000); } }
    nav.innerHTML = h;
  }
  function setK(k) { var ev = curEv(); if (!ev) return; var R = route(ev); R.k = Math.max(0, Math.min(R.wps.length - 1, k)); S.near = false; S.minD = null; saveEv(ev); render(); }

  /* ---- događaji ---- */
  function bind() {
    var box = $('rmBody'); if (!box) return;
    box.addEventListener('click', function (e) {
      var t = e.target;
      if (t.id === 'rmLink') { sset('rmEv', $('rmPick').value); render(); return; }
      var ev = curEv(); if (!ev) return; var R = route(ev);
      if (t.id === 'rmEdit') { S.edit = !S.edit; render(); return; }
      if (t.id === 'rmUnlink') { sset('rmEv', null); S.paste = false; S.edit = false; render(); return; }
      if (t.id === 'rmPasteBtn') { S.paste = !S.paste; render(); var c = myCls(), ti = TEMPLATES.map(function (x) { return x.cls.indexOf(c) >= 0; }).indexOf(true); if (S.paste && ti >= 0 && $('rmTpl')) { $('rmTpl').value = String(ti); $('rmCName').value = TEMPLATES[ti].name; } return; }
      if (t.id === 'rmPasteX') { S.paste = false; render(); return; }
      if (t.id === 'rmImport') {
        var tp = $('rmTpl').value, raw = $('rmPasteTxt').value, txt = tp !== '' ? TEMPLATES[+tp].txt : pickSection(raw, myCls()), list = parseCourse(txt);
        var LB = Object.assign({}, ev.wpLib || {}, parseLib(tp !== '' ? TEMPLATES[+tp].lib || '' : raw));
        if (Object.keys(LB).length) { ev.wpLib = LB; fillFromLib(list, LB); }
        // nalepljena samo lista waypointa (bez staze): dopuni postojeću stazu
        if (tp === '' && Object.keys(parseLib(raw)).length && list.every(function (p) { return /^[A-Z][0-9]?\s/.test(p.name) && has(p); })) { var nf = fillFromLib(route(ev).wps, LB); S.paste = false; saveEv(ev); render(); if (window.RA && window.RA.toast) window.RA.toast('Waypoint list saved · ' + nf + ' points of the course got coordinates'); return; }
        if (!list.length) { $('rmPMsg').textContent = 'Nothing to import. Paste the list of points (one per line) or pick a course.'; return; }
        var nm = $('rmCName').value.trim() || (tp !== '' ? TEMPLATES[+tp].name : 'Course ' + (ev.courses.length + 1));
        var cur0 = route(ev); if (!cur0.wps.length && ev.courses.length === 1) ev.courses = [];
        ev.courses.push({ name: nm, wps: list, k: 0, r: 50 }); ev.ci = ev.courses.length - 1; S.paste = false; saveEv(ev); render();
        if (window.RA && window.RA.toast) window.RA.toast(list.length + ' points imported · ' + list.filter(function (p) { return !has(p); }).length + ' need coordinates'); return;
      }
      if (t.id === 'rmCDel') { ev.courses.splice(ev.ci, 1); ev.ci = 0; S.paste = false; saveEv(ev); render(); return; }
      if (t.id === 'rmFlagC') { var fi2 = R.wps.map(function (p) { return p.type; }).lastIndexOf('finish'); if (fi2 >= 0) setK(fi2); return; }
      if (t.id === 'rmCopy') {
        var me2 = window.RA && window.RA.nav ? window.RA.nav() : null, T2 = R.wps[R.k];
        var msg = (ev.name || 'Race') + ' · ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + (me2 && me2.lat ? ' · position ' + fmtLL(me2.lat, 'N', 'S') + ' ' + fmtLL(me2.lon, 'E', 'W') + (me2.sog !== null ? ' · SOG ' + me2.sog.toFixed(1) + ' kn' : '') : '') + (T2 ? ' · next: ' + T2.name + (has(T2) && me2 && me2.lat ? ' (' + distNm(me2, T2).toFixed(1) + ' nm)' : '') : '');
        (navigator.clipboard ? navigator.clipboard.writeText(msg) : Promise.reject()).then(function () { if (window.RA && window.RA.toast) window.RA.toast('Copied: ' + msg); }).catch(function () { prompt('Copy:', msg); }); return;
      }
      if (t.id === 'rmPrev') { setK(R.k - 1); return; }
      if (t.id === 'rmNext') { setK(R.k + 1); return; }
      if (t.id === 'rmHere') { var me = window.RA && window.RA.nav ? window.RA.nav() : null; if (me && me.lat) $('rmNewLL').value = fmtLL(me.lat, 'N', 'S') + ' ' + fmtLL(me.lon, 'E', 'W'); else $('rmMsg').textContent = 'No GPS position yet.'; return; }
      if (t.id === 'rmAdd') {
        var p = parsePair($('rmNewLL').value); if (!p) { $('rmMsg').textContent = 'Could not read the coordinates. Example: 45 07.407 N 13 36.200 E, or 45.12345, 13.60333'; return; }
        R.wps.push({ name: $('rmNewName').value.trim() || 'WP ' + (R.wps.length + 1), lat: p.lat, lon: p.lon, side: $('rmNewSide').value }); saveEv(ev); render(); return;
      }
      if (t.hasAttribute('data-del')) { R.wps.splice(+t.getAttribute('data-del'), 1); if (R.k >= R.wps.length) R.k = Math.max(0, R.wps.length - 1); saveEv(ev); render(); return; }
      if (t.hasAttribute('data-mv')) { var i = +t.closest('[data-i]').getAttribute('data-i'), j = i + (+t.getAttribute('data-mv')); if (j < 0 || j >= R.wps.length) return; var x = R.wps[i]; R.wps[i] = R.wps[j]; R.wps[j] = x; saveEv(ev); render(); return; }
      var g = t.closest('[data-go]'); if (g && !S.edit) setK(+g.getAttribute('data-go'));
    });
    box.addEventListener('change', function (e) {
      var t = e.target, ev = curEv(); if (!ev) return; var R = route(ev);
      if (t.id === 'rmRad') { R.r = Math.max(15, Math.min(2000, +t.value || 50)); saveEv(ev); return; }
      if (t.id === 'rmCourse') { ev.ci = +t.value; S.near = false; S.minD = null; saveEv(ev); render(); return; }
      if (t.id === 'rmRep') { R.rep = t.checked; S.rep = null; saveEv(ev); tick(); return; }
      if (t.id === 'rmTpl' && t.value !== '') { $('rmCName').value = TEMPLATES[+t.value].name; return; }
      var row = t.closest('[data-i]'); if (!row || !t.getAttribute('data-f')) return; var p = R.wps[+row.getAttribute('data-i')], f = t.getAttribute('data-f');
      if (f === 'name') p.name = t.value.trim();
      if (f === 'side') p.side = t.value;
      if (f === 'll') { var q = parsePair(t.value); if (!q) { t.classList.add('bad'); return; } t.classList.remove('bad'); p.lat = q.lat; p.lon = q.lon; }
      saveEv(ev); if (f !== 'name') { var c = fc(ev); if (S.map && S.ready) { S.map.getSource('rl').setData(c.line); S.map.getSource('rp').setData(c.pts); } }
    });
    S.timer = setInterval(function () { var pg = $('p-map'); if (pg && pg.getBoundingClientRect().left > -10 && pg.getBoundingClientRect().left < 10) tick(); }, 1000);
  }
  window.RaceMap = { render: render, parsePair: parsePair, parseOne: parseOne, parseCourse: parseCourse, pickSection: pickSection };
  if (document.readyState !== 'loading') { bind(); render(); } else document.addEventListener('DOMContentLoaded', function () { bind(); render(); });
})();
