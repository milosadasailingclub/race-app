/* The Race App — My profile: korisnik, plan (Free / Pro) i krediti.
   PREGLED: plan i krediti su za sada lokalni, probni podaci. Prava prijava, baza kredita i plaćanje idu na server (Cloudflare + Stripe)
   pre objave; tada server pre svakog AI poziva proverava i skida kredite.
   Krediti se troše samo na AI funkcije (NoR/SI sažetak, čitanje rute iz SI); prognoza, idealna ruta, tracking i debrief ne troše kredite. */
(function () {
  'use strict';
  var PLANS = {
    free: { name: 'Free', price: '0 €', credits: 15 },
    pro: { name: 'Pro', price: '20 € / month', credits: 100 }
  };
  var COST = { nor: 5, course: 5 };
  function $(id) { return document.getElementById(id); }
  function sget(k, d) { try { var v = localStorage.getItem('ra.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function sset(k, v) { try { localStorage.setItem('ra.' + k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function prof() { var p = sget('profile', null) || {}; if (!p.first && !p.last && sget('myName', '')) { var a = String(sget('myName', '')).trim().split(/\s+/); p.first = a.shift() || ''; p.last = a.join(' '); } return p; }
  function plan() { return sget('plan', 'free') === 'pro' ? 'pro' : 'free'; }
  function monthStart() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
  function renewal() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  // potrošnja ovog meseca iz onoga što je aplikacija stvarno uradila (sažeci NoR/SI, AI čitanje rute)
  function usage() {
    var out = [], m0 = monthStart();
    (sget('norEvents', []) || []).forEach(function (e) {
      if (e.sample) return;
      if (e.summaryAt && e.summaryAt >= m0) out.push({ t: e.summaryAt, what: 'NoR / SI summary', ev: (e.summary && e.summary.event) || e.name, c: COST.nor });
      (e.courses || []).forEach(function (c) { if (c.ai && c.ai.at >= m0) out.push({ t: c.ai.at, what: 'Course read from SI', ev: e.name, c: COST.course }); });
    });
    return out.sort(function (a, b) { return b.t - a.t; });
  }
  function bought() { return +sget('creditsBought', 0) || 0; }
  function balance() { var P = PLANS[plan()], used = usage().reduce(function (s, u) { return s + u.c; }, 0); return { total: P.credits + bought(), used: used, left: Math.max(0, P.credits + bought() - used) }; }

  function render() {
    var box = $('acctBody'); if (!box) return;
    var p = prof(), pl = plan(), P = PLANS[pl], B = balance(), U = usage(), pct = B.total ? Math.round(B.left / B.total * 100) : 0;
    var h = '<div class="acc-grid">' +
      '<label class="prof-row">First name<input id="acFirst" type="text" maxlength="30" value="' + esc(p.first || '') + '" placeholder="Miloš"></label>' +
      '<label class="prof-row">Last name<input id="acLast" type="text" maxlength="40" value="' + esc(p.last || '') + '" placeholder="Dobrosavljević"></label>' +
      '<label class="prof-row">Email<input id="acEmail" type="email" maxlength="80" value="' + esc(p.email || '') + '" placeholder="name@club.com"></label>' +
      '<label class="prof-row">Club<input id="acClub" type="text" maxlength="50" value="' + esc(p.club || '') + '" placeholder="Ada Sailing Club"></label></div>';
    h += '<div class="acc-plan ' + pl + '"><div class="acc-ph"><span class="acc-badge">' + P.name.toUpperCase() + '</span><span class="small">' + P.price + (pl === 'pro' ? ' · renews ' + renewal().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '') + '</span></div>' +
      '<div class="acc-cr"><b>' + B.left + '</b><span>of ' + B.total + ' credits left this month</span></div>' +
      '<div class="acc-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="row acc-btns">' + (pl === 'free' ? '<button class="btn primary" id="acUp">Upgrade to Pro</button>' : '') + '<button class="btn" id="acBuy">Buy 50 credits · 5 €</button></div></div>';
    h += '<details class="acc-more"><summary>Credits used this month (' + B.used + ')</summary>' +
      (U.length ? U.map(function (u) { return '<div class="acc-u"><span>' + new Date(u.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</span><span>' + esc(u.what) + '<small>' + esc(u.ev || '') + '</small></span><b>−' + u.c + '</b></div>'; }).join('') : '<p class="small">Nothing yet this month.</p>') +
      '</details>';
    h += '<details class="acc-more"><summary>What uses credits</summary><div class="acc-u"><span></span><span>NoR / SI summary (AI)</span><b>' + COST.nor + '</b></div><div class="acc-u"><span></span><span>Course read from SI (AI)</span><b>' + COST.course + '</b></div>' +
      '<p class="small">Free, no credits: forecast, wind map, ideal route, tracking, replay and debrief. Monthly credits reset on the 1st; bought credits never expire. Free: ' + PLANS.free.credits + ' credits a month · Pro: ' + PLANS.pro.credits + '.</p></details>';
    h += '<p class="small acc-prev">Preview: sign-in, payments and the real credit balance come with the official release. <a href="#" id="acSwap">Show as ' + (pl === 'pro' ? 'Free' : 'Pro') + '</a></p>';
    box.innerHTML = h;
    var s = $('sum-me'); if (s) s.textContent = [[p.first, p.last ? p.last.charAt(0) + '.' : ''].filter(Boolean).join(' '), P.name, B.left + ' credits'].filter(Boolean).join(' · ');
  }
  function bind() {
    var box = $('acctBody'); if (!box) return;
    box.addEventListener('change', function (e) {
      var id = e.target.id, p = prof(), map = { acFirst: 'first', acLast: 'last', acEmail: 'email', acClub: 'club' };
      if (!map[id]) return; p[map[id]] = e.target.value.trim(); sset('profile', p);
      // ime za prepoznavanje u rezultatima regata (Debrief)
      if (id === 'acFirst' || id === 'acLast') sset('myName', [p.first, p.last].filter(Boolean).join(' '));
      render();
    });
    box.addEventListener('click', function (e) {
      var t = e.target, toast = window.RA && window.RA.toast;
      if (t.id === 'acUp') { if (toast) toast('Pro subscription opens with the official release.'); return; }
      if (t.id === 'acBuy') { if (toast) toast('Buying credits opens with the official release.'); return; }
      if (t.id === 'acSwap') { e.preventDefault(); sset('plan', plan() === 'pro' ? 'free' : 'pro'); render(); }
    });
  }
  window.Account = { render: render, plan: plan, balance: balance, cost: COST };
  if (document.readyState !== 'loading') { bind(); render(); } else document.addEventListener('DOMContentLoaded', function () { bind(); render(); });
})();
