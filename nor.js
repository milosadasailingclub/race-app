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
  var AI_URL_DEFAULT = '';
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
      }).catch(function (err) { busy = false; renderSummary(); info('Summary failed: ' + err.message); toast('Summary failed'); });
  }
  function addDocs(ev, files) {
    return Promise.all(files.map(function (f) { return tx('readwrite', function (s) { s.put({ id: 'd' + uid(), eventId: ev.id, name: f.name, size: f.size, added: Date.now(), blob: f }); }); }));
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
    var S = c.summary;
    if (!S) { box.innerHTML = '<div class="nor-empty"><h2>' + esc(c.name) + '</h2><p>' + (busy ? 'Making the summary…' : 'No summary yet. Add the NoR / SI below and tap Refresh summary.') + '</p></div>'; return; }
    var SMP = window.RA_SAMPLE_EVENT, diagrams = (c.diagramUrls || (SMP && c.id === SMP.id ? SMP.diagramUrls : null) || []).map(function (u) { return { src: u, caption: 'From the SI (Addendum B)' }; }).concat(diaCache[c.id] || []);
    var k = S.key || {}, h = '';
    h += '<div class="nor-title"><b>' + esc(S.event || c.name) + '</b><span>' + esc([S.venue, S.dates].filter(Boolean).join(' · ')) + '</span></div>';
    var tiles = [['First warning', k.first_warning], ['VHF', k.vhf], ['Time limit', k.time_limit], ['Penalty', k.penalty]].filter(function (x) { return x[1]; });
    if (tiles.length) h += '<div class="nor-tiles">' + tiles.map(function (x) { return '<div class="nor-tile"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>';
    if (S.changes && S.changes.filter(Boolean).length) h += '<div class="nor-changes"><h3>Amendments</h3>' + list(S.changes) + '</div>';
    if ((S.courses && S.courses.length) || diagrams.length) {
      var C = window.Courses, dh = diagrams.map(function (d) { return '<div class="nor-dia"><img src="' + d.src + '" alt="Course diagram"><span>' + esc(d.caption || 'From the SI / NoR') + '</span></div>'; }).join('');
      h += sec('Courses', (S.course_signal ? '<p class="nor-csig">' + esc(S.course_signal) + '</p>' : '') + dh + (S.courses || []).map(function (co) {
        var pn = C && C.pennantFromName(co.name + ' ' + (co.signal || ''));
        return '<div class="nor-course"><div class="nor-cname">' + (pn ? C.pennant(pn) : '') + '<b>' + esc(co.name) + '</b>' + (co.signal ? '<span class="nor-cs">' + esc(co.signal) + '</span>' : '') + '</div><div class="nor-seq">' + (co.sequence || []).map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('<i>›</i>') + '</div>' + (co.notes ? '<p>' + esc(co.notes) + '</p>' : '') + '</div>';
      }).join(''));
    }
    if (S.marks && S.marks.length) h += sec('Marks', '<ul>' + S.marks.map(function (m) { return '<li><b>' + esc(m.name) + '</b> ' + esc(m.description) + '</li>'; }).join('') + '</ul>');
    h += sec('Start', txt(S.start)) + sec('Finish', txt(S.finish));
    if (S.schedule && S.schedule.length) h += sec('Schedule', S.schedule.map(function (d) { return '<p class="nor-day">' + esc(d.day) + '</p>' + list(d.items); }).join(''));
    h += sec('Time limits', list(S.time_limits)) + sec('Signals', list(S.signals)) + sec('Penalties', txt(S.penalties)) + sec('Protests', txt(S.protests)) +
      sec('Scoring', txt(S.scoring)) + sec('Safety / check-in', list(S.safety)) + sec('Equipment', list(S.equipment)) + sec('Other', list(S.other));
    h += '<p class="small nor-foot">AI summary from ' + esc(c.docNames || 'your documents') + ' · ' + new Date(c.summaryAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '. Always check the official documents.</p>';
    box.innerHTML = h;
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
    if (manage) { renderDocs(); renderDiaList(); }
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
  $('norQGo').addEventListener('click', function () {
    var n = $('norQName').value.trim();
    if (!n) { toast('Type the event name first.'); $('norQName').focus(); return; }
    if (!qFiles.length) { toast('Add the NoR / SI first.'); return; }
    var e = events(), ev = { id: 'ev' + uid(), name: n }; e.push(ev); saveEvents(e); sset('norCur', ev.id);
    var files = qFiles; qFiles = []; $('norQList').innerHTML = ''; $('norQName').value = '';
    $('norQuick').classList.add('hidden'); render();
    var info = $('norQInfo'); $('norQuick').classList.add('hidden');
    addDocs(ev, files).then(function () { return summarize(ev, $('norInfo2')); });
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
