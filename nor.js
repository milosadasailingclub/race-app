/* The Race App — NoR / SI: store PDFs offline, AI summary via Claude (copy/paste, no API key yet) */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var R = function () { return window.RA; };
  function esc(t) { return String(t === undefined || t === null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function toast(m, a, f, ms) { if (R()) R().toast(m, a, f, ms); }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) { toast('Storage full'); } }

  /* ---- IndexedDB for PDFs ---- */
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var r = indexedDB.open('raNor', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('docs', { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  function tx(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('docs', mode), s = t.objectStore('docs'), out = fn(s); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); }; }); }); }
  function docsFor(evId) { return tx('readonly', function (s) { return s.getAll(); }).then(function (all) { return (all || []).filter(function (d) { return d.eventId === evId && d.kind !== 'diagram'; }).sort(function (a, b) { return a.added - b.added; }); }); }

  /* ---- events ---- */
  function events() { return sget('norEvents', []); }
  function saveEvents(e) { sset('norEvents', e); }
  function cur() { var id = sget('norCur', null), e = events(); return e.filter(function (x) { return x.id === id; })[0] || e[0] || null; }

  /* ---- pdf.js ---- */
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'lib/pdf.min.js';
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js'; res(); };
      s.onerror = function () { rej(new Error('PDF reader failed to load')); }; document.head.appendChild(s);
    });
  }
  function pdfText(blob) {
    return loadPdfJs().then(function () { return blob.arrayBuffer(); }).then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; }).then(function (pdf) {
      var pages = [];
      for (var i = 1; i <= pdf.numPages; i++) pages.push(i);
      return pages.reduce(function (p, n) {
        return p.then(function (acc) {
          return pdf.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
            var t = ''; tc.items.forEach(function (it) { t += it.str + (it.hasEOL ? '\n' : ' '); });
            return acc + '\n' + t;
          });
        });
      }, Promise.resolve(''));
    });
  }

  /* ---- prompt ---- */
  var SCHEMA = '{\n  "event": "", "venue": "", "dates": "", "organizer": "",\n  "key": {"first_warning": "", "vhf": "", "time_limit": "", "penalty": ""},\n' +
    '  "schedule": [{"day": "", "items": [""]}],\n  "courses": [{"name": "", "sequence": ["Start", "1 (port)", "2", "Finish"], "notes": ""}],\n' +
    '  "marks": [{"name": "", "description": ""}],\n  "start": "", "finish": "",\n  "time_limits": [""], "signals": [""],\n' +
    '  "penalties": "", "protests": "", "scoring": "",\n  "safety": [""], "equipment": [""], "other": [""],\n  "changes": [""]\n}';
  function buildPrompt(ev, texts) {
    var p = 'You are helping a racing sailor. Below are the Notice of Race (NoR), Sailing Instructions (SI) and any amendments for "' + ev.name + '".\n' +
      'Extract what a competitor needs ON THE WATER, short and exact (times, numbers, VHF channel, mark rounding sides, colours). ' +
      'If an amendment changes something, use the amended value and list the change in "changes". Leave out anything not stated; do not guess.\n' +
      'Answer with ONLY a JSON object in this exact structure (no text before or after):\n' + SCHEMA + '\n\n';
    texts.forEach(function (t) { p += '===== DOCUMENT: ' + t.name + ' =====\n' + t.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() + '\n\n'; });
    return p;
  }
  function parseAnswer(s) {
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('No JSON found in the pasted answer');
    return JSON.parse(s.slice(a, b + 1));
  }

  /* ---- AI sažetak preko našeg servera ---- */
  var AI_URL_DEFAULT = 'https://race-app-ai.milos-0e2.workers.dev';
  function aiUrl() { return (sget('aiUrl', '') || AI_URL_DEFAULT).replace(/\/+$/, ''); }
  var busy = false;
  function toB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(blob); }); }
  function docType(d) { var t = (d.blob && d.blob.type) || ''; if (t) return t; return /\.pdf$/i.test(d.name) ? 'application/pdf' : 'image/jpeg'; }
  function summarize(ev, infoEl) {
    var url = aiUrl();
    function info(t) { if (infoEl) infoEl.textContent = t; }
    if (!url) { info('Documents saved. The AI server is not connected yet, so the summary cannot be made automatically.'); toast('AI server not connected yet'); return Promise.resolve(); }
    busy = true; renderSummary(); info('Reading the documents… this takes about 20–60 s.');
    return docsFor(ev.id).then(function (d) {
      if (!d.length) throw new Error('Add the NoR / SI first');
      return Promise.all(d.map(function (x) { return toB64(x.blob).then(function (b) { return { name: x.name, type: docType(x), data: b }; }); })).then(function (docs) {
        ev.docNames = d.map(function (x) { return x.name; }).join(', ');
        return fetch(url + '/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ev.name, docs: docs }) });
      });
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.summary) throw new Error(j.error || ('Server error ' + r.status)); return j.summary; }); })
      .then(function (S) {
        saveEvents(events().map(function (x) { return x.id === ev.id ? Object.assign(x, { summary: S, summaryAt: Date.now(), docNames: ev.docNames }) : x; }));
        busy = false; info(''); render(); toast('Summary ready');
        autoDiagrams(ev, S).then(function (n) { if (n) toast(n + ' course diagram' + (n > 1 ? 's' : '') + ' added from the documents'); });
      }).catch(function (err) { busy = false; renderSummary(); info('Summary failed: ' + err.message); toast('Summary failed'); });
  }
  // dijagrami kurseva: stranice koje je AI označio -> slika (obrezane bele margine)
  function trimCanvas(cv) {
    var g = cv.getContext('2d'), w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data, x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (var y = 0; y < h; y += 2) for (var x = 0; x < w; x += 2) { var i = (y * w + x) * 4; if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 <= x0 || y1 <= y0) return cv;
    var m = 16; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w, x1 + m); y1 = Math.min(h, y1 + m);
    var o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0; o.getContext('2d').drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o;
  }
  function autoDiagrams(ev, S) {
    var want = (S.diagram_pages || []).filter(function (p) { return p && p.page; }).slice(0, 6);
    if (!want.length) return Promise.resolve(0);
    return Promise.all([docsFor(ev.id), tx('readonly', function (st) { return st.getAll(); })]).then(function (r) {
      var docs = r[0], old = (r[1] || []).filter(function (d) { return d.eventId === ev.id && d.kind === 'diagram' && d.auto; });
      return tx('readwrite', function (st) { old.forEach(function (d) { st.delete(d.id); }); }).then(function () { return loadPdfJs(); }).then(function () {
        var n = 0;
        return want.reduce(function (pr, w) {
          return pr.then(function () {
            var nm = String(w.doc || '').toLowerCase(), doc = docs.filter(function (d) { return /pdf/i.test(docType(d)) && d.name.toLowerCase() === nm; })[0] ||
              docs.filter(function (d) { return /pdf/i.test(docType(d)) && nm && (d.name.toLowerCase().indexOf(nm) >= 0 || nm.indexOf(d.name.toLowerCase()) >= 0); })[0] || (docs.filter(function (d) { return /pdf/i.test(docType(d)); }).length === 1 ? docs.filter(function (d) { return /pdf/i.test(docType(d)); })[0] : null);
            if (!doc) return;
            return doc.blob.arrayBuffer().then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; }).then(function (pdf) {
              var pn = Math.min(Math.max(1, +w.page), pdf.numPages);
              return pdf.getPage(pn).then(function (pg) {
                var vp = pg.getViewport({ scale: 2 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
                var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
                return pg.render({ canvasContext: g, viewport: vp }).promise.then(function () {
                  return new Promise(function (res) { trimCanvas(cv).toBlob(res, 'image/png'); });
                }).then(function (blob) {
                  n++;
                  return tx('readwrite', function (st) { st.put({ id: 'g' + uid(), eventId: ev.id, kind: 'diagram', auto: true, name: (w.what || 'Course diagram') + ' · ' + doc.name + ', page ' + pn, size: blob.size, added: Date.now(), blob: blob }); });
                });
              });
            }).catch(function () {});
          });
        }, Promise.resolve()).then(function () { return loadDiagrams(ev.id); }).then(function () { renderSummary(); return n; });
      });
    }).catch(function () { return 0; });
  }
  function addDocs(ev, files) {
    return Promise.all(files.map(function (f) { return tx('readwrite', function (s) { s.put({ id: 'd' + uid(), eventId: ev.id, name: f.name, size: f.size, added: Date.now(), blob: f }); }); }));
  }

  /* ---- prognoza za regatu ---- */
  var FC_MODELS = [['best_match', 'Best model'], ['icon_seamless', 'ICON (DWD)'], ['ecmwf_ifs025', 'ECMWF'], ['meteofrance_seamless', 'AROME / ARPEGE'], ['arpae_icon_2i', 'ItaliaMeteo ICON 2I'], ['gfs_seamless', 'GFS']];
  var fcBusy = {};
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function geocode(q) {
    return fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=' + encodeURIComponent(q)).then(function (r) { return r.json(); })
      .then(function (j) { var g = j && j.results && j.results[0]; if (!g) throw new Error('Place not found'); return { lat: g.latitude, lon: g.longitude, name: g.name + (g.country ? ', ' + g.country : '') }; });
  }
  function fcArrow(dir) { return '<span class="wx-arrow" style="transform:rotate(' + Math.round((dir + 180) % 360) + 'deg)">↑</span>'; }
  function fcHtml(ev) {
    if (!ev.dateFrom || !ev.loc) return '<div class="nor-fc"><div class="nor-fc-head"><h3>FORECAST</h3></div><p class="nor-fc-note">Add the dates and place of the regatta (✎ → Event) to see the forecast.</p></div>';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var from = new Date(ev.dateFrom + 'T00:00:00'), to = new Date((ev.dateTo || ev.dateFrom) + 'T00:00:00'), last = new Date(today.getTime() + 15 * 864e5);
    var head = '<div class="nor-fc-head"><h3>FORECAST</h3><select id="norFcModel">' + FC_MODELS.map(function (m) { return '<option value="' + m[0] + '"' + ((ev.fcModel || 'best_match') === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></div>';
    if (to < today) return '<div class="nor-fc">' + head + '<p class="nor-fc-note">The regatta is over.</p></div>';
    if (from > last) return '<div class="nor-fc">' + head + '<p class="nor-fc-note">Forecast opens on ' + new Date(from.getTime() - 15 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' (16 days ahead). ' + esc(ev.loc.name || '') + '</p></div>';
    var fc = ev.fc;
    if (!fc || !fc.hourly.temperature_2m || fc.model !== (ev.fcModel || 'best_match') || Date.now() - fc.at > 3600000) { loadFc(ev); if (!fc) return '<div class="nor-fc">' + head + '<p class="nor-fc-note">Loading forecast…</p></div>'; }
    var H = fc.hourly, rows = '', prev = '';
    for (var i = 0; i < H.time.length; i++) {
      var t = H.time[i], hr = +t.slice(11, 13); if (hr < 8 || hr > 19 || hr % 2) continue;
      var day = t.slice(0, 10); if (day < ev.dateFrom || day > (ev.dateTo || ev.dateFrom)) continue;
      if (day !== prev) { rows += '<div class="wx-day">' + new Date(day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase() + '</div>'; prev = day; }
      var a = H.wind_speed_10m[i], g = H.wind_gusts_10m[i], d = H.wind_direction_10m[i], ratio = (a !== null && g) ? Math.max(0.15, Math.min(0.85, a / g)) : 0.5;
      rows += '<div class="wx-row"><span class="t">' + t.slice(11, 13) + ':00</span><span class="wx-wg" style="--r:' + Math.round(ratio * 100) + '%"><b>' + (a === null ? '–' : Math.round(a)) + '</b><b>' + (g === null ? '–' : Math.round(g)) + '</b></span>' +
        '<span class="wx-dir">' + (d === null || d === undefined ? '–' : ('00' + Math.round(d) % 360).slice(-3) + fcArrow(d)) + '</span>' +
        '<span class="wx-misc">' + (window.RA_rainTxt ? window.RA_rainTxt((H.precipitation_probability || [])[i], (H.precipitation || [])[i]) : '') + (H.temperature_2m && H.temperature_2m[i] !== null && H.temperature_2m[i] !== undefined ? Math.round(H.temperature_2m[i]) + '°' : '–') + '</span></div>';
    }
    if (!rows) rows = '<p class="nor-fc-note">This model has no data for these days or this place. Try another model.</p>';
    var far = (to - today) / 864e5 > 7 ? ' More than 7 days ahead: treat as a trend, not exact.' : '';
    return '<div class="nor-fc">' + head + '<div class="wx-row head"><span>TIME</span><span class="wx-wg-h"><span>WIND kn</span><span>GUST</span></span><span style="text-align:right">DIR</span><span style="text-align:right">°C / 💧</span></div>' + rows +
      '<p class="nor-fc-note">' + esc(ev.loc.name || '') + ' · updated ' + new Date(fc.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '.' + far + '</p></div>';
  }
  function loadFc(ev) {
    if (fcBusy[ev.id]) return; fcBusy[ev.id] = true;
    var today = ymd(new Date()), from = ev.dateFrom < today ? today : ev.dateFrom, lastD = ymd(new Date(Date.now() + 15 * 864e5)), to = (ev.dateTo || ev.dateFrom) > lastD ? lastD : (ev.dateTo || ev.dateFrom);
    var m = ev.fcModel || 'best_match';
    var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + ev.loc.lat.toFixed(4) + '&longitude=' + ev.loc.lon.toFixed(4) + '&timezone=auto&wind_speed_unit=kn&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,precipitation,temperature_2m&start_date=' + from + '&end_date=' + to + (m !== 'best_match' ? '&models=' + m : '');
    fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      fcBusy[ev.id] = false;
      if (!j || j.error || !j.hourly) throw new Error((j && j.reason) || 'no data');
      // podrži i odgovore sa sufiksom modela (wind_speed_10m_icon_seamless)
      var H = j.hourly; ['wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'precipitation_probability', 'precipitation', 'temperature_2m'].forEach(function (k) { if (!H[k]) { for (var kk in H) if (kk.indexOf(k + '_') === 0) H[k] = H[kk]; } if (!H[k]) H[k] = H.time.map(function () { return null; }); });
      saveEvents(events().map(function (x) { return x.id === ev.id ? Object.assign(x, { fc: { at: Date.now(), model: m, hourly: { time: H.time, wind_speed_10m: H.wind_speed_10m, wind_gusts_10m: H.wind_gusts_10m, wind_direction_10m: H.wind_direction_10m, precipitation_probability: H.precipitation_probability, precipitation: H.precipitation, temperature_2m: H.temperature_2m } } }) : x; }));
      renderSummary();
    }).catch(function (e) { fcBusy[ev.id] = false; var b = $('norFcBox'); if (b) b.innerHTML = '<div class="nor-fc"><p class="nor-fc-note">Forecast not available: ' + esc(e.message) + '</p></div>'; });
  }

  /* ---- render ---- */
  var manage = false;
  function renderEvents() {
    var e = events(), c = cur(), sel = $('norEvent');
    sel.innerHTML = e.length ? e.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('') : '<option value="">No event yet</option>';
    if (c) sel.value = c.id;
    $('norDelEvent').disabled = !c;
  }
  function list(arr) { arr = (arr || []).filter(function (x) { return x && String(x).trim(); }); return arr.length ? '<ul>' + arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : ''; }
  function sec(title, body) { return body ? '<div class="nor-sec"><h3>' + title + '</h3>' + body + '</div>' : ''; }
  function txt(s) { return s && String(s).trim() ? '<p>' + esc(s) + '</p>' : ''; }
  function renderSummary() {
    var c = cur(), box = $('norSummary');
    if (!c) { box.innerHTML = '<div class="nor-empty"><h2>NoR / SI</h2><p>No event yet. Tap <b>+</b>, type the event name, add the NoR / SI and tap CREATE SUMMARY.</p></div>'; return; }
    var S = c.summary, FC = '<div id="norFcBox">' + fcHtml(c) + '</div>';
    if (!S) { box.innerHTML = '<div class="nor-empty"><h2>' + esc(c.name) + '</h2><p>' + (busy ? 'Making the summary…' : 'No summary yet. Add the NoR / SI below and tap Refresh summary.') + '</p></div>' + FC; bindFc(c); return; }
    var SMP = window.RA_SAMPLE_EVENT, diagrams = (c.diagramUrls || (SMP && c.id === SMP.id ? SMP.diagramUrls : null) || []).map(function (u) { return { src: u, caption: 'From the SI (Addendum B)' }; }).concat(diaCache[c.id] || []);
    var k = S.key || {}, h = '';
    h += '<div class="nor-title"><b>' + esc(S.event || c.name) + '</b><span>' + esc([S.venue, S.dates].filter(Boolean).join(' · ')) + '</span></div>';
    // Na vodi: VHF + prvi signali (sitno), dijagrami krupno, signal kursa, redosled kao u originalu, start, cilj.
    var vhf = S.vhf || k.vhf, fw = S.first_warning || k.first_warning;
    if (vhf || fw) h += '<div class="nor-keys">' + (vhf ? '<div class="nor-vhf"><span>VHF</span><b>' + esc(vhf) + '</b></div>' : '') + (fw ? '<div class="nor-fw"><span>FIRST WARNING</span><b>' + esc(fw).replace(/ · /g, '<br>') + '</b></div>' : '') + '</div>';
    if ((S.courses && S.courses.length) || diagrams.length) {
      var C = window.Courses, dh = diagrams.map(function (d, di) { return '<div class="nor-dia" data-zoom="' + di + '"><img src="' + d.src + '" alt="Course diagram"></div>'; }).join('');
      h += sec('Courses', dh + (S.course_signal ? '<p class="nor-csig">' + esc(S.course_signal) + '</p>' : '') + (S.courses || []).map(function (co) {
        var pn = C && C.pennantFromName(co.name + ' ' + (co.signal || ''));
        return '<div class="nor-course"><div class="nor-cname">' + (pn ? C.pennant(pn) : '') + '<b>' + esc(co.name) + '</b>' + (co.signal ? '<span class="nor-cs">' + esc(co.signal) + '</span>' : '') + '</div><div class="nor-seq">' + (co.sequence || []).map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('<i>›</i>') + '</div>' + (co.notes ? '<p>' + esc(co.notes) + '</p>' : '') + '</div>';
      }).join(''));
    }
    h += sec('Start', txt(S.start)) + sec('Finish', txt(S.finish));
    h += '<div class="nor-open" id="norOpenDocs"></div>' + FC;
    h += '<p class="small nor-foot">AI summary from ' + esc(c.docNames || 'your documents') + ' · ' + new Date(c.summaryAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '. Always check the official documents.</p>';
    box.innerHTML = h; bindFc(c);
    docsFor(c.id).then(function (d) {
      var o = $('norOpenDocs'); if (!o) return;
      var am = 0, lbl = function (x, i) { var n = x.name.toLowerCase(); if (d.length === 1) return 'READ FULL NOR / SI'; if (/amend|izmen|ammend/.test(n)) return 'AMENDMENT ' + (++am); if (/(^|[^a-z])si([^a-z]|$)|sailing.?instr|uputstv/.test(n)) return 'READ FULL SI'; if (/nor|notice|raspis|poziv/.test(n)) return 'READ FULL NOR'; return /image/.test(docType(x)) ? 'PHOTO ' + (i + 1) : 'DOCUMENT ' + (i + 1); };
      o.innerHTML = d.map(function (x, i) { return '<button class="btn nor-read" data-open-doc="' + x.id + '">📄 ' + lbl(x, i) + '</button>'; }).join('');
    });
    box.querySelectorAll('[data-zoom]').forEach(function (el) { el.addEventListener('click', function () { zoomImg(el.querySelector('img').src); }); });
  }
  function zoomImg(src) {
    var ov = document.createElement('div'); ov.className = 'nor-zoom';
    ov.innerHTML = '<div class="nor-zoom-bar"><button class="btn" data-z="1">FIT</button><button class="btn" data-z="2">2×</button><button class="btn" data-z="3">3×</button><button class="btn" data-z="x">✕</button></div><div class="nor-zoom-sc"><img src="' + src + '"></div>';
    document.body.appendChild(ov);
    var img = ov.querySelector('img');
    ov.addEventListener('click', function (e) { var z = e.target.getAttribute && e.target.getAttribute('data-z'); if (!z) return; if (z === 'x') ov.remove(); else img.style.width = (100 * +z) + '%'; });
  }
  function bindFc(c) {
    var sel = $('norFcModel'); if (!sel) return;
    sel.addEventListener('change', function () { saveEvents(events().map(function (x) { return x.id === c.id ? Object.assign(x, { fcModel: sel.value }) : x; })); renderSummary(); });
  }
  var diaCache = {};
  function loadDiagrams(evId) {
    return tx('readonly', function (st) { return st.getAll(); }).then(function (all) {
      (diaCache[evId] || []).forEach(function (d) { URL.revokeObjectURL(d.src); });
      diaCache[evId] = (all || []).filter(function (d) { return d.eventId === evId && d.kind === 'diagram'; }).map(function (d) { return { id: d.id, src: URL.createObjectURL(d.blob), caption: d.name }; });
    });
  }
  function renderDocs() {
    var c = cur(), box = $('norDocs');
    if (!c) { box.innerHTML = '<p class="small">Create an event first.</p>'; return; }
    docsFor(c.id).then(function (d) {
      box.innerHTML = d.length ? d.map(function (x) {
        return '<div class="nor-doc"><span>📄 ' + esc(x.name) + ' <em>' + Math.round(x.size / 1024) + ' kB</em></span><button class="btn" data-open-doc="' + x.id + '">Open</button><button class="cl-del" data-del-doc="' + x.id + '">✕</button></div>';
      }).join('') : '<p class="small">No PDFs yet.</p>';
    });
  }
  function render() {
    renderEvents(); renderSummary();
    var cc = cur(); if (cc) loadDiagrams(cc.id).then(function () { renderSummary(); if (manage) renderDiaList(); });
    $('norSummary').classList.toggle('hidden', manage);
    $('norAmendBox').classList.toggle('hidden', manage || !cur());
    if (!events().length && !manage) $('norQuick').classList.remove('hidden');
    $('norManage').classList.toggle('hidden', !manage);
    $('norManageBtn').classList.toggle('on', manage);
    if (manage) { renderDocs(); renderDiaList(); var ce = cur(); $('norEFrom').value = ce && ce.dateFrom || ''; $('norETo').value = ce && ce.dateTo || ''; $('norEPlace').value = ce && ce.loc ? ce.loc.name : ''; eLoc = null; }
  }

  /* ---- course diagram: copy from PDF page (crop) or image ---- */
  var crop = { doc: null, page: 1, pages: 1, canvas: null };
  function renderDiaList() {
    var c = cur(), box = $('norDiaList'); if (!box || !c) return;
    var list = diaCache[c.id] || [];
    box.innerHTML = list.length ? list.map(function (d) { return '<div class="nor-doc"><img src="' + d.src + '" class="nor-thumb" alt=""><span>' + esc(d.caption) + '</span><button class="cl-del" data-del-dia="' + d.id + '">✕</button></div>'; }).join('') : '<p class="small">No course diagram yet.</p>';
    docsFor(c.id).then(function (docs) {
      $('norDiaDoc').innerHTML = docs.length ? docs.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + '</option>'; }).join('') : '<option value="">Add a PDF first</option>';
    });
  }
  function drawCrop() {
    var cv = crop.canvas, out = $('norCropView'); if (!cv) return;
    var l = +$('cropL').value, r = +$('cropR').value, t = +$('cropT').value, b = +$('cropB').value;
    var x = cv.width * l / 100, y = cv.height * t / 100, w = Math.max(10, cv.width * (100 - r - l) / 100), h = Math.max(10, cv.height * (100 - b - t) / 100);
    out.width = w; out.height = h; out.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
  }
  function loadPage() {
    var id = $('norDiaDoc').value; if (!id) { toast('Add the SI / NoR PDF first.'); return; }
    tx('readonly', function (st) { return st.get(id); }).then(function (d) {
      return loadPdfJs().then(function () { return d.blob.arrayBuffer(); }).then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; });
    }).then(function (pdf) {
      crop.pages = pdf.numPages; var n = Math.min(Math.max(1, +$('norDiaPage').value || pdf.numPages), pdf.numPages); $('norDiaPage').value = n; $('norDiaPage').max = pdf.numPages;
      return pdf.getPage(n).then(function (pg) {
        var vp = pg.getViewport({ scale: 2 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () { crop.canvas = cv; $('norCropBox').classList.remove('hidden'); drawCrop(); });
      });
    }).catch(function (e) { toast('Could not open PDF: ' + e.message); });
  }
  function saveDiagramBlob(blob, name) {
    var c = cur(); if (!c) return;
    tx('readwrite', function (st) { st.put({ id: 'g' + uid(), eventId: c.id, kind: 'diagram', name: name, size: blob.size, added: Date.now(), blob: blob }); })
      .then(function () { return loadDiagrams(c.id); }).then(function () { renderDiaList(); renderSummary(); toast('Course diagram saved'); });
  }

  /* ---- actions ---- */
  $('norManageBtn').addEventListener('click', function () { manage = !manage; render(); });
  $('norDiaLoad').addEventListener('click', loadPage);
  ['cropL', 'cropR', 'cropT', 'cropB'].forEach(function (id) { $(id).addEventListener('input', drawCrop); });
  $('norDiaSave').addEventListener('click', function () {
    var out = $('norCropView'); out.toBlob(function (b) { saveDiagramBlob(b, 'From ' + ($('norDiaDoc').selectedOptions[0] || {}).textContent + ', page ' + $('norDiaPage').value); $('norCropBox').classList.add('hidden'); }, 'image/png');
  });
  $('norDiaImg').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) saveDiagramBlob(f, f.name); });
  document.addEventListener('click', function (e) {
    var o = e.target.closest && e.target.closest('[data-del-dia]'); if (!o) return;
    var id = o.dataset.delDia; toast('Delete this diagram?', 'Delete', function () { tx('readwrite', function (st) { st.delete(id); }).then(function () { return loadDiagrams(cur().id); }).then(function () { renderDiaList(); renderSummary(); }); }, 4000);
  });
  $('norEvent').addEventListener('change', function (e) { sset('norCur', e.target.value); render(); });
  $('norNewBtn').addEventListener('click', function () {
    var n = $('norNewName').value.trim(); if (!n) { toast('Type the event name first.'); return; }
    var e = events(), ev = { id: 'ev' + uid(), name: n }; e.push(ev); saveEvents(e); sset('norCur', ev.id); $('norNewName').value = ''; render(); toast('Event created: ' + n);
  });
  $('norDelEvent').addEventListener('click', function () {
    var c = cur(); if (!c) return;
    toast('Delete ' + c.name + ' and its PDFs?', 'Delete', function () {
      docsFor(c.id).then(function (d) { return tx('readwrite', function (s) { d.forEach(function (x) { s.delete(x.id); }); }); }).then(function () {
        saveEvents(events().filter(function (x) { return x.id !== c.id; })); sset('norCur', null); render();
      });
    }, 4000);
  });
  $('norFile').addEventListener('change', function (e) {
    var c = cur(), files = [].slice.call(e.target.files || []); e.target.value = '';
    if (!c) { toast('Create an event first.'); return; }
    Promise.all(files.map(function (f) { return tx('readwrite', function (s) { s.put({ id: 'd' + uid(), eventId: c.id, name: f.name, size: f.size, added: Date.now(), blob: f }); }); }))
      .then(function () { renderDocs(); toast(files.length + ' PDF added'); }).catch(function (err) { toast('Could not save PDF: ' + err.message); });
  });
  document.addEventListener('click', function (e) {
    var o = e.target.closest && e.target.closest('[data-open-doc],[data-del-doc]'); if (!o) return;
    if (o.dataset.openDoc) {
      tx('readonly', function (s) { return s.get(o.dataset.openDoc); }).then(function (d) { if (d) window.open(URL.createObjectURL(d.blob), '_blank'); });
    } else {
      var id = o.dataset.delDoc; toast('Delete this PDF?', 'Delete', function () { tx('readwrite', function (s) { s.delete(id); }).then(renderDocs); }, 4000);
    }
  });
  $('norCopy').addEventListener('click', function () {
    var c = cur(); if (!c) { toast('Create an event first.'); return; }
    $('norInfo').textContent = 'Reading PDFs…';
    docsFor(c.id).then(function (d) {
      if (!d.length) throw new Error('Add the NoR / SI PDFs first');
      return Promise.all(d.map(function (x) { return pdfText(x.blob).then(function (t) { return { name: x.name, text: t }; }); }));
    }).then(function (texts) {
      var chars = texts.reduce(function (n, t) { return n + t.text.trim().length; }, 0);
      var scanned = texts.filter(function (t) { return t.text.trim().length < 200; }).map(function (t) { return t.name; });
      c.docNames = texts.map(function (t) { return t.name; }).join(', ');
      saveEvents(events().map(function (x) { return x.id === c.id ? Object.assign(x, { docNames: c.docNames }) : x; }));
      var prompt = buildPrompt(c, texts);
      return navigator.clipboard.writeText(prompt).then(function () {
        $('norInfo').textContent = 'Prompt copied (' + (chars < 1000 ? chars + ' characters' : Math.round(chars / 1000) + 'k characters') + ' from ' + texts.length + ' PDF). Paste it in Claude.' +
          (scanned.length ? ' Note: ' + scanned.join(', ') + ' looks scanned (no text) — attach that PDF in Claude too.' : '');
        toast('Prompt copied. Open Claude and paste');
      });
    }).catch(function (err) { $('norInfo').textContent = err.message; toast(err.message); });
  });
  $('norSave').addEventListener('click', function () {
    var c = cur(); if (!c) { toast('Create an event first.'); return; }
    try {
      var S = parseAnswer($('norPaste').value);
      saveEvents(events().map(function (x) { return x.id === c.id ? Object.assign(x, { summary: S, summaryAt: Date.now() }) : x; }));
      $('norPaste').value = ''; manage = false; render(); toast('Summary saved');
    } catch (err) { $('norInfo').textContent = 'Could not read the answer: ' + err.message + '. Copy Claude\'s whole reply and try again.'; }
  });
  var qFiles = [];
  $('norAddBtn').addEventListener('click', function () { var q = $('norQuick'); q.classList.toggle('hidden'); if (!q.classList.contains('hidden')) { manage = false; render(); q.classList.remove('hidden'); $('norQName').focus(); } });
  $('norQFile').addEventListener('change', function (e) {
    qFiles = qFiles.concat([].slice.call(e.target.files || [])); e.target.value = '';
    $('norQList').innerHTML = qFiles.map(function (f) { return '📄 ' + esc(f.name); }).join('<br>');
  });
  var eLoc = null;
  $('norEHere').addEventListener('click', function () {
    navigator.geolocation.getCurrentPosition(function (p) { eLoc = { lat: p.coords.latitude, lon: p.coords.longitude, name: 'Here (' + p.coords.latitude.toFixed(3) + ', ' + p.coords.longitude.toFixed(3) + ')' }; $('norEPlace').value = eLoc.name; }, function () { toast('Location not available'); }, { timeout: 10000, maximumAge: 300000 });
  });
  $('norEPlace').addEventListener('input', function () { eLoc = null; });
  $('norESave').addEventListener('click', function () {
    var c = cur(); if (!c) return;
    var q = $('norEPlace').value.trim(), keep = c.loc && q === c.loc.name;
    var lp = eLoc ? Promise.resolve(eLoc) : keep ? Promise.resolve(c.loc) : (q ? geocode(q) : Promise.resolve(null));
    lp.then(function (loc) {
      var f = $('norEFrom').value || null, t = $('norETo').value || f;
      saveEvents(events().map(function (x) { return x.id === c.id ? Object.assign(x, { dateFrom: f, dateTo: t, loc: loc, fc: null }) : x; }));
      manage = false; render(); toast('Saved' + (loc ? ': ' + loc.name : ''));
    }).catch(function (e) { toast(e.message); });
  });
  var qLoc = null;
  $('norQHere').addEventListener('click', function () {
    navigator.geolocation.getCurrentPosition(function (p) { qLoc = { lat: p.coords.latitude, lon: p.coords.longitude, name: 'Here (' + p.coords.latitude.toFixed(3) + ', ' + p.coords.longitude.toFixed(3) + ')' }; $('norQPlace').value = ''; $('norQPlaceInfo').textContent = '📍 ' + qLoc.name; },
      function () { toast('Location not available'); }, { timeout: 10000, maximumAge: 300000 });
  });
  $('norQPlace').addEventListener('change', function () { qLoc = null; $('norQPlaceInfo').textContent = ''; });
  $('norQFrom').addEventListener('change', function () { if (!$('norQTo').value || $('norQTo').value < $('norQFrom').value) $('norQTo').value = $('norQFrom').value; });
  $('norQGo').addEventListener('click', function () {
    var n = $('norQName').value.trim();
    if (!n) { toast('Type the event name first.'); $('norQName').focus(); return; }
    var placeQ = $('norQPlace').value.trim();
    var locP = qLoc ? Promise.resolve(qLoc) : (placeQ ? geocode(placeQ).catch(function () { toast('Place not found, forecast needs a place'); return null; }) : Promise.resolve(null));
    locP.then(function (loc) {
    var e = events(), ev = { id: 'ev' + uid(), name: n, dateFrom: $('norQFrom').value || null, dateTo: $('norQTo').value || $('norQFrom').value || null, loc: loc }; e.push(ev); saveEvents(e); sset('norCur', ev.id);
    $('norQFrom').value = ''; $('norQTo').value = ''; $('norQPlace').value = ''; $('norQPlaceInfo').textContent = ''; qLoc = null;
    if (!qFiles.length) { $('norQuick').classList.add('hidden'); render(); toast('Event created'); return; }
    var files = qFiles; qFiles = []; $('norQList').innerHTML = ''; $('norQName').value = '';
    $('norQuick').classList.add('hidden'); render();
    var info = $('norQInfo'); $('norQuick').classList.add('hidden');
    addDocs(ev, files).then(function () { return summarize(ev, $('norInfo2')); });
    });
  });
  $('norAiUrl').value = sget('aiUrl', '') || AI_URL_DEFAULT;
  $('norAiUrl').addEventListener('change', function (e) { sset('aiUrl', e.target.value.trim()); toast('AI server saved'); });
  $('norAmend').addEventListener('change', function (e) {
    var c = cur(), files = [].slice.call(e.target.files || []); e.target.value = '';
    if (!c || !files.length) return;
    addDocs(c, files).then(function () { toast(files.length + ' document added'); return summarize(c, $('norInfo2')); });
  });
  $('norRedo').addEventListener('click', function () { var c = cur(); if (c) summarize(c, $('norInfo2')); });
  function seedSample() {
    var S = window.RA_SAMPLE_EVENT; if (!S || sget('norSampleSeeded', false)) return Promise.resolve();
    sset('norSampleSeeded', true);
    var e = events(); if (e.some(function (x) { return x.id === S.id; })) return Promise.resolve();
    e.unshift({ id: S.id, name: S.name, summary: S.summary, summaryAt: Date.now(), docNames: S.docNames, sample: true }); saveEvents(e);
    if (!sget('norCur', null)) sset('norCur', S.id);
    return Promise.all((S.docs || []).map(function (d) {
      return fetch(d.url).then(function (r) { return r.blob(); }).then(function (b) {
        return tx('readwrite', function (s) { s.put({ id: 'd' + uid(), eventId: S.id, name: d.name, size: b.size, added: Date.now(), blob: b }); });
      }).catch(function () {});
    }));
  }
  setTimeout(function () { seedSample().then(render, render); }, 0);
  window.NorSI = { render: render, _parse: parseAnswer, _prompt: buildPrompt };
})();
