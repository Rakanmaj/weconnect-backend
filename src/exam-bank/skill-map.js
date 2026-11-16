const TECH_TO_SKILL = {
  javascript: 'javascript',
  typescript: 'javascript',
  react: 'react',
  nodejs: 'node',
  'http-apis': 'node',
  'databases-sql': 'postgresql',
  postgresql: 'postgresql',
  css: 'javascript',
  'web-platform': 'javascript',
  python: 'javascript',
  'system-design': 'javascript',
  'ai-engineering': 'javascript',
};

export function skillSlugForTechnology(technology) {
  return TECH_TO_SKILL[String(technology || '').toLowerCase()] || 'javascript';
}

export function skillSlugForTopicPath(path) {
  const lower = path.toLowerCase();
  if (lower.includes('javascript') || lower.includes('js')) return 'javascript';
  if (lower.includes('react')) return 'react';
  if (lower.includes('node')) return 'node';
  if (lower.includes('sql') || lower.includes('postgres')) return 'postgresql';
  return null;
}