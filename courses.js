/* The Race App — numeral pennant flags + schematic course diagrams (SVG) */
(function () {
  'use strict';
  var RED = '#d7141a', BLUE = '#1f4fb4', YEL = '#f7c600', BLK = '#111', WHT = '#fff';
  // pennant 0..9 (International Code of Signals). Shape: hoist 40 high, tapering to 90 long.
  function pennant(n, h) {
    h = h || 34; var w = h * 2.3, id = 'pn' + n + Math.random().toString(36).slice(2, 6);
    var shape = 'M0 0 L' + w + ' ' + (h * 0.38) + ' L' + w + ' ' + (h * 0.62) + ' L0 ' + h + ' Z';
    var body = '';
    var R = function (x, y, ww, hh, c) { return '<rect x="' + x + '" y="' + y + '" width="' + ww + '" height="' + hh + '" fill="' + c + '"/>'; };
    switch (+n) {
      case 1: body = R(0, 0, w, h, WHT) + '<circle cx="' + (h * 0.55) + '" cy="' + (h / 2) + '" r="' + (h * 0.26) + '" fill="' + RED + '"/>'; break;
      case 2: body = R(0, 0, w, h, BLUE) + '<circle cx="' + (h * 0.55) + '" cy="' + (h / 2) + '" r="' + (h * 0.26) + '" fill="' + WHT + '"/>'; break;
      case 3: body = R(0, 0, w / 3, h, RED) + R(w / 3, 0, w / 3, h, WHT) + R(2 * w / 3, 0, w / 3, h, BLUE); break;
      case 4: body = R(0, 0, w, h, RED) + R(h * 0.45, 0, h * 0.2, h, WHT) + R(0, h * 0.4, w, h * 0.2, WHT); break;
      case 5: body = R(0, 0, w / 2, h, YEL) + R(w / 2, 0, w / 2, h, BLUE); break;
      case 6: body = R(0, 0, w, h / 2, BLK) + R(0, h / 2, w, h / 2, WHT); break;
      case 7: body = R(0, 0, w, h / 2, YEL) + R(0, h / 2, w, h / 2, RED); break;
      case 8: body = R(0, 0, w, h, WHT) + R(h * 0.45, 0, h * 0.2, h, RED) + R(0, h * 0.4, w, h * 0.2, RED); break;
      case 9: body = R(0, 0, w / 2, h / 2, WHT) + R(w / 2, 0, w / 2, h / 2, BLK) + R(0, h / 2, w / 2, h / 2, RED) + R(w / 2, h / 2, w / 2, h / 2, YEL); break;
      default: body = R(0, 0, w / 3, h, YEL) + R(w / 3, 0, w / 3, h, RED) + R(2 * w / 3, 0, w / 3, h, YEL);
    }
    return '<svg class="pennant" viewBox="-3 -2 ' + (w + 6) + ' ' + (h + 4) + '" width="' + Math.round(w + 6) + '" height="' + Math.round(h + 4) + '" role="img" aria-label="Numeral pennant ' + n + '">' +
      '<defs><clipPath id="' + id + '"><path d="' + shape + '"/></clipPath></defs><line x1="-2" y1="-2" x2="-2" y2="' + (h + 2) + '" stroke="#888" stroke-width="2"/>' +
      '<g clip-path="url(#' + id + ')">' + body + '</g><path d="' + shape + '" fill="none" stroke="#9aa3ad" stroke-width="1"/></svg>';
  }
  function pennantFromName(name) { var m = /(?:numeral\s*)?pennant\s*(\d)/i.exec(name || '') || /^\s*(\d)\s*$/.exec(name || ''); return m ? m[1] : null; }

  // schematic trapezoid / windward-leeward positions (wind from top)
  var POS = { '1': [150, 36], '2': [250, 92], '3': [250, 250], '4': [96, 250] };
  var START = [[100, 212], [196, 212]], FINISH = [[196, 188], [266, 188]];
  function key(m) { var s = String(m).toLowerCase(); if (/start/.test(s)) return 'S'; if (/finish/.test(s)) return 'F'; var d = /^\s*(\d)/.exec(s); return d ? d[1] : null; }
  function isGate(m) { return /gate|\bp\/s\b/i.test(m); }
  function courseSvg(seq) {
    var keys = (seq || []).map(key); if (!keys.length || keys.some(function (k) { return !k || (k !== 'S' && k !== 'F' && !POS[k]); })) return '';
    var gates = {}; (seq || []).forEach(function (m) { var k = key(m); if (POS[k] && isGate(m)) gates[k] = 1; });
    var mid = function (l) { return [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]; };
    var pt = function (k) { return k === 'S' ? mid(START) : k === 'F' ? mid(FINISH) : POS[k]; };
    var svg = '<svg class="course-svg" viewBox="0 0 320 290" role="img" aria-label="Course diagram (schematic)">';
    svg += '<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>';
    // wind arrow
    svg += '<g transform="translate(26 14)"><path d="M0 0 L0 30" stroke="#86949d" stroke-width="2" marker-end="url(#ah)"/><text x="8" y="12" font-size="10" fill="#86949d">WIND</text></g>';
    // legs
    for (var i = 1; i < keys.length; i++) {
      var a = pt(keys[i - 1]), b = pt(keys[i]), up = b[1] < a[1] - 5;
      var off = (i % 2 ? 1 : -1) * 6, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / L * off, ny = dx / L * off;
      var sh = 14 / L;
      svg += '<line x1="' + (a[0] + nx + dx * sh) + '" y1="' + (a[1] + ny + dy * sh) + '" x2="' + (b[0] + nx - dx * sh) + '" y2="' + (b[1] + ny - dy * sh) + '" stroke="' + (up ? '#00e0c6' : '#ff2e93') + '" stroke-width="2.2" stroke-dasharray="' + (up ? '0' : '6 4') + '" marker-end="url(#ah)" opacity=".9"/>';
      var mx = (a[0] + b[0]) / 2 + nx * 2.2, my = (a[1] + b[1]) / 2 + ny * 2.2;
      svg += '<circle cx="' + mx + '" cy="' + my + '" r="8" fill="#05070a" stroke="' + (up ? '#00e0c6' : '#ff2e93') + '"/><text x="' + mx + '" y="' + (my + 3.5) + '" font-size="10" font-weight="700" text-anchor="middle" fill="#eef3f5">' + i + '</text>';
    }
    // start / finish lines
    var line = function (l, col, lbl) { return '<line x1="' + l[0][0] + '" y1="' + l[0][1] + '" x2="' + l[1][0] + '" y2="' + l[1][1] + '" stroke="' + col + '" stroke-width="2" stroke-dasharray="3 3"/><rect x="' + (l[1][0] - 6) + '" y="' + (l[1][1] - 6) + '" width="12" height="8" rx="2" fill="' + col + '"/><text x="' + (l[1][0] + 10) + '" y="' + (l[1][1] + 1) + '" font-size="10" font-weight="700" fill="' + col + '">' + lbl + '</text><circle cx="' + l[0][0] + '" cy="' + l[0][1] + '" r="4" fill="' + col + '"/>'; };
    if (keys.indexOf('S') >= 0) svg += line(START, '#f2994a', 'START');
    if (keys.indexOf('F') >= 0) svg += line(FINISH, '#4d8dff', 'FINISH');
    // marks
    Object.keys(POS).forEach(function (k) {
      if (keys.indexOf(k) < 0) return; var p = POS[k];
      if (gates[k]) {
        svg += '<circle cx="' + (p[0] - 14) + '" cy="' + p[1] + '" r="6" fill="#eef3f5" stroke="#d7141a" stroke-width="2"/><circle cx="' + (p[0] + 14) + '" cy="' + p[1] + '" r="6" fill="#eef3f5" stroke="#d7141a" stroke-width="2"/>' +
          '<text x="' + p[0] + '" y="' + (p[1] + 22) + '" font-size="11" font-weight="800" text-anchor="middle" fill="#eef3f5">' + k + 's / ' + k + 'p</text>';
      } else {
        svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="8" fill="#f7c600"/><text x="' + (p[0] + 13) + '" y="' + (p[1] + 4) + '" font-size="12" font-weight="800" fill="#eef3f5">' + k + '</text>';
      }
    });
    svg += '<text x="310" y="284" font-size="9" text-anchor="end" fill="#86949d">schematic · marks to port · check SI diagram</text></svg>';
    return svg;
  }
  window.Courses = { pennant: pennant, pennantFromName: pennantFromName, svg: courseSvg };
})();
