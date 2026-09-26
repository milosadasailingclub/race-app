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
  function docsFor(evId) { return tx('readonly', function (s) { return s.getAll(); }).then(function (all) { return (all || []).filter(function (d) { return d.eventId === evId; }).sort(function (a, b) { return a.added - b.added; }); }); }

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
    if (!c) { box.innerHTML = '<div class="nor-empty"><h2>NoR / SI</h2><p>No event yet. Tap ✎ to create an event, add the NoR/SI PDFs and make the AI summary.</p></div>'; return; }
    var S = c.summary;
    if (!S) { box.innerHTML = '<div class="nor-empty"><h2>' + esc(c.name) + '</h2><p>No summary yet. Tap ✎ to add PDFs and create the AI summary.</p></div>'; return; }
    var k = S.key || {}, h = '';
    h += '<div class="nor-title"><b>' + esc(S.event || c.name) + '</b><span>' + esc([S.venue, S.dates].filter(Boolean).join(' · ')) + '</span></div>';
    var tiles = [['First warning', k.first_warning], ['VHF', k.vhf], ['Time limit', k.time_limit], ['Penalty', k.penalty]].filter(function (x) { return x[1]; });
    if (tiles.length) h += '<div class="nor-tiles">' + tiles.map(function (x) { return '<div class="nor-tile"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>';
    if (S.changes && S.changes.filter(Boolean).length) h += '<div class="nor-changes"><h3>Amendments</h3>' + list(S.changes) + '</div>';
    if (S.courses && S.courses.length) h += sec('Courses', S.courses.map(function (co) {
      var C = window.Courses, pn = C && C.pennantFromName(co.name), dia = C ? C.svg(co.sequence) : '';
      return '<div class="nor-course"><div class="nor-cname">' + (pn ? C.pennant(pn) : '') + '<b>' + esc(co.name) + '</b></div>' + (dia ? '<div class="nor-dia">' + dia + '</div>' : '') + '<div class="nor-seq">' + (co.sequence || []).map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('<i>›</i>') + '</div>' + (co.notes ? '<p>' + esc(co.notes) + '</p>' : '') + '</div>';
    }).join(''));
    if (S.marks && S.marks.length) h += sec('Marks', '<ul>' + S.marks.map(function (m) { return '<li><b>' + esc(m.name) + '</b> ' + esc(m.description) + '</li>'; }).join('') + '</ul>');
    h += sec('Start', txt(S.start)) + sec('Finish', txt(S.finish));
    if (S.schedule && S.schedule.length) h += sec('Schedule', S.schedule.map(function (d) { return '<p class="nor-day">' + esc(d.day) + '</p>' + list(d.items); }).join(''));
    h += sec('Time limits', list(S.time_limits)) + sec('Signals', list(S.signals)) + sec('Penalties', txt(S.penalties)) + sec('Protests', txt(S.protests)) +
      sec('Scoring', txt(S.scoring)) + sec('Safety / check-in', list(S.safety)) + sec('Equipment', list(S.equipment)) + sec('Other', list(S.other));
    h += '<p class="small nor-foot">AI summary from ' + esc(c.docNames || 'your documents') + ' · ' + new Date(c.summaryAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '. Always check the official documents.</p>';
    box.innerHTML = h;
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
    $('norSummary').classList.toggle('hidden', manage);
    $('norManage').classList.toggle('hidden', !manage);
    $('norManageBtn').classList.toggle('on', manage);
    if (manage) renderDocs();
  }

  /* ---- actions ---- */
  $('norManageBtn').addEventListener('click', function () { manage = !manage; render(); });
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
