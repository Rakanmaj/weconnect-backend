export async function skillIdBySlug(pool, slug) {
  if (!slug) return null;
  const { rows } = await pool.query('SELECT id FROM growth_skills WHERE slug = $1', [slug]);
  return rows[0]?.id || null;
}

export async function upsertObjective(client, { code, statement, skillId, difficulty = 2 }) {
  const { rows } = await client.query(
    `INSERT INTO learning_objectives (code, statement, skill_id, difficulty)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET
       statement = EXCLUDED.statement,
       skill_id = COALESCE(EXCLUDED.skill_id, learning_objectives.skill_id)
     RETURNING id`,
    [code, statement.slice(0, 2000), skillId, difficulty],
  );
  return rows[0].id;
}

export async function insertExamItem(client, item) {
  const skillId = item.skillId || (await skillIdBySlug(client, item.skillSlug));
  const objectiveId = await upsertObjective(client, {
    code: item.objectiveCode,
    statement: item.objectiveStatement,
    skillId,
    difficulty: 2,
  });
  const { rows } = await client.query(
    `INSERT INTO exam_items (objective_id, skill_id, activity_id, source_id, external_id, question, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source_id, external_id) DO NOTHING
     RETURNING id`,
    [
      objectiveId,
      skillId,
      item.activityId,
      item.sourceId,
      item.externalId.slice(0, 200),
      JSON.stringify(item.question),
      item.status,
      JSON.stringify(item.metadata || {}),
    ],
  );
  return Boolean(rows[0]);
}