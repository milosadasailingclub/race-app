/* The Race App — Checklist (My lists / Public lists) */
(function () {
  'use strict';
  var SUBS = [
    ['clothing', 'Clothing'], ['boat', 'Boat'], ['tools', 'Tools'], ['transport', 'Transport'],
    ['other', 'Other'], ['fnb', 'F&B'], ['medical', 'Medical']
  ];
  var PUBLIC = window.RA_PUBLIC_LISTS || [];

  var R = function () { return window.RA; };
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function uid() { return Math.random().toString(36).slice(2, 9); }

  function toInternal(def) {
    return {
      id: def.id, name: def.name, cls: def.cls || '', pub: def.pub !== false && def.id.indexOf('pub-') === 0, draft: !!def.draft, source: def.source || '',
      subs: SUBS.map(function (s) {
        return { id: s[0], name: s[1], items: (def.subs[s[0]] || []).map(function (t, i) {
          return t.charAt(0) === '#' ? { id: s[0] + i, t: t.slice(1).trim(), h: true } : { id: s[0] + i, t: t };
        }) };
      })
    };
  }
  var PUB = PUBLIC.map(toInternal);
  function myLists() { return R().store.get('clMy', []); }
  function saveMy(l) { R().store.set('clMy', l); }
  function checks() { return R().store.get('clChecks', {}); }
  function saveChecks(c) { R().store.set('clChecks', c); }
  function findList(id) {
    var p = PUB.filter(function (l) { return l.id === id; })[0];
    return p || myLists().filter(function (l) { return l.id === id; })[0] || null;
  }
  function progress(list, sub) {
    var c = checks()[list.id] || {}, n = 0, d = 0, na = 0;
    (sub ? [sub] : list.subs).forEach(function (s) { s.items.forEach(function (it) { if (it.h) return; n++; if (c[it.id]) d++; if (c[it.id] === 2) na++; }); });
    return { n: n, d: d, na: na, done: n > 0 && d === n };
  }

  // navigation state
  var st = { tab: 'my', list: null, sub: null, edit: false };

  function render() {
    var b = $('clBody'), html = '';
    $('clEdit').classList.add('hidden');
    if (!st.list) {
      $('clTitle').textContent = 'CHECKLIST';
      html += '<div class="seg"><button data-cltab="my" class="' + (st.tab === 'my' ? 'on' : '') + '">MY LISTS</button><button data-cltab="pub" class="' + (st.tab === 'pub' ? 'on' : '') + '">PUBLIC LISTS</button></div>';
      var lists = st.tab === 'my' ? myLists() : PUB;
      if (!lists.length) html += '<p class="small" style="padding:4px 2px">No lists yet. Create one from the empty template, or copy a public list.</p>';
      lists.forEach(function (l) {
        var p = progress(l);
        html += '<button class="cl-card' + (p.done ? ' done' : '') + '" data-open="' + esc(l.id) + '"><span class="cl-name">' + esc(l.name) + (l.pub && l.draft ? ' <em class="cl-draft">DRAFT</em>' : '') + '</span>' +
          '<span class="cl-meta">' + (l.cls ? esc(l.cls) + ' · ' : '') + p.d + ' / ' + p.n + '</span>' + bar(p) + '</button>';
      });
      if (st.tab === 'my') html += '<div class="cl-new"><input id="clNewName" type="text" maxlength="30" placeholder="New list name (e.g. Regatta Split)"><button class="btn primary" id="clNewBtn">+ New list</button></div>';
      b.innerHTML = html; return;
    }
    var L = findList(st.list); if (!L) { st.list = null; return render(); }
    if (!L.pub) { $('clEdit').classList.remove('hidden'); $('clEdit').classList.toggle('on', st.edit); }
    if (!st.sub) {
      $('clTitle').textContent = L.name.toUpperCase();
      var P = progress(L);
      html += '<div class="cl-sum"><span>' + P.d + ' / ' + P.n + ' checked</span>' + bar(P) + '</div>';
      if (st.edit) html += '<div class="cl-edit"><input id="clRename" type="text" maxlength="30" value="' + esc(L.name) + '"><button class="btn" id="clRenameBtn">Rename</button><button class="btn danger" id="clDelList">Delete list</button></div>';
      L.subs.forEach(function (s) {
        var p = progress(L, s);
        html += '<button class="cl-card' + (p.done ? ' done' : '') + '" data-sub="' + s.id + '"><span class="cl-name">' + esc(s.name) + '</span><span class="cl-meta">' + (p.n ? p.d + ' / ' + p.n + (p.na ? ' · ' + p.na + ' N/A' : '') : 'empty') + '</span>' + bar(p) + '</button>';
      });
      html += '<div class="row"><button class="btn" id="clReset">Reset all checks</button>' + (L.pub ? '<button class="btn primary" id="clCopy">Copy to My lists</button>' : '') + '</div>';
      if (L.source) html += '<p class="small">' + esc(L.source) + '</p>';
      b.innerHTML = html; return;
    }
    var S = L.subs.filter(function (x) { return x.id === st.sub; })[0], c = checks()[L.id] || {}, ps = progress(L, S);
    $('clTitle').textContent = S.name.toUpperCase();
    html += '<div class="cl-sum' + (ps.done ? ' done' : '') + '"><span>' + esc(L.name) + ' · ' + ps.d + ' / ' + ps.n + (ps.na ? ' · ' + ps.na + ' not needed' : '') + ' · tap N/A if you don\'t need an item</span>' + bar(ps) + '</div><div class="cl-items">';
    if (!S.items.length) html += '<p class="small" style="padding:12px">No items yet.' + (L.pub ? '' : ' Add the first one below.') + '</p>';
    S.items.forEach(function (it) {
      if (it.h) { html += '<div class="cl-h">' + esc(it.t) + (st.edit ? '<button class="cl-del" data-del="' + it.id + '">✕</button>' : '') + '</div>'; return; }
      var stt = c[it.id] === 2 ? ' na' : (c[it.id] ? ' on' : '');
      html += '<div class="cl-item' + stt + '" data-chk="' + it.id + '"><span class="cl-box"></span><span class="cl-t">' + esc(it.t) + '</span>' +
        (st.edit ? '<button class="cl-del" data-del="' + it.id + '">✕</button>' : '<button class="cl-na" data-na="' + it.id + '" aria-label="Not needed">N/A</button>') + '</div>';
    });
    html += '</div><div class="row"><button class="btn" id="clAll">' + (ps.done ? 'Uncheck all' : 'Check all') + '</button></div>';
    if (!L.pub) html += '<div class="cl-new"><input id="clItem" type="text" maxlength="60" placeholder="Add item (start with # for a section title)"><button class="btn primary" id="clAdd">Add</button></div>';
    b.innerHTML = html;
  }
  function bar(p) { return '<span class="cl-bar"><i style="width:' + (p.n ? Math.round(p.d / p.n * 100) : 0) + '%"></i></span>'; }

  function toggle(itemId) {
    var c = checks(), m = c[st.list] || (c[st.list] = {});
    if (m[itemId] === 1) delete m[itemId]; else m[itemId] = 1;
    saveChecks(c);
    var L = findList(st.list), S = L.subs.filter(function (x) { return x.id === st.sub; })[0], was = progress(L, S);
    render();
    if (was.done) { try { navigator.vibrate && navigator.vibrate([40, 60, 40]); } catch (e) {} R().toast(S.name + ' complete ✓'); }
  }
  function toggleNA(itemId) {
    var c = checks(), m = c[st.list] || (c[st.list] = {});
    if (m[itemId] === 2) delete m[itemId]; else m[itemId] = 2;
    saveChecks(c);
    var L = findList(st.list), S = L.subs.filter(function (x) { return x.id === st.sub; })[0];
    render();
    if (progress(L, S).done) { try { navigator.vibrate && navigator.vibrate([40, 60, 40]); } catch (e) {} R().toast(S.name + ' complete ✓'); }
  }
  function mutateMy(fn) { var l = myLists(), L = l.filter(function (x) { return x.id === st.list; })[0]; if (L) { fn(L, l); saveMy(l); } }

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !$('checklist').classList.contains('active')) return;
    var t = e.target.closest('[data-cltab],[data-open],[data-sub],[data-na],[data-chk],[data-del],button');
    if (!t) return;
    if (t.dataset.cltab) { st.tab = t.dataset.cltab; render(); return; }
    if (t.dataset.open) { st.list = t.dataset.open; st.sub = null; st.edit = false; render(); return; }
    if (t.dataset.sub) { st.sub = t.dataset.sub; render(); return; }
    if (t.dataset.del) {
      var id = t.dataset.del; e.stopPropagation();
      mutateMy(function (L) { L.subs.forEach(function (s) { s.items = s.items.filter(function (it) { return it.id !== id; }); }); }); render(); return;
    }
    if (t.dataset.na) { toggleNA(t.dataset.na); return; }
    if (t.dataset.chk) { toggle(t.dataset.chk); return; }
    switch (t.id) {
      case 'clNewBtn':
        var nm = $('clNewName').value.trim() || 'My list';
        var l = myLists(); var nl = toInternal({ id: 'my-' + uid(), name: nm, subs: {} }); l.push(nl); saveMy(l);
        st.list = nl.id; st.sub = null; st.edit = false; render(); R().toast('List created: ' + nm); break;
      case 'clCopy':
        var src = findList(st.list), cp = JSON.parse(JSON.stringify(src)); cp.id = 'my-' + uid(); cp.pub = false; cp.draft = false; cp.name = src.name + ' (my copy)'; cp.source = '';
        var ml = myLists(); ml.push(cp); saveMy(ml); st.tab = 'my'; st.list = cp.id; st.sub = null; render(); R().toast('Copied to My lists'); break;
      case 'clReset':
        R().toast('Reset all checks in this list?', 'Reset', function () { var c = checks(); delete c[st.list]; saveChecks(c); render(); }, 4000); break;
      case 'clAll':
        var L2 = findList(st.list), S2 = L2.subs.filter(function (x) { return x.id === st.sub; })[0], c2 = checks(), m2 = c2[st.list] || (c2[st.list] = {}), pr = progress(L2, S2);
        S2.items.forEach(function (it) { if (it.h) return; if (pr.done) { if (m2[it.id] === 1) delete m2[it.id]; } else if (!m2[it.id]) m2[it.id] = 1; }); saveChecks(c2); render(); break;
      case 'clAdd':
        var v = $('clItem').value.trim(); if (!v) return;
        mutateMy(function (L) { var S3 = L.subs.filter(function (x) { return x.id === st.sub; })[0];
          S3.items.push(v.charAt(0) === '#' ? { id: 'i' + uid(), t: v.slice(1).trim(), h: true } : { id: 'i' + uid(), t: v }); });
        render(); var inp = $('clItem'); if (inp) inp.focus(); break;
      case 'clRenameBtn':
        var rn = $('clRename').value.trim(); if (!rn) return; mutateMy(function (L) { L.name = rn; }); render(); break;
      case 'clDelList':
        R().toast('Delete this list?', 'Delete', function () {
          var dl = myLists().filter(function (x) { return x.id !== st.list; }); saveMy(dl);
          var c = checks(); delete c[st.list]; saveChecks(c); st.list = null; st.sub = null; st.edit = false; render();
        }, 4000); break;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target || !e.target.id) return;
    var map = { clItem: 'clAdd', clNewName: 'clNewBtn', clRename: 'clRenameBtn' };
    if (map[e.target.id]) $(map[e.target.id]).click();
  });

  window.Checklist = {
    open: function () {
      if (!this._wired) {
        this._wired = true;
        $('clBack').addEventListener('click', function () {
          if (st.sub) st.sub = null; else if (st.list) { st.list = null; st.edit = false; } else { R().show('menu'); return; }
          render();
        });
        $('clEdit').addEventListener('click', function () { st.edit = !st.edit; render(); });
      }
      render();
    }
  };
})();
