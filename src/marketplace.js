export const FIRST_SALARY_FEE = 10;

const TYPE_MAP = {
  'Training Project': 'training',
  'Paid Project': 'paid',
  'Hiring Challenge': 'hiring',
  training: 'training',
  paid: 'paid',
  hiring: 'hiring',
};

export function normalizeProjectType(value) {
  return TYPE_MAP[value] || 'paid';
}

export function milestoneLines(text) {
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 6);
  if (!lines.length) return ['First slice', 'Second slice', 'Finished project'];
  return lines;
}

export function rankDevelopers(brief, developers) {
  const wanted = new Set((brief.skills || []).map(skill => skill.toLowerCase()));
  const scored = developers.map(developer => {
    const skills = (developer.skills || []).map(skill => skill.toLowerCase());
    const overlap = wanted.size ? skills.filter(skill => wanted.has(skill)).length / wanted.size : 0;
    const path = developer.career_path && developer.career_path === brief.career_path ? 1 : 0;
    const practice = Math.min(1, Number(developer.completions || 0) / 5);
    const total = Math.round((path * 40 + overlap * 40 + practice * 20) * 100) / 100;
    const reasons = [];
    if (path) reasons.push(`Career path matches ${brief.career_path}.`);
    if (overlap) reasons.push(`Covers ${Math.round(overlap * 100)}% of the requested skills.`);
    if (practice) reasons.push(`${developer.completions} milestone${Number(developer.completions) === 1 ? '' : 's'} already passed on the platform.`);
    if (!reasons.length) reasons.push('Verified account with availability for junior project work.');
    return { ...developer, total, breakdown: { path: path * 40, skills: Math.round(overlap * 40), practice: Math.round(practice * 20) }, reasons };
  });
  return scored.sort((a, b) => b.total - a.total || String(a.id).localeCompare(String(b.id))).slice(0, 3);
}
