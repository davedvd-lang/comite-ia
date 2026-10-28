// Comité de IA — servidor intermedio (Cloudflare Worker)
// Guarda las claves de API como secretos y reenvía las peticiones a cada proveedor,
// devolviendo siempre el mismo formato de streaming al frontend:
//   data: {"t":"texto"}   → trozo de texto
//   data: {"error":"..."} → error a mitad de respuesta
//   data: {"done":true}   → fin

const OAI_BASE = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  hf: 'https://router.huggingface.co/v1',
};

const KEY_VAR = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  hf: 'HF_TOKEN',
  anthropic: 'ANTHROPIC_API_KEY',
};

const MAX_INPUT_CHARS = 200_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get('Origin') || '', env);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!url.pathname.startsWith('/api/')) return json({ error: 'No encontrado' }, 404, cors);
    if (!(await authorized(req, env))) return json({ error: 'Contraseña incorrecta' }, 401, cors);

    try {
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const providers = Object.fromEntries(Object.entries(KEY_VAR).map(([p, v]) => [p, Boolean(env[v])]));
        return json({ providers }, 200, cors);
      }
      if (url.pathname === '/api/models' && req.method === 'GET') {
        return json({ models: await listModels(url.searchParams.get('provider'), env) }, 200, cors);
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        return await chat(req, env, cors);
      }
      return json({ error: 'No encontrado' }, 404, cors);
    } catch (e) {
      return json({ error: e.message || String(e) }, e.status || 500, cors);
    }
  },
};

/* ---------- Seguridad ---------- */

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

async function authorized(req, env) {
  if (!env.APP_PASSWORD) return false; // sin contraseña configurada, no se abre a nadie
  const given = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(env.APP_PASSWORD)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/* ---------- Utilidades ---------- */

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function keyFor(provider, env) {
  if (!KEY_VAR[provider]) throw httpError(`Proveedor desconocido: ${provider}`, 400);
  const key = env[KEY_VAR[provider]];
  if (!key) throw httpError(`Falta el secreto ${KEY_VAR[provider]} en el servidor`, 400);
  return key;
}

function upstreamHeaders(provider, key) {
  if (provider === 'anthropic') {
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
  }
  const h = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (provider === 'openrouter') h['X-Title'] = 'Comite IA';
  return h;
}

async function* readSSE(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

// Convierte la respuesta de error de un proveedor en un mensaje legible y respeta 429/401 etc.
async function upstreamError(res, provider, cors) {
  let message = `HTTP ${res.status}`;
  let retryAfter = parseFloat(res.headers.get('retry-after')) || null;
  try {
    const text = await res.text();
    try {
      let j = JSON.parse(text);
      if (Array.isArray(j)) j = j[0];
      const err = j.error ?? j;
      message = (typeof err === 'string' ? err : err.message) || message;
      const det = (err.details || []).find((d) => d.retryDelay);
      if (det && !retryAfter) retryAfter = parseFloat(det.retryDelay);
    } catch {
      if (text) message = text.slice(0, 300);
    }
  } catch {}
  const headers = { ...cors };
  if (retryAfter) headers['Retry-After'] = String(Math.ceil(retryAfter));
  return json({ error: message, provider, retryAfter }, res.status, headers);
}

/* ---------- Endpoints ---------- */

async function chat(req, env, cors) {
  let body;
  try { body = await req.json(); } catch { throw httpError('JSON inválido', 400); }
  const { provider, model, system = '', user, maxTokens } = body || {};
  if (typeof model !== 'string' || !model) throw httpError('Falta el modelo', 400);
  if (typeof user !== 'string' || !user) throw httpError('Falta el mensaje', 400);
  if (system.length + user.length > MAX_INPUT_CHARS) throw httpError('Entrada demasiado larga', 413);
  const key = keyFor(provider, env);

  let upstreamUrl, payload;
  if (provider === 'anthropic') {
    upstreamUrl = 'https://api.anthropic.com/v1/messages';
    payload = {
      model,
      max_tokens: Math.min(Number(maxTokens) || 8000, 32000),
      system,
      stream: true,
      messages: [{ role: 'user', content: user }],
    };
  } else {
    upstreamUrl = `${OAI_BASE[provider]}/chat/completions`;
    payload = {
      model,
      stream: true,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
    };
  }

  const res = await fetch(upstreamUrl, {
    method: 'POST',
    headers: upstreamHeaders(provider, key),
    body: JSON.stringify(payload),
    signal: req.signal,
  });
  if (!res.ok) return upstreamError(res, provider, cors);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (o) => writer.write(enc.encode(`data: ${JSON.stringify(o)}\n\n`));

  (async () => {
    try {
      for await (const d of readSSE(res.body)) {
        if (!d) continue;
        if (d === '[DONE]') break;
        let j;
        try { j = JSON.parse(d); } catch { continue; }
        if (provider === 'anthropic') {
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') await send({ t: j.delta.text });
          else if (j.type === 'error') throw new Error(j.error?.message || 'Error de Claude');
        } else {
          if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
          const t = j.choices?.[0]?.delta?.content;
          if (t) await send({ t });
        }
      }
      await send({ done: true });
    } catch (e) {
      try { await send({ error: e.message || String(e) }); } catch {}
    } finally {
      try { await writer.close(); } catch {}
    }
  })();

  return new Response(readable, {
    headers: { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

async function listModels(provider, env) {
  const key = keyFor(provider, env);
  const headers = upstreamHeaders(provider, key);
  const url = provider === 'anthropic' ? 'https://api.anthropic.com/v1/models?limit=100' : `${OAI_BASE[provider]}/models`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw httpError(`${provider}: HTTP ${res.status} al listar modelos`, 502);
  const j = await res.json();
  let ids = (j.data || []).map((m) => String(m.id).replace(/^models\//, ''));
  if (provider === 'openrouter') ids = ids.filter((id) => id.endsWith(':free') || id === 'openrouter/free');
  return ids.sort();
}
