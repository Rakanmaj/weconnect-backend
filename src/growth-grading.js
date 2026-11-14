import { parse } from 'acorn';
import { runLocalJavaScript } from './local-code-runner.js';

export function checkJavaScript(source) {
  try { parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); return { valid: true, message: 'JavaScript syntax is valid. This check does not execute code or award points.' }; }
  catch (error) { return { valid: false, message: error.message }; }
}

// A bounded local WebAssembly interpreter, or an explicitly configured external sandbox.
export async function runJavaScript(source, cases, config, fetcher = fetch) {
  if (config.runnerMode==='disabled') return { available: false, message: 'Automatic execution is disabled. Your code can still be submitted for administrator review.', tests: [] };
  if (!config.runnerUrl) return runLocalJavaScript(source,cases);
  const tests = [];
  const deadline = Date.now() + 20000;
  for (const item of cases.slice(0, 5)) {
    try {
      const headers = { 'Content-Type': 'application/json', ...(config.runnerToken ? { 'X-Auth-Token': config.runnerToken } : {}) };
      const base = config.runnerUrl.replace(/\/$/, '');
      if (Date.now() >= deadline) throw new Error('Runner timed out');
      const response = await fetcher(`${base}/submissions?base64_encoded=true&wait=false`, { method: 'POST', headers,
        signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline-Date.now()))), body: JSON.stringify({ language_id: config.runnerLanguageId || 63,
          source_code: Buffer.from(source).toString('base64'), stdin: Buffer.from(item.input || '').toString('base64'),
          expected_output: Buffer.from(item.output || '').toString('base64'), cpu_time_limit: 2, wall_time_limit: 5,
          memory_limit: 128000, enable_network: false }) });
      if (!response.ok) throw new Error('Runner unavailable');
      const job = await response.json();
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(job.token || '')) throw new Error('Invalid job');
      let result;
      for (let n = 0; n < 12; n++) {
        if (Date.now() >= deadline) throw new Error('Runner timed out');
        const poll = await fetcher(`${base}/submissions/${job.token}?base64_encoded=true&fields=status`, { headers, signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline-Date.now()))) });
        if (!poll.ok) throw new Error('Runner unavailable');
        result = await poll.json();
        if (result.status?.id > 2) break;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      tests.push({ name: item.name, passed: result?.status?.id === 3, status: result?.status?.description || 'Execution timed out' });
    } catch { return { available: false, message: 'The code runner is unavailable. Your saved work is safe and can be submitted for administrator review.', tests }; }
  }
  return { available: true, message: 'Example tests completed. Final coding points are confirmed by an administrator.', tests };
}

export function objectiveGrade(questions, answers) {
  let earned = 0;
  const total = questions.reduce((sum, q) => sum + q.points, 0);
  for (const q of questions) if (q.type === 'mcq' && answers[q.id] === q.correctAnswer) earned += q.points;
  return { earned, total, score: total ? Math.round(earned * 10000 / total) / 100 : 0,
    needsReview: questions.some(q => q.type !== 'mcq') };
}
export const overallLevel = score => score >= 90 ? 4 : score >= 80 ? 3 : score >= 70 ? 2 : 1;
