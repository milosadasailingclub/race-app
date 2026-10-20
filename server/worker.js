/* The Race App — AI server (Cloudflare Worker)
   POST /summarize  { name: "Event name", docs: [{ name, type: "application/pdf"|"image/jpeg"|"image/png", data: "<base64>" }] }
   -> { summary: {...} }
   POST /course     { name, cls: "First 18 SE / Seascape 18", docs: [...] }   (Race Map, navigacione trke)
   -> { summary: { class_used, waypoints: [...], start, finish, warnings } }
   Secrets / variables in Cloudflare (Settings -> Variables and Secrets):
     ANTHROPIC_API_KEY  (Secret)  - your Anthropic API key, never in the app
     MODEL              (Text, optional) - Claude model id, e.g. from console.anthropic.com
     MAX_INPUT_TOKENS   (Text, optional) - limit po obradi, podrazumevano 80000 (oko $0.25)
   Zaštita troška: pre obrade server besplatno prebroji tokene (count_tokens) i odbije preveliku obradu.
*/
const ALLOWED = ['https://milosadasailingclub.github.io', 'http://localhost:8765'];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TOKENS_DEFAULT = 80000;   // ulaz po jednoj obradi
const PRICE_IN = 3, PRICE_OUT = 15; // $ po milion tokena (procena za Sonnet), samo za prikaz troška

const SCHEMA = `{
  "event": "", "dates": "",
  "vhf": "",
  "first_warning": "",
  "course_signal": "",
  "courses": [{"name": "", "signal": "", "sequence": ["Start", "1 (port)", "2 (port)", "Finish"], "notes": ""}],
  "start": "",
  "finish": "",
  "diagram_pages": [{"doc": "", "page": 1, "what": "", "box": [0, 0, 1, 1]}],
  "changes": [""]
}`;

const COURSE_SCHEMA = `{
  "class_used": "",
  "courses_in_documents": [""],
  "waypoints": [{"seq": 1, "id": "", "name": "", "type": "start|mark|gate|finish", "side": "port|starboard|pass", "lat": null, "lon": null, "source": "", "note": ""}],
  "start": {"desc": "", "lat": null, "lon": null},
  "finish": {"desc": "", "lat": null, "lon": null},
  "rules": [""],
  "warnings": [""]
}`;
const COURSE_PROMPT = `You prepare the navigation course for ONE boat in a distance / coastal race. The attached documents are the Notice of Race, Sailing Instructions and amendments for "{{NAME}}". Documents in order: {{DOCS}}.
The boat's class is: "{{CLS}}".

1. Find the course that applies to this class (the documents may list several courses for different classes). Put its title in "class_used" and the titles of all courses you saw in "courses_in_documents". If no course clearly matches the class, use the closest one and say so in "warnings".
2. "waypoints" = that course in sailing order from Start to Finish. For each point:
   - "seq": 1, 2, 3 … in sailing order (Start = 1).
   - "id": the waypoint letter / code if the documents give one (e.g. "D", "E1", "Z"), else "".
   - "name": the name as written (e.g. "Lavdara mala island").
   - "type": "start", "mark", "gate" or "finish".
   - "side": the side to leave the mark on: "port" or "starboard" ("pass" when no side is given, e.g. a passing point or the start / finish).
   - "lat", "lon": decimal degrees (WGS84). Look everywhere in the documents for coordinates, INCLUDING tables of "available waypoints" that may be images, and course lists. Convert degrees + decimal minutes (43°55.01'N) or degrees-minutes-seconds to decimal degrees (south / west negative). If a point has coordinates in two forms, prefer the decimal degrees and check they agree. NEVER guess or estimate coordinates from a map drawing; use null when no coordinates are written.
   - "source": where the coordinates come from (e.g. "Attachment A table", "course list").
   - "note": only if useful (one short line).
3. Cross-check the written list with any course DIAGRAM: if the diagram numbers more points than the list (e.g. a point 2 drawn between the start and point 3), insert that point in the right place with "name": "Point N (on the course diagram, not named in the text)", lat/lon null, and add a line in "warnings".
4. "start" / "finish": a one-line description of the line (between what and what) and coordinates only if written.
5. "rules": up to 6 short lines from the documents that matter for navigating this course: penalties for missed / wrong-side marks, shortened course signals (e.g. flag C), time limits, position reporting duties, prohibited areas, night rules.
6. "warnings": anything uncertain or missing.

Exact values only, never invent anything. Short phrases, language of the documents.
Answer with ONLY one JSON object in exactly this structure, nothing before or after:
{{SCHEMA}}`;

