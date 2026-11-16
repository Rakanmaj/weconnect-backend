export function parseModelJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('The model did not return JSON.');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(raw.slice(start, index + 1));
    }
  }
  throw new Error('The model did not return JSON.');
}

export async function groqJson({ messages, model, temperature = 0, fetchImpl = fetch }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('Set GROQ_API_KEY in .env before generating milestone questions.');
  const response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: model || process.env.GROQ_EXAM_MODEL || 'openai/gpt-oss-120b',
      temperature,
      response_format: { type: 'json_object' },
      messages,
    }),
  });
  if (!response.ok) throw new Error(`Groq returned ${response.status}.`);
  const body = await response.json();
  return parseModelJson(body.choices?.[0]?.message?.content || '');
}