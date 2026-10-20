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
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  // samo događaji koji nisu završeni (prošle regate, npr. Palić, se ovde ne nude)
  function live(x) { return !x.dateFrom || (x.dateTo || x.dateFrom) >= ymd(new Date()); }
  function curEv() { var id = sget('rmEv', null), e = id ? events().filter(function (x) { return x.id === id; })[0] || null : null; return e && live(e) ? e : null; }
  function saveEv(ev) { sset('norEvents', events().map(function (x) { return x.id === ev.id ? ev : x; })); }
  // više staza po eventu (po klasama); aktivna staza = ev.courses[ev.ci]
  function route(ev) {
    if (!ev.courses) { ev.courses = [Object.assign({ name: 'Course', wps: [], k: 0, r: 50 }, ev.route || {})]; delete ev.route; ev.ci = 0; }
    if (!ev.courses.length) ev.courses.push({ name: 'Course', wps: [], k: 0, r: 50 });
    ev.ci = Math.max(0, Math.min(ev.courses.length - 1, ev.ci || 0)); return ev.courses[ev.ci];
  }
  function isVia(p) { return !!p && p.type === 'via'; }
  // oznaka: zvanične tačke 1, 2, 3 …; via tačke (naše, za stvarnu putanju) 1.1, 1.2 … posle tačke 1
  function lab(w, i) { var n = 0, v = 0; for (var j = 0; j <= i && j < w.length; j++) { if (isVia(w[j])) v++; else { n++; v = 0; } } return isVia(w[i]) ? n + '.' + v : String(n); }
  function clean(n) { return String(n || '').replace(/\s*\([^)]*(not named|diagram|course map)[^)]*\)/ig, '').trim(); }
  function nmOf(w, i) { var p = w[i]; return p ? (clean(p.name) || (isVia(p) ? 'Via ' + lab(w, i) : 'WP ' + lab(w, i))) : ''; }
  function viaNext(w, i) { var a = lab(w, i).split('.'); return a[0] + '.' + ((+a[1] || 0) + 1); }
  function nextMark(w, k) { for (var j = k; j < w.length; j++) if (!isVia(w[j])) return j; return -1; }
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
  var S = { map: null, ready: false, edit: false, timer: null, boat: null, near: false, minD: null, close: null, paste: false, rep: null, pick: null, ins: null, drag: null, wxOn: sget('rmWx', false), wxD: null, wxT: null, wxBusy: false, layer: null, ideal: null, idealOn: false, idealBusy: false, rd: '' };

  function docsOf(ev) {
    return new Promise(function (res) {
      try { var rq = indexedDB.open('raNor', 1); rq.onupgradeneeded = function () { rq.result.createObjectStore('docs', { keyPath: 'id' }); }; rq.onsuccess = function () { try { var db = rq.result, tx = db.transaction('docs', 'readonly'), st = tx.objectStore('docs'), g = st.getAll(); g.onsuccess = function () { res((g.result || []).filter(function (d) { return d.eventId === ev.id && d.kind !== 'diagram'; })); }; g.onerror = function () { res([]); }; } catch (e) { res([]); } }; rq.onerror = function () { res([]); }; } catch (e) { res([]); }
    });
  }

  function render() {
    var box = $('rmBody'); if (!box) return;
    var ev = curEv();
    if (!ev) {
      var E = events().filter(live).sort(function (a, b) { return String(a.dateFrom || '').localeCompare(String(b.dateFrom || '')); });
      box.innerHTML = '<div class="nor-empty"><h2>RACE MAP</h2><p>For distance races with waypoints. Add the event and upload its NoR / SI on the <b>NOR / SI</b> page, then link it here.</p>' +
        '<div class="row rm-link"><button class="btn" id="rmGoNor">Go to NOR / SI</button></div>' +
        (E.length ? '<div class="row rm-link"><select id="rmPick">' + E.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc((x.summary && x.summary.event) || x.name) + (x.dateFrom ? ' · ' + x.dateFrom : '') + '</option>'; }).join('') + '</select><button class="btn primary" id="rmLink">Link event</button></div>' : '') + '</div>';
      return;
    }
    var R = route(ev), w = R.wps, setup = S.edit || !w.length;
    var old = document.querySelector('body > #rmStage'); if (old) old.remove(); document.body.classList.remove('trk-fs-on');
    var h = '<div class="rm-top"><b>' + esc((ev.summary && ev.summary.event) || ev.name) + '</b><span class="small">' + esc(ev.courses.length > 1 || setup ? R.name || '' : '') + '</span><button class="btn sm" id="rmEdit">' + (S.edit ? 'Done' : 'Edit') + '</button></div>';
    var h0 = h, sh = ''; h = '';
    if (setup) {
    h += '<div class="rm-setup"><div class="row"><span class="small">Event: <b>' + esc((ev.summary && ev.summary.event) || ev.name) + '</b></span><button class="btn sm" id="rmUnlink">Change event</button></div>';
    h += '<div class="rm-docs" id="rmDocs"><span class="small">Documents from this event…</span></div>';
    h += '<div class="row rm-cs"><select id="rmCourse">' + ev.courses.map(function (c, i) { return '<option value="' + i + '"' + (i === ev.ci ? ' selected' : '') + '>' + esc(c.name) + ' (' + c.wps.length + ')</option>'; }).join('') + '</select><button class="btn sm" id="rmPasteBtn">+ Course</button></div>';
    if (S.paste) h += '<div class="rm-paste"><input id="rmCName" placeholder="Course name (e.g. First 18 / 24)"><textarea id="rmPasteTxt" rows="7" placeholder="Paste the course list from the SI (only your class is used), one point per line:\nStart\nZ isolated danger NW of Iž (STBD)\nOtočič Mrtovnjak (STBD) 44.010643, 15.175301\n…\nFinish"></textarea>' +
      '<div class="row"><select id="rmTpl"><option value="">…or a course we already read</option>' + (function () { var c = myCls(), mine = [], oth = []; TEMPLATES.forEach(function (t, i) { (c && t.cls.indexOf(c) >= 0 ? mine : oth).push('<option value="' + i + '">' + esc(t.name) + '</option>'); }); return (mine.length ? '<optgroup label="Your class">' + mine.join('') + '</optgroup>' : '') + (oth.length ? '<optgroup label="Other classes">' + oth.join('') + '</optgroup>' : ''); })() + '</select></div><div class="row"><button class="btn primary" id="rmImport">Create course</button><button class="btn" id="rmPasteX">Cancel</button>' + (ev.courses.length > 1 || w.length ? '<button class="btn danger" id="rmCDel">Delete this course</button>' : '') + '</div><p class="small" id="rmPMsg"></p></div>';
    h += '<div class="row"><button class="btn sm" id="rmFlagC">Flag C → go to finish</button><button class="btn sm" id="rmCopy">Copy position</button></div>';
    h += '<label class="small rm-rep"><input type="checkbox" id="rmRep"' + (R.rep ? ' checked' : '') + '> Position report reminder · ' + (R.repH || 4) + ' h</label></div>';
    }
    sh = h; h = h0; if (!w.length) h += sh;
    if (w.length) {
      h += '<div class="rm-stage" id="rmStage"><div class="rm-map' + (S.pick !== null || S.ins !== null ? ' pick' : '') + '" id="rmMap">' + (S.pick !== null && w[S.pick] ? '<div class="rm-pickbar"><span>Tap map: <b>' + lab(w, S.pick) + ' · ' + esc(nmOf(w, S.pick)) + '</b></span><button class="btn sm" id="rmPickX">Cancel</button></div>' :
        S.ins !== null && w[S.ins] ? '<div class="rm-pickbar via"><span>Tap map: via <b>' + viaNext(w, S.ins) + '</b></span><button class="btn sm primary" id="rmPickX">Done</button></div>' : '') +
        '<div class="trk-fsbtns"><button class="icon-btn" id="rmFs" title="Full screen">' + (S.fs ? '✕' : '⛶') + '</button><button class="icon-btn" id="rmZin">+</button><button class="icon-btn" id="rmZout">−</button><button class="icon-btn' + (S.wxOn ? ' on' : '') + '" id="rmWxB" title="Wind forecast">≋</button><button class="icon-btn' + (S.idealOn ? ' on' : '') + '" id="rmIdB" title="Ideal route">⤳</button></div>' + wxBar() + '</div>';
      h += '<div class="rm-nav" id="rmNav"></div></div>';
    } else h += '<p class="small">No waypoints yet: read them from the SI (AI) above, or add them below.</p>';
    h += '<div class="rm-sec"><div class="rm-head"><h3>ROUTE · ' + (function () { var nv = w.filter(isVia).length, nm = w.length - nv; return nm + ' mark' + (nm === 1 ? '' : 's') + (nv ? ' · ' + nv + ' via' : ''); })() + '</h3></div><div class="' + (S.edit ? '' : 'rm-list') + '">';
    h += w.map(function (p, i) {
      var side = isVia(p) ? '<b class="rm-side via">VIA</b>' : p.side === 'P' ? '<b class="rm-side p">PORT</b>' : p.side === 'S' ? '<b class="rm-side s">STBD</b>' : '<b class="rm-side">PASS</b>', L = lab(w, i), vc = isVia(p) ? ' via' : '';
      var insB = S.edit && i < w.length - 1 ? '<button class="rm-insv" data-ins="' + i + '">+ via ' + viaNext(w, i) + '</button>' : '';
      if (!S.edit) return '<div class="rm-wp' + vc + (i === R.k ? ' on' : '') + '" data-go="' + i + '"><span class="rm-n">' + L + '</span><span class="rm-nm">' + esc(nmOf(w, i)) + (has(p) ? legTxt(w, i) : '<small class="rm-miss">no coordinates yet</small>') + '</span>' + (has(p) ? '' : '<button class="btn sm rm-pin" data-pick="' + i + '">📍 Set on map</button>') + (p.type === 'start' ? '<b class="rm-side">START</b>' : p.type === 'finish' ? '<b class="rm-side">FINISH</b>' : side) + '</div>';
      return '<div class="rm-wp ed' + vc + '" data-i="' + i + '"><span class="rm-n">' + L + '</span><div class="rm-edf"><input class="rm-in" data-f="name" value="' + esc(clean(p.name)) + '" placeholder="' + (isVia(p) ? 'Via ' + L + ' (name optional)' : 'Name') + '"><input class="rm-in" data-f="ll" value="' + (has(p) ? esc(fmtLL(p.lat, 'N', 'S') + ' ' + fmtLL(p.lon, 'E', 'W')) : '') + '" placeholder="45°07.407′N 13°36.200′E">' + (p.type === 'start' || i === 0 ? startField(ev) : '') +
        '<div class="row">' + (isVia(p) ? '<span class="small rm-vt">Via point · pass, no rounding</span>' : '<select class="rm-in" data-f="side"><option value="P"' + (p.side === 'P' ? ' selected' : '') + '>Leave to PORT</option><option value="S"' + (p.side === 'S' ? ' selected' : '') + '>Leave to STARBOARD</option><option value=""' + (!p.side ? ' selected' : '') + '>Pass (no rounding)</option></select>') +
        '<button class="icon-btn" data-pick="' + i + '" title="Place on the map">📍</button><button class="icon-btn" data-mv="-1">↑</button><button class="icon-btn" data-mv="1">↓</button><button class="cl-del" data-del="' + i + '">✕</button></div></div></div>' + insB;
    }).join('');
    if (S.edit) h += '<div class="rm-add"><input id="rmNewName" placeholder="Name (e.g. Mark 3)"><input id="rmNewLL" placeholder="Coordinates, e.g. 45 07.407 N 13 36.200 E"><div class="row"><select id="rmNewSide"><option value="P">Leave to PORT</option><option value="S">Leave to STARBOARD</option><option value="">Pass</option></select><button class="btn" id="rmHere">📍 Here</button><button class="btn primary" id="rmAdd">+ Add</button></div><p class="small" id="rmMsg"></p>' +
      '<label class="small">Rounding radius <input id="rmRad" type="number" min="15" max="2000" step="5" value="' + R.r + '" style="width:70px"> m</label></div>';
    h += '</div></div>';
    if (S.edit && w.length) h += '<details class="rm-more"><summary>Event, SI, start time</summary>' + sh + '</details>';
    box.innerHTML = h;
    if (S.fs && $('rmStage')) { var st = $('rmStage'); document.body.appendChild(st); st.classList.add('fs'); document.body.classList.add('trk-fs-on'); st.addEventListener('click', onClick); st.addEventListener('input', onInput); }
    if (setup) docsOf(ev).then(function (d) {
      var el = $('rmDocs'); if (!el) return;
      var si = d.filter(function (x) { return /\bsi\b|sailing.?instr|upute|instruc/i.test(x.name || ''); });
      el.innerHTML = d.length ? '<button class="btn sm primary" id="rmAI">' + (S.aiBusy ? 'Reading the SI… 20–60 s' : 'Read course from SI (AI)') + '</button>' :
        '<span class="small">No SI yet: upload it on the NOR / SI page.</span>';
      if (si.length) el.querySelector('button').title = 'SI found: ' + si[0].name;
    });
    if (w.length) { drawMap(ev); } tick();
  }

  /* ---- AI: staza moje klase iz NoR / SI dokumenata eventa ---- */
  function toB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(blob); }); }
  function aiUrl() { return (sget('aiUrl', '') || 'https://race-app-ai.milos-0e2.workers.dev').replace(/\/+$/, ''); }
  function readAI(ev) {
    var PR = window.Profile, c = PR && PR.current(), cls = c ? c.name : '';
    if (!cls && !confirm('No boat class in Settings → My boat. Read the first course in the SI?')) return;
    S.aiBusy = true; render();
    docsOf(ev).then(function (d) {
      if (!d.length) throw new Error('Add the NoR / SI on the NOR / SI page first');
      return Promise.all(d.slice(0, 6).map(function (x) { var t = (x.blob && x.blob.type) || (/\.pdf$/i.test(x.name) ? 'application/pdf' : 'image/jpeg'); return toB64(x.blob).then(function (b) { return { name: x.name, type: t, data: b }; }); }));
    }).then(function (docs) { return fetch(aiUrl() + '/course', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ev.name, cls: cls, docs: docs }) }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.summary) throw new Error(j.error || ('Server error ' + r.status)); return j; }); })
      .then(function (j) {
        var A = j.summary, side = { port: 'P', starboard: 'S' }, list = (A.waypoints || []).slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }).map(function (w) {
          var ty = /start/i.test(w.type) ? 'start' : /finish/i.test(w.type) ? 'finish' : 'mark', ok = typeof w.lat === 'number' && typeof w.lon === 'number' && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180;
          return { name: clean((w.id ? w.id + ' ' : '') + (w.name || '')) || 'Point ' + w.seq, lat: ok ? w.lat : null, lon: ok ? w.lon : null, side: ty === 'mark' ? side[String(w.side || '').toLowerCase()] || '' : '', type: ty, note: w.note || '' };
        });
        if (!list.length) throw new Error('No course found in the documents');
        var cur0 = route(ev); if (!cur0.wps.length && ev.courses.length === 1) ev.courses = [];
        ev.courses.push({ name: (A.class_used || cls || 'Course') + ' (AI)', wps: list, k: 0, r: 50, rules: A.rules || [], warnings: A.warnings || [], start: A.start || null, finish: A.finish || null, ai: { at: Date.now(), usage: j.usage || null } });
        ev.ci = ev.courses.length - 1; S.aiBusy = false; saveEv(ev); render();
        var miss = list.filter(function (p) { return !has(p); }).length;
        if (window.RA && window.RA.toast) window.RA.toast('Course read: ' + list.length + ' points' + (miss ? ' · ' + miss + ' without coordinates' : '') + '. Check it before the race.', null, null, 6000);
      })
      .catch(function (e) { S.aiBusy = false; render(); if (window.RA && window.RA.toast) window.RA.toast('Could not read the course: ' + e.message, null, null, 6000); });
  }
  /* ---- mapa ---- */
  function fc(ev) {
    var w = route(ev).wps, k = route(ev).k;
    var wc = w.filter(has), lc = wc.map(function (p) { return [p.lon, p.lat]; });
    return { line: { type: 'Feature', geometry: { type: 'LineString', coordinates: lc.length > 1 ? lc : [[0, 0], [0, 0]] } },
      pts: { type: 'FeatureCollection', features: w.map(function (p, i) { return has(p) ? { type: 'Feature', properties: { i: i, n: lab(w, i), v: isVia(p) ? 1 : 0, s: p.side || '', on: i === k ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } } : null; }).filter(Boolean) } };
  }
  // kurs i daljina etape: od prethodne tačke sa koordinatama do ove
  function legTxt(w, i) {
    var p = w[i], q = null; for (var j = i - 1; j >= 0; j--) if (has(w[j])) { q = w[j]; break; }
    if (!q) { var ev0 = curEv(), sa0 = ev0 && startAt(ev0); return '<small class="rm-leg">' + (sa0 ? new Date(sa0).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm(sa0) : 'start of route') + '</small>'; }
    var d = distNm(q, p); return '<small class="rm-leg">' + d3(brg(q, p)) + '° · ' + (d < 10 ? d.toFixed(2) : d.toFixed(1)) + ' nm</small>';
  }
  function pickHint(R, p) {
    if (p.type === 'start' && R.start && R.start.desc) return 'SI: ' + R.start.desc;
    if (p.type === 'finish' && R.finish && R.finish.desc) return 'SI: ' + R.finish.desc;
    return p.note || '';
  }
  function setPt(ev, i, lat, lon) {
    var R = route(ev), p = R.wps[i]; if (!p) return;
    p.lat = Math.round(lat * 1e6) / 1e6; p.lon = Math.round(lon * 1e6) / 1e6; p.src = 'map'; saveEv(ev);
  }
  function refresh(ev) { var c = fc(ev); if (S.map && S.ready) { S.map.getSource('rl').setData(c.line); S.map.getSource('rp').setData(c.pts); } }
  /* ---- vetar i idealna ruta ---- */
  function hrs() { var d = S.wxD; if (!d) return []; var now = Date.now() - 3600000; return d.t.filter(function (t) { return t >= now; }); }
  function tLab(t) { var d = new Date(t); return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + ('0' + d.getHours()).slice(-2) + ':00'; }
  function wxBar() {
    if (!S.wxOn && !S.idealOn) return '';
    var H = hrs(), i = Math.max(0, H.indexOf(S.wxT)), id = S.ideal;
    var chip = S.idealBusy ? 'Ideal route… ' : !id ? '' : id.msg ? esc(id.msg) :
      (id.ok || id.tNext ? (id.live ? 'Now' : 'At ' + esc(id.from) + ' <b>' + (id.est ? '~' : '') + hm(id.tFrom) + '</b>') + (id.tNext ? ' · → ' + esc(id.next) + ' <b>' + dur(id.tNext - id.tFrom) + '</b>' : '') + (id.ok ? ' · finish <b>' + hm(id.t1) + '</b>' : '') + (id.land ? '' : ' · no land check') : '') +
      (id.ok ? '' : (id.tNext ? '<br>' : '') + 'No route ' + esc(id.failName) + ': add a via point');
    return '<div class="rm-wxbar">' + (chip ? '<div class="rm-chip">' + chip + '</div>' : '') + (S.rd ? '<div class="rm-chip">' + S.rd + '</div>' : '') +
      (S.wxD ? '<div class="wm-time"><span id="rmWxT">' + (H[i] ? tLab(H[i]) : '') + '</span><input type="range" id="rmWxS" min="0" max="' + Math.max(0, H.length - 1) + '" value="' + i + '"></div>' : S.wxBusy ? '<div class="rm-chip">Loading forecast…</div>' : '') + '</div>';
  }
  function upBar() { var el = document.querySelector('.rm-wxbar'), html = wxBar(); if (el) { if (html) el.outerHTML = html; else el.remove(); } else if (html) { var m = $('rmMap'); if (m) m.insertAdjacentHTML('beforeend', html); } var bI = $('rmIdB'); if (bI) bI.classList.toggle('on', S.idealOn); }
  function ticks(id) {
    var f = []; if (!id || !id.line || id.line.length < 2) return f;
    var L = id.line, T = id.tl, h = Math.ceil(T[0] / 3600000) * 3600000;
    for (var i = 1; i < L.length && f.length < 80; i++) while (h <= T[i]) { var u = (h - T[i - 1]) / ((T[i] - T[i - 1]) || 1); f.push({ type: 'Feature', properties: { l: hm(h) }, geometry: { type: 'Point', coordinates: [L[i - 1][0] + (L[i][0] - L[i - 1][0]) * u, L[i - 1][1] + (L[i][1] - L[i - 1][1]) * u] } }); h += 3600000; }
    return f;
  }
  function showIdeal() {
    var on = S.idealOn && S.ideal && S.ideal.line && S.ideal.line.length > 1;
    if (S.map && S.ready && S.map.getSource('ideal')) { S.map.getSource('ideal').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: on ? S.ideal.line : [[0, 0], [0, 0]] } }); S.map.getSource('idealT').setData({ type: 'FeatureCollection', features: on ? ticks(S.ideal) : [] }); }
    upBar();
  }
  function dur(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + 'h' + ('0' + m % 60).slice(-2); }
  // start: iz SI (prvi signal upozorenja + 5 min) ili ručno u Edit; ev.startAt (ms)
  function siStart(ev) {
    var S2 = ev.summary || {}, fw = S2.first_warning || (S2.key && S2.key.first_warning) || '', m = String(fw).match(/(\d{1,2})[:.](\d{2})/);
    if (!ev.dateFrom) return null; var day = String(fw).match(/day\s*(\d)/i), d0 = Date.parse(ev.dateFrom + 'T' + (m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '10:00') + ':00');
    return d0 + (day ? (+day[1] - 1) * 864e5 : 0) + (m ? 5 * 60000 : 0);
  }
  function startAt(ev) { return ev.startAt || siStart(ev); }
  function dtLocal(t) { var d = new Date(t); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + 'T' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function hm(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function startField(ev) {
    var sa = startAt(ev);
    return '<label class="small rm-st">Start time <input type="datetime-local" id="rmStart" value="' + (sa ? dtLocal(sa) : '') + '"> <span>' + (ev.startAt ? 'edited' : sa ? 'from SI' : '') + '</span>' + (ev.startAt ? ' <button class="btn sm" id="rmStartX">SI time</button>' : '') + '</label>';
  }
  function routePts(ev) { return route(ev).wps.filter(has); }
  function ensureWx(ev) {
    var pts = routePts(ev), model = window.WxRoute ? WxRoute.model() : 'best_match', key = ev.id + '|' + model + '|' + pts.length;
    if (S.wxD && S.wxD.key === key && Date.now() - S.wxD.at < 3600000) return Promise.resolve(S.wxD);
    var c = sget('rmWxGrid', null); if (c && c.key === key && Date.now() - c.at < 3600000) { S.wxD = c; return Promise.resolve(c); }
    if (!pts.length) return Promise.reject(new Error('Route has no points with coordinates'));
    S.wxBusy = true;
    return WxRoute.fetchGrid(pts, model).then(function (d) { d.key = key; S.wxD = d; S.wxBusy = false; sset('rmWxGrid', d); return d; }, function (e) { S.wxBusy = false; if (c && c.key === key) { S.wxD = c; return c; } throw e; });
  }
  function defT(ev) {
    var H = hrs(); if (!H.length) return null; var t0 = Date.now();
    if (ev.dateFrom) { var st = Date.parse(ev.dateFrom + 'T10:00:00'); if (st > t0) t0 = st; }
    for (var i = 0; i < H.length; i++) if (H[i] >= t0 - 1800000) return H[i];
    return H[H.length - 1];
  }
  function setWxT(t) { S.wxT = t; if (S.layer && S.wxD) S.layer.set(S.wxD, t); var el = $('rmWxT'); if (el) el.textContent = tLab(t); }
  function startWx(ev, then) {
    S.wxBusy = true; S.keepCam = true; render();
    ensureWx(ev).then(function () { if (!S.wxT || hrs().indexOf(S.wxT) < 0) S.wxT = defT(ev); S.keepCam = true; render(); if (then) then(); })
      .catch(function (e) { S.wxBusy = false; S.keepCam = true; render(); if (window.RA && window.RA.toast) window.RA.toast('No forecast: ' + e.message); });
  }
  function runIdeal(ev) {
    var c = window.Profile && Profile.current(); if (!c || !c.polar) { S.idealOn = false; upBar(); if (window.RA && window.RA.toast) window.RA.toast('Choose your boat class (with polar) in Settings → My boat'); return; }
    var R = route(ev), w = R.wps, miss = w.filter(function (p) { return !has(p); }).length;
    var me = window.RA && window.RA.nav ? window.RA.nav() : null, list = [], live = false, li = 0;
    // u trci (GPS na stazi): od mene, sada, kroz preostale tačke
    if (me && me.lat && R.k > 0 && has(w[R.k]) && distNm(me, w[R.k]) < 30) { live = true; list.push({ lat: me.lat, lon: me.lon, name: 'You' }); w.slice(R.k).forEach(function (p, j) { if (has(p)) list.push({ lat: p.lat, lon: p.lon, name: nmOf(w, R.k + j) }); }); }
    else {
      // pre trke / planiranje: cela staza od starta u vreme starta; prikaz od izabrane tačke, u vreme kada ćeš verovatno biti tamo
      w.forEach(function (p, j) { if (!has(p)) return; if (j <= R.k) li = list.length; list.push({ lat: p.lat, lon: p.lon, name: nmOf(w, j) }); });
      if (!has(w[R.k])) li = Math.max(0, li);
    }
    if (list.length < 2 || li >= list.length - 1) { S.idealOn = false; upBar(); return; }
    S.idealBusy = true; upBar();
    var go = function () {
      var m = S.map; if (!m || !S.ready) { setTimeout(go, 300); return; }
      var b = new maplibregl.LngLatBounds(); list.forEach(function (p) { b.extend([p.lon, p.lat]); });
      m.fitBounds(b, { padding: 30, duration: 0, maxZoom: 12 });
      m.once('idle', function () {
        var mask = window.RaceMap._water ? WxRoute.waterMask(m, list, window.RaceMap._water) : WxRoute.waterMask(m, list);
        setTimeout(function () {
          var spd = function (tws, a) { var G = c.guide && Profile.guideAt(c.guide, tws); if (G && G.up && a < G.up.twa - 1) return 0; return Profile.speed(c.polar, tws, a); };
          var O = { wind: S.wxD, speed: spd, upMin: 30, mask: mask, tackS: 12, gybeS: 8 };
          var t0 = live ? Date.now() : (startAt(ev) || defT(ev)), last = S.wxD.t[S.wxD.t.length - 1], r, est = false;
          if (t0 > last) { S.ideal = { ok: false, msg: 'Start is after the end of the forecast (72 h)' }; S.idealBusy = false; showIdeal(); return; }
          r = WxRoute.route(Object.assign({ pts: list, t0: t0 }, O));
          if (!live && li > 0 && (!r.ok && r.failAt <= li)) {
            // ruta pre izabrane tačke ne prolazi: računaj od nje, vreme dolaska procenjeno (4 čv)
            var dd = 0; for (var q = 1; q <= li; q++) dd += distNm(list[q - 1], list[q]);
            est = true; list = list.slice(li); li = 0; r = WxRoute.route(Object.assign({ pts: list, t0: t0 + dd / 4 * 3600000 }, O));
          }
          var off = 0, from = li;
          if (li > 0 && r.legs[li - 1]) off = r.legs[li - 1].i;
          var res = { ok: r.ok, land: !!mask, est: est, live: live,
            line: r.line.slice(off), tl: r.tl.slice(off), from: list[from].name, next: list[from + 1] ? list[from + 1].name : '',
            tFrom: from > 0 && r.legs[from - 1] ? r.legs[from - 1].t : r.t0, tNext: r.legs[from] ? r.legs[from].t : null, t1: r.t1, t0: r.t0 };
          if (!r.ok) res.failName = (list[r.failAt - 1] ? list[r.failAt - 1].name + ' → ' : '') + (list[r.failAt] ? list[r.failAt].name : '');
          S.ideal = res; S.idealBusy = false;
          // vetar na mapi u trenutku kada si na početnoj tački
          if (res.tFrom) { var H = hrs(), best = H[0]; H.forEach(function (h) { if (Math.abs(h - res.tFrom) < Math.abs(best - res.tFrom)) best = h; }); if (best) { setWxT(best); var sl = $('rmWxS'); if (sl) sl.value = H.indexOf(best); } }
          showIdeal();
          var bb = new maplibregl.LngLatBounds(); res.line.forEach(function (q) { bb.extend(q); });
          if (S.map && res.line.length > 1) S.map.fitBounds(bb, { padding: { top: 30, left: 30, right: 64, bottom: 110 }, duration: 300, maxZoom: 14 });
          if (miss && window.RA && window.RA.toast) window.RA.toast(miss + ' point' + (miss > 1 ? 's' : '') + ' without coordinates skipped');
        }, 30);
      });
    };
    if (S.wxD) go(); else ensureWx(ev).then(function () { if (!S.wxT) S.wxT = defT(ev); go(); }).catch(function (e) { S.idealBusy = false; S.idealOn = false; upBar(); if (window.RA && window.RA.toast) window.RA.toast('No forecast: ' + e.message); });
  }

  function drawMap(ev) {
    if (!window.Track || !$('rmMap')) return;
    var cam = S.map ? { c: S.map.getCenter().toArray(), z: S.map.getZoom() } : null;
    if (S.layer) { try { S.layer.destroy(); } catch (e) {} S.layer = null; }
    if (S.map) { try { S.map.remove(); } catch (e) {} S.map = null; S.ready = false; }
    window.Track.lib().then(function () {
      var w = route(ev).wps, b = new maplibregl.LngLatBounds(); w.forEach(function (p) { if (has(p)) b.extend([p.lon, p.lat]); });
      var me = window.RA && window.RA.nav ? window.RA.nav() : null, any = !b.isEmpty();
      var c0 = any ? b.getCenter().toArray() : ev.loc && ev.loc.lon !== undefined ? [ev.loc.lon, ev.loc.lat] : me && me.lat ? [me.lon, me.lat] : [15.2, 44.0];
      var m = window.Track.makeMap($('rmMap'), c0); S.map = m;
      m.on('load', function () { if (cam && S.keepCam) { S.keepCam = false; m.jumpTo({ center: cam.c, zoom: cam.z }); return; } if (any && !(b.getNorthEast().lat === b.getSouthWest().lat && b.getNorthEast().lng === b.getSouthWest().lng)) m.fitBounds(b, { padding: 40, duration: 0, maxZoom: 15 }); else m.jumpTo({ center: c0, zoom: any ? 13 : 10 }); });
      m.on('style.load', function () {
        if (m.getSource('rl')) return; var F = fc(ev);
        m.addSource('ideal', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: S.idealOn && S.ideal && S.ideal.line.length > 1 ? S.ideal.line : [[0, 0], [0, 0]] } } });
        m.addLayer({ id: 'idealC', type: 'line', source: 'ideal', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#00e0c6', 'line-width': 9, 'line-opacity': 0.22 } });
        m.addSource('idealT', { type: 'geojson', data: { type: 'FeatureCollection', features: S.idealOn && S.ideal ? ticks(S.ideal) : [] } });
        m.addLayer({ id: 'ideal', type: 'line', source: 'ideal', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#00e0c6', 'line-width': 2.2, 'line-opacity': 0.95 } });
        if (S.wxOn && S.wxD && window.WxRoute) { S.layer = WxRoute.Layer(m, $('rmMap')); S.layer.set(S.wxD, S.wxT || defT(ev)); }
        m.addSource('rl', { type: 'geojson', data: F.line }); m.addLayer({ id: 'rl', type: 'line', source: 'rl', paint: { 'line-color': '#00e0c6', 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.8 } });
        m.addLayer({ id: 'idealT', type: 'circle', source: 'idealT', paint: { 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#05070a' } });
        m.addLayer({ id: 'idealTl', type: 'symbol', source: 'idealT', layout: { 'text-field': ['get', 'l'], 'text-size': 10, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, 1.1], 'text-allow-overlap': false }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#05070a', 'text-halo-width': 1.5 } });
        m.addSource('rp', { type: 'geojson', data: F.pts });
        m.addLayer({ id: 'rp', type: 'circle', source: 'rp', paint: { 'circle-radius': ['case', ['==', ['get', 'v'], 1], ['case', ['==', ['get', 'on'], 1], 8, 6], ['==', ['get', 'on'], 1], 11, 8], 'circle-color': ['case', ['==', ['get', 'v'], 1], '#00e0c6', ['match', ['get', 's'], 'P', '#e8413a', 'S', '#2bbf5a', '#c8c8c8']], 'circle-stroke-width': ['case', ['==', ['get', 'on'], 1], 3, 1.5], 'circle-stroke-color': ['case', ['==', ['get', 'on'], 1], '#ffffff', '#05070a'] } });
        m.addLayer({ id: 'rpv', type: 'symbol', source: 'rp', filter: ['==', ['get', 'v'], 1], layout: { 'text-field': ['get', 'n'], 'text-size': 10, 'text-font': ['Noto Sans Bold'], 'text-offset': [0, -1.3], 'text-allow-overlap': true }, paint: { 'text-color': '#00e0c6', 'text-halo-color': '#05070a', 'text-halo-width': 1.5 } });
        m.addLayer({ id: 'rpn', type: 'symbol', source: 'rp', filter: ['!=', ['get', 'v'], 1], layout: { 'text-field': ['get', 'n'], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#05070a' } });
        m.addSource('bt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'btl', type: 'line', source: 'bt', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.7 } });
        m.addLayer({ id: 'bt', type: 'circle', source: 'bt', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#05070a' } });
        S.ready = true; tick();
      });
      // povlačenje tačke u Edit režimu
      function dragStart(e) {
        if (!S.edit || S.pick !== null || !e.features || !e.features.length) return;
        e.preventDefault(); S.drag = +e.features[0].properties.i; m.getCanvas().style.cursor = 'grabbing';
        var mv = function (ev2) { var cur = curEv(); if (!cur || S.drag === null) return; setPt(cur, S.drag, ev2.lngLat.lat, ev2.lngLat.lng); refresh(cur); };
        var up = function () { m.off('mousemove', mv); m.off('touchmove', mv); m.getCanvas().style.cursor = ''; var cur = curEv(), was = S.drag; S.drag = null; S.dragEnd = Date.now(); if (cur && was !== null) { saveEv(cur); S.keepCam = true; render(); } };
        m.on('mousemove', mv); m.on('touchmove', mv); m.once('mouseup', up); m.once('touchend', up);
      }
      m.on('mousedown', 'rp', dragStart); m.on('touchstart', 'rp', function (e) { if (e.points && e.points.length !== 1) return; dragStart(e); });
      m.on('mouseenter', 'rp', function () { if (S.edit) m.getCanvas().style.cursor = 'grab'; });
      m.on('mouseleave', 'rp', function () { m.getCanvas().style.cursor = ''; });
      m.on('click', function (e) {
        if (S.dragEnd && Date.now() - S.dragEnd < 400) return;
        if (S.ins !== null) {
          var cv = curEv(); if (!cv) return; var Rv = route(cv), at = S.ins + 1;
          Rv.wps.splice(at, 0, { name: '', type: 'via', side: '', lat: Math.round(e.lngLat.lat * 1e6) / 1e6, lon: Math.round(e.lngLat.lng * 1e6) / 1e6, src: 'map' });
          if (Rv.k >= at) Rv.k++; S.ins = at; saveEv(cv); S.keepCam = true; render(); return;
        }
        if (S.pick !== null) {
          var cur = curEv(); if (!cur) return; var i = S.pick, nm = route(cur).wps[i] && route(cur).wps[i].name; S.pick = null;
          setPt(cur, i, e.lngLat.lat, e.lngLat.lng); S.keepCam = true; render();
          if (window.RA && window.RA.toast) window.RA.toast(lab(route(cur).wps, i) + ' · ' + (nm || 'WP') + ' placed at ' + fmtLL(e.lngLat.lat, 'N', 'S') + ' ' + fmtLL(e.lngLat.lng, 'E', 'W') + '. Drag it in Edit to fine-tune.', null, null, 5000);
          return;
        }
        if (!S.edit) {
          if (S.wxOn && S.wxD) { var sw = WxRoute.sample(S.wxD, e.lngLat.lat, e.lngLat.lng, S.wxT || Date.now()); S.rd = sw ? '<b>' + Math.round(sw.s) + '</b> kn · G' + Math.round(sw.g) + ' · <b>' + d3(sw.dir) + '°</b>' : 'Outside forecast'; upBar(); }
          return;
        }
        var ll = $('rmNewLL'); if (!ll) return;
        ll.value = fmtLL(e.lngLat.lat, 'N', 'S') + ' ' + fmtLL(e.lngLat.lng, 'E', 'W'); $('rmMsg').textContent = '';
      });
    }).catch(function () { var el = $('rmMap'); if (el) el.innerHTML = '<p class="small" style="padding:12px">Map needs internet.</p>'; });
  }

  /* ---- navigacija ---- */
  function tick() {
    var ev = curEv(); if (!ev) return; var R = route(ev), w = R.wps, nav = $('rmNav'); if (!nav || !w.length) return;
    var me = window.RA && window.RA.nav ? window.RA.nav() : null, T = w[Math.min(R.k, w.length - 1)];
    var side = isVia(T) ? '<b class="rm-side via big">VIA · PASS</b>' : T.side === 'P' ? '<b class="rm-side p big">LEAVE TO PORT</b>' : T.side === 'S' ? '<b class="rm-side s big">LEAVE TO STARBOARD</b>' : '<b class="rm-side big">PASS</b>';
    var h = '<div class="rm-me"><div><span>SOG</span><b>' + (me && me.sog !== null && me.sog !== undefined ? me.sog.toFixed(1) : '–') + '</b><i>kn</i></div><div><span>COG</span><b>' + (me && me.hdg !== null && me.hdg !== undefined && me.sog > 0.5 ? d3(me.hdg) + '°' : '–') + '</b></div></div>';
    h += '<div class="rm-next"><button class="rm-ar" id="rmKp">‹</button><span class="rm-k">' + lab(w, R.k) + '/' + w.filter(function (p) { return !isVia(p); }).length + '</span><b class="rm-tn">' + esc(nmOf(w, R.k)) + '</b>' + side + '<button class="rm-ar" id="rmKn">›</button></div>';
    if (!has(T)) h += '<p class="small rm-miss">No coordinates for this point. Tap Edit and add them (NoR list of waypoints, or tap the map).</p>';
    else if (me && me.lat) {
      var d = distNm(me, T), b = brg(me, T), vmc = me.sog !== null && me.hdg !== null ? me.sog * Math.cos(rad(nrm(me.hdg - b))) : null, eta = vmc && vmc > 0.3 ? d / vmc * 3600 : null;
      h += '<div class="rm-nums"><div><span>BRG</span><b>' + d3(b) + '°</b></div><div><span>DST nm</span><b>' + (d < 10 ? d.toFixed(2) : d.toFixed(1)) + '</b></div><div><span>VMG kn</span><b>' + (vmc === null ? '–' : vmc.toFixed(1)) + '</b></div><div><span>ETA</span><b>' + (eta === null ? '–' : (eta >= 3600 ? Math.floor(eta / 3600) + 'h' + ('0' + Math.floor(eta % 3600 / 60)).slice(-2) : Math.floor(eta / 60) + ':' + ('0' + Math.round(eta % 60)).slice(-2))) + '</b></div></div>';
      // auto-prelazak: ušao u krug obilaska, pa počeo da se udaljava
      var dm = d * 1852;
      if (isVia(T)) {
        // via tačka: samo prolaz. Gotovo kad smo blizu, ili kad smo je već prošli prema sledećoj tački.
        var rv = Math.max(40, Math.min(R.r, 150)), Pn = null; for (var q = R.k + 1; q < w.length; q++) if (has(w[q])) { Pn = w[q]; break; }
        var passed = dm <= rv || (Pn && dm < 926 && Math.abs(nrm(brg(T, me) - brg(T, Pn))) < 60);
        var mi = nextMark(w, R.k);
        if (mi >= 0 && has(w[mi])) { var along = d, prev = T; for (var z = R.k + 1; z <= mi; z++) if (has(w[z])) { along += distNm(prev, w[z]); prev = w[z]; } h += '<p class="small rm-tomark">Next mark: <b>' + esc(lab(w, mi) + ' · ' + nmOf(w, mi)) + '</b>' + (w[mi].side === 'P' ? ' (PORT)' : w[mi].side === 'S' ? ' (STBD)' : '') + ' · ' + along.toFixed(1) + ' nm along your route</p>'; }
        if (passed && R.k < w.length - 1) { S.near = false; S.minD = null; S.close = null; R.k++; saveEv(ev); if (window.RA && window.RA.toast) window.RA.toast('Next: ' + lab(w, R.k) + ' · ' + nmOf(w, R.k)); return render(); }
      } else
      // strana obilaska: na najbližem prolasku, da li je tačka levo ili desno od kursa
      if (dm <= R.r) { S.near = true; if (S.minD === null || dm < S.minD) { S.minD = dm; S.close = me.hdg !== null ? nrm(brg(me, T) - me.hdg) : null; } }
      else if (S.near && dm > R.r * 1.3 && R.k < w.length - 1) {
        var was = S.close, ok = !T.side || was === null ? null : (T.side === 'P' ? was < 0 : was > 0);
        S.near = false; S.minD = null; S.close = null; R.k++; saveEv(ev);
        if (ok === false) { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]); if (window.RA && window.RA.toast) window.RA.toast('⚠ ' + (T.name || 'Mark') + ' looks passed on the WRONG side (should be ' + (T.side === 'P' ? 'PORT' : 'STARBOARD') + '). Check and go back if needed.', null, null, 8000); }
        else if (window.RA && window.RA.toast) window.RA.toast('Next: ' + lab(w, R.k) + ' · ' + nmOf(w, R.k));
        return render();
      }
      if (S.map && S.ready) { var bt = S.boat = S.boat || []; bt.push([me.lon, me.lat]); if (bt.length > 600) bt.shift(); S.map.getSource('bt').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: bt.length > 1 ? bt : [[me.lon, me.lat], [me.lon, me.lat]] } }, { type: 'Feature', geometry: { type: 'Point', coordinates: [me.lon, me.lat] } }] }); }
    } else h += '<p class="small">Waiting for GPS…</p>';
    var fi = w.map(function (p) { return p.type; }).lastIndexOf('finish');
    if (R.rep) { if (!S.rep) S.rep = Date.now() + (R.repH || 4) * 3600000; if (Date.now() >= S.rep) { S.rep = Date.now() + (R.repH || 4) * 3600000; if (navigator.vibrate) navigator.vibrate([300, 100, 300]); if (window.RA && window.RA.toast) window.RA.toast('Time to report: tap Copy position and send it to the race WhatsApp group.', null, null, 10000); } }
    nav.innerHTML = h;
  }
  function setK(k) { var ev = curEv(); if (!ev) return; var R = route(ev); R.k = Math.max(0, Math.min(R.wps.length - 1, k)); S.near = false; S.minD = null; saveEv(ev); render(); }

  /* ---- događaji ---- */
  function bind() {
    var box = $('rmBody'); if (!box) return;
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    box.addEventListener('input', onInput);
    S.timer = setInterval(function () { var pg = $('p-map'); if (S.fs || (pg && pg.getBoundingClientRect().left > -10 && pg.getBoundingClientRect().left < 10)) tick(); }, 1000);
  }
  function onClick(e) {
      var t = e.target;
      if (t.id === 'rmFs') { S.fs = !S.fs; S.keepCam = true; render(); return; }
      if (t.id === 'rmStartX') { var e3 = curEv(); if (e3) { e3.startAt = null; saveEv(e3); S.ideal = null; render(); } return; }
      if (t.id === 'rmWxB') { S.wxOn = !S.wxOn; sset('rmWx', S.wxOn); S.rd = ''; if (S.wxOn && !S.wxD) startWx(curEv()); else { S.keepCam = true; render(); } return; }
      if (t.id === 'rmIdB') { S.idealOn = !S.idealOn; if (S.idealOn) runIdeal(curEv()); else showIdeal(); return; }
      if (t.id === 'rmKp' || t.id === 'rmKn') { var e2 = curEv(); if (e2) setK(route(e2).k + (t.id === 'rmKn' ? 1 : -1)); return; }
      if (t.id === 'rmZin' || t.id === 'rmZout') { if (S.map) S.map.zoomTo(S.map.getZoom() + (t.id === 'rmZin' ? 1 : -1), { duration: 200 }); return; }
      if (t.id === 'rmGoNor') { if (window.RA && RA.goPageId) RA.goPageId('p-nor'); return; }
      if (t.id === 'rmLink') { sset('rmEv', $('rmPick').value); render(); return; }
      var ev = curEv(); if (!ev) return; var R = route(ev);
      if (t.id === 'rmPickX') { S.pick = null; S.ins = null; S.keepCam = true; render(); return; }
      if (t.hasAttribute('data-ins')) { S.ins = +t.getAttribute('data-ins'); S.pick = null; S.keepCam = true; render(); var mq = $('rmMap'); if (mq) mq.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (t.hasAttribute('data-pick')) { S.ins = null; S.pick = +t.getAttribute('data-pick'); S.keepCam = true; render(); var mp = $('rmMap'); if (mp) mp.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (t.id === 'rmEdit') { S.edit = !S.edit; if (!S.edit) S.ins = null; render(); return; }
      if (t.id === 'rmAI') { readAI(ev); return; }
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
        var me2 = window.RA && window.RA.nav ? window.RA.nav() : null, T2 = R.wps[nextMark(R.wps, R.k)] || R.wps[R.k];
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
  }
  function onInput(e) {
    if (e.target.id === 'rmWxS') { var H = hrs(), t = H[+e.target.value]; if (t) setWxT(t); }
  }
  function onChange(e) {
      var t = e.target, ev = curEv(); if (!ev) return; var R = route(ev);
      if (t.id === 'rmRad') { R.r = Math.max(15, Math.min(2000, +t.value || 50)); saveEv(ev); return; }
      if (t.id === 'rmCourse') { ev.ci = +t.value; S.near = false; S.minD = null; saveEv(ev); render(); return; }
      if (t.id === 'rmStart') { var v = Date.parse(t.value); ev.startAt = isNaN(v) ? null : v; saveEv(ev); S.ideal = null; render(); return; }
      if (t.id === 'rmRep') { R.rep = t.checked; S.rep = null; saveEv(ev); tick(); return; }
      if (t.id === 'rmTpl' && t.value !== '') { $('rmCName').value = TEMPLATES[+t.value].name; return; }
      var row = t.closest('[data-i]'); if (!row || !t.getAttribute('data-f')) return; var p = R.wps[+row.getAttribute('data-i')], f = t.getAttribute('data-f');
      if (f === 'name') p.name = t.value.trim();
      if (f === 'side') p.side = t.value;
      if (f === 'll') { var q = parsePair(t.value); if (!q) { t.classList.add('bad'); return; } t.classList.remove('bad'); p.lat = q.lat; p.lon = q.lon; }
      saveEv(ev); if (f !== 'name') { var c = fc(ev); if (S.map && S.ready) { S.map.getSource('rl').setData(c.line); S.map.getSource('rp').setData(c.pts); } }
  }
  window.RaceMap = { _s: function () { return S; }, render: render, parsePair: parsePair, parseOne: parseOne, parseCourse: parseCourse, pickSection: pickSection };
  if (document.readyState !== 'loading') { bind(); render(); } else document.addEventListener('DOMContentLoaded', function () { bind(); render(); });
})();