function fill(tpl, name, docNames) { return tpl.split('{{NAME}}').join(name).split('{{DOCS}}').join(docNames.join(' | ')).split('{{SCHEMA}}').join(SCHEMA); }
function prompt(name, docNames) { return fill(BUILTIN, name, docNames); }
// Uputstvo se čita sa GitHub-a (server/prompt.txt), pa ga menjamo bez ponovnog postavljanja servera.
const PROMPT_URL = 'https://raw.githubusercontent.com/milosadasailingclub/race-app/main/server/prompt.txt';
let promptCache = { t: 0, text: null };
async function livePrompt(name, docNames) {
  if (!promptCache.text || Date.now() - promptCache.t > 600000) {
    try { const r = await fetch(PROMPT_URL, { cf: { cacheTtl: 300 } }); if (r.ok) { const t = await r.text(); if (t.includes('{{SCHEMA}}')) promptCache = { t: Date.now(), text: t }; } } catch (e) {}
  }
  return fill(promptCache.text || BUILTIN, name, docNames);
}
const BUILTIN = `You help a racing sailor ON THE WATER. The attached documents are the Notice of Race, Sailing Instructions and amendments for "{{NAME}}". Documents in order: {{DOCS}}.

Give ONLY what the crew needs between the warning signal and the finish. Nothing else (no entry fees, protests, scoring, prizes, safety lists, schedules except the first warning time).

Fields:
- vhf: race committee VHF channel (e.g. "72"). Empty if not stated.
- first_warning: time of the first warning signal (e.g. "11:55, day 1"). Short.
- course_signal: one short line: HOW the course is shown to competitors (e.g. "Numeral pennant on the committee boat before the warning signal", "Board with course number", "VHF 72").
- courses: every course. "name" (e.g. "Course 1" or "Windward-Leeward 2 laps"), "signal" = exactly what is displayed for that course (e.g. "Numeral pennant 1", "Flag W"), "sequence" = the exact order of marks from Start to Finish with rounding side, every lap written out (e.g. ["Start","1 (port)","2 (port)","1 (port)","Finish"]; gates as "2s/2p gate"). "notes" only if essential (max one short line).
- start: one or two short lines: where the start line is (between what and what), and the start signal system if special.
- finish: one or two short lines: where the finish line is.
- diagram_pages: the page(s) where the COURSE DIAGRAMS are drawn. "doc" = the exact document title from the list above, "page" = page number (1 = first page), "what" = e.g. "Course 1 and 2 diagram". Empty list if there are no drawings.
- changes: only amendments that change one of the fields above, one short line each.

Exact values only, never guess; leave a field empty if not stated. Use amended values when an amendment changes something. Short phrases, language of the documents.
Answer with ONLY one JSON object in exactly this structure, nothing before or after:
{{SCHEMA}}`;

// Model: MODEL iz podešavanja, ili automatski najnoviji Sonnet sa liste modela koje tvoj nalog vidi
let cachedModel = null;
async function pickModel(env, force) {
  if (env.MODEL) return env.MODEL;
  if (cachedModel && !force) return cachedModel;
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } });
    const j = await r.json();
    const ids = (j.data || []).map(m => m.id);
    cachedModel = ids.find(id => /sonnet/i.test(id)) || ids.find(id => /opus/i.test(id)) || ids[0] || null;
  } catch (e) { cachedModel = null; }
  return cachedModel;
}

function cors(origin) {
  const ok = ALLOWED.includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function json(obj, status, origin) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } }); }

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'race-app-ai', model: env.ANTHROPIC_API_KEY ? await pickModel(env) : 'no key' }, 200, origin);
    const isCourse = url.pathname === '/course';
    if (req.method !== 'POST' || (url.pathname !== '/summarize' && !isCourse)) return json({ error: 'Not found' }, 404, origin);
    if (!ALLOWED.includes(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Server has no API key yet' }, 500, origin);
    const len = +(req.headers.get('Content-Length') || 0); if (len > MAX_BYTES) return json({ error: 'Documents too large (max 20 MB). Upload only the NoR, SI and amendments.', code: 'too_long' }, 413, origin);
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'Bad request' }, 400, origin); }
    const name = String(body.name || 'Regatta').slice(0, 80), docs = Array.isArray(body.docs) ? body.docs : [];
    if (docs.length > 6) return json({ error: 'Too many documents (max 6). Upload only the NoR, SI and amendments.', code: 'too_many' }, 413, origin);
    if (!docs.length) return json({ error: 'No documents' }, 400, origin);
    const content = [];
    for (const d of docs) {
      const t = String(d.type || '');
      if (t === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data }, title: String(d.name || 'document').slice(0, 100) });
      else if (/^image\/(jpeg|png|gif|webp)$/.test(t)) content.push({ type: 'image', source: { type: 'base64', media_type: t, data: d.data } });
      else if (t === 'text/plain') content.push({ type: 'text', text: '===== ' + (d.name || 'document') + ' =====\n' + String(d.data).slice(0, 200000) });
    }
    if (!content.length) return json({ error: 'Unsupported file type (use PDF or a photo)' }, 400, origin);
    const dn = docs.map(d => String(d.name || 'document'));
    if (isCourse) content.push({ type: 'text', text: COURSE_PROMPT.split('{{NAME}}').join(name).split('{{DOCS}}').join(dn.join(' | ')).split('{{CLS}}').join(String(body.cls || 'not given').slice(0, 80)).split('{{SCHEMA}}').join(COURSE_SCHEMA) });
    else content.push({ type: 'text', text: await livePrompt(name, dn) });
    const H = { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    const call = (model) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: H,
      body: JSON.stringify({ model, max_tokens: isCourse ? 6000 : 4000, messages: [{ role: 'user', content }] })
    });
    let model = await pickModel(env);
    if (!model) return json({ error: 'No AI model available for this key' }, 502, origin);
    // zaštita troška: besplatno brojanje tokena pre prave obrade
    const maxIn = +(env.MAX_INPUT_TOKENS || MAX_TOKENS_DEFAULT);
    try {
      const ct = await fetch('https://api.anthropic.com/v1/messages/count_tokens', { method: 'POST', headers: H, body: JSON.stringify({ model, messages: [{ role: 'user', content }] }) });
      const cj = await ct.json().catch(() => ({}));
      if (ct.ok && cj.input_tokens > maxIn) return json({ error: 'Operation too complex: the documents are too long for one summary. Upload only the NoR, SI and amendments.', code: 'too_complex', tokens: cj.input_tokens, max: maxIn }, 413, origin);
    } catch (e) {}
    let r = await call(model);
    let out = await r.json().catch(() => ({}));
    if (!r.ok && /model/i.test((out.error && out.error.message) || '') && !env.MODEL) {
      model = await pickModel(env, true);   // model povučen ili preimenovan: uzmi ponovo listu i probaj još jednom
      if (model) { r = await call(model); out = await r.json().catch(() => ({})); }
    }
    if (!r.ok) return json({ error: 'AI error: ' + ((out.error && out.error.message) || r.status) }, 502, origin);
    const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return json({ error: 'AI answer had no summary' }, 502, origin);
    const u = out.usage || {}, usage = { in: u.input_tokens || 0, out: u.output_tokens || 0 };
    usage.usd = Math.round(((usage.in * PRICE_IN + usage.out * PRICE_OUT) / 1e6) * 1000) / 1000;
    try { return json({ summary: JSON.parse(text.slice(a, b + 1)), usage, model }, 200, origin); }
    catch (e) { return json({ error: 'AI answer could not be read' }, 502, origin); }
  }
};
