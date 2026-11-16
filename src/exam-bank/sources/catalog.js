import { normalizeMcq, normalizeWritten, normalizeCode } from '../normalize.js';

export async function loadCatalogItems(pool) {
  const { rows } = await pool.query(`
    SELECT a.id AS activity_id, a.slug AS activity_slug, a.kind, a.skill_id, s.slug AS skill_slug,
           v.questions
    FROM growth_activities a
    JOIN growth_activity_versions v ON v.activity_id = a.id AND v.version = a.published_version
    LEFT JOIN growth_skills s ON s.id = a.skill_id
    WHERE v.status = 'published' AND jsonb_array_length(v.questions) > 0
  `);
  const items = [];
  for (const row of rows) {
    for (const q of row.questions) {
      if (!q?.id || !q?.type) continue;
      const externalId = `catalog:${row.activity_slug}:${q.id}`;
      const objectiveCode = `catalog:${row.activity_slug}:${q.id}`;
      items.push({
        sourceId: 'catalog',
        externalId,
        objectiveCode,
        objectiveStatement: `Demonstrate: ${row.activity_slug} — ${q.id}`,
        skillSlug: row.skill_slug,
        activityId: row.activity_id,
        status: 'approved',
        question: q,
        metadata: { activitySlug: row.activity_slug, kind: row.kind },
      });
    }
  }
  return items;
}

/** Re-export normalizers for tests that build from raw catalogue objects */
export { normalizeMcq, normalizeWritten, normalizeCode };