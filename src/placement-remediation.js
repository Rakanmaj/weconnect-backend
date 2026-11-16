/** Placement failed → pass milestone 1 on each path skill before retake. */

export async function remediationStatus(client, userId, careerPath) {
  if (!careerPath) {
    return { skills: [], doneCount: 0, total: 0, complete: true };
  }
  const { rows: skills } = await client.query(
    `SELECT s.id, s.slug, s.name FROM growth_skills s
     WHERE s.status='published' AND $1 = ANY(s.career_paths) ORDER BY s.name`,
    [careerPath]
  );
  const out = [];
  for (const skill of skills) {
    const { rows: acts } = await client.query(
      `SELECT a.id, a.slug FROM growth_activities a
       WHERE a.kind='challenge' AND a.skill_id=$1 AND a.position=1 AND a.published_version IS NOT NULL
       LIMIT 1`,
      [skill.id]
    );
    const act = acts[0];
    let done = false;
    if (act) {
      const { rows: comp } = await client.query(
        `SELECT 1 FROM growth_completions WHERE user_id=$1 AND activity_id=$2 LIMIT 1`,
        [userId, act.id]
      );
      done = comp.length > 0;
    }
    out.push({
      slug: skill.slug,
      name: skill.name,
      activityId: act?.id || null,
      milestoneSlug: act?.slug || null,
      done,
    });
  }
  const required = out.filter(s => s.activityId);
  const doneCount = required.filter(s => s.done).length;
  return {
    skills: out,
    doneCount,
    total: required.length,
    complete: required.length > 0 && doneCount === required.length,
  };
}

export async function hasSubmittedPlacement(client, userId, careerPath, attemptSelect) {
  const { rows } = await client.query(
    `${attemptSelect} WHERE t.user_id=$1 AND a.kind='assessment' AND $2=ANY(v.career_paths)
     AND t.submitted_at IS NOT NULL AND t.status IN ('passed','failed')`,
    [userId, careerPath]
  );
  return rows.length > 0;
}

export async function placementPrepPayload(client, userId, careerPath, assessmentPassed, attemptSelect) {
  if (!careerPath || assessmentPassed) return null;
  const remediation = await remediationStatus(client, userId, careerPath);
  const attempted = await hasSubmittedPlacement(client, userId, careerPath, attemptSelect);
  if (!attempted && remediation.doneCount === 0) return null;
  return {
    attempted,
    complete: remediation.complete,
    doneCount: remediation.doneCount,
    total: remediation.total,
    skills: remediation.skills,
    canRetake: !attempted || remediation.complete,
  };
}