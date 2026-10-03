/* The Race App — AI server (Cloudflare Worker)
   POST /summarize  { name: "Event name", docs: [{ name, type: "application/pdf"|"image/jpeg"|"image/png", data: "<base64>" }] }
   -> { summary: {...} }
   Secrets / variables in Cloudflare (Settings -> Variables and Secrets):
     ANTHROPIC_API_KEY  (Secret)  - your Anthropic API key, never in the app
     MODEL              (Text, optional) - Claude model id, e.g. from console.anthropic.com
*/
const ALLOWED = ['https://milosadasailingclub.github.io', 'http://localhost:8765'];
const MAX_BYTES = 25 * 1024 * 1024;

const SCHEMA = `{
  "event": "", "venue": "", "dates": "", "organizer": "",
  "key": {"first_warning": "", "vhf": "", "time_limit": "", "penalty": ""},
  "course_signal": "",
  "courses": [{"name": "", "signal": "", "sequence": ["Start", "1 (port)", "2", "Finish"], "notes": ""}],
  "marks": [{"name": "", "description": ""}],
  "start": "", "finish": "",
  "schedule": [{"day": "", "items": [""]}],
  "time_limits": [""], "signals": [""],
  "penalties": "", "protests": "", "scoring": "",
  "safety": [""], "other": [""],
  "changes": [""]
}`;

function prompt(name) {
  return `You are the tactician's assistant for a racing sailor. The attached documents are the Notice of Race, Sailing Instructions and any amendments for "${name}".
Make a SHORT summary the crew can read quickly ON THE BOAT, during or between races.

Priority order:
1. COURSES: how the course is signalled (flag, numeral pennant, board, VHF) in "course_signal"; then every course with its signal and the exact order of marks from start to finish, with rounding side (port/starboard), gates and repeats written out (e.g. Start, 1 (port), 2 (port), 1 (port), 2 (port), Finish). Read course diagrams in the documents too.
2. Marks (colour/shape), start line, finish line.
3. Key numbers: first warning signal time, VHF channel, time limits, penalty (one-turn / two-turns).
4. Everything else only if useful on the water; one short line each.

Rules: exact values only (times, numbers, colours). If an amendment changes something, use the new value and add a line to "changes". Leave a field empty if not stated; never guess. Write in the language of the documents, short phrases, no full paragraphs.
Answer with ONLY one JSON object in exactly this structure, nothing before or after:
${SCHEMA}`;
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
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'race-app-ai', model: env.MODEL || 'claude-sonnet-4-5' }, 200, origin);
    if (req.method !== 'POST' || url.pathname !== '/summarize') return json({ error: 'Not found' }, 404, origin);
    if (!ALLOWED.includes(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Server has no API key yet' }, 500, origin);
    const len = +(req.headers.get('Content-Length') || 0); if (len > MAX_BYTES) return json({ error: 'Documents too large (max 25 MB)' }, 413, origin);
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'Bad request' }, 400, origin); }
    const name = String(body.name || 'Regatta').slice(0, 80), docs = Array.isArray(body.docs) ? body.docs.slice(0, 8) : [];
    if (!docs.length) return json({ error: 'No documents' }, 400, origin);
    const content = [];
    for (const d of docs) {
      const t = String(d.type || '');
      if (t === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data }, title: String(d.name || 'document').slice(0, 100) });
      else if (/^image\/(jpeg|png|gif|webp)$/.test(t)) content.push({ type: 'image', source: { type: 'base64', media_type: t, data: d.data } });
      else if (t === 'text/plain') content.push({ type: 'text', text: '===== ' + (d.name || 'document') + ' =====\n' + String(d.data).slice(0, 200000) });
    }
    if (!content.length) return json({ error: 'Unsupported file type (use PDF or a photo)' }, 400, origin);
    content.push({ type: 'text', text: prompt(name) });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.MODEL || 'claude-sonnet-4-5', max_tokens: 4000, messages: [{ role: 'user', content }] })
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: 'AI error: ' + ((out.error && out.error.message) || r.status) }, 502, origin);
    const text = (out.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return json({ error: 'AI answer had no summary' }, 502, origin);
    try { return json({ summary: JSON.parse(text.slice(a, b + 1)) }, 200, origin); }
    catch (e) { return json({ error: 'AI answer could not be read' }, 502, origin); }
  }
};
