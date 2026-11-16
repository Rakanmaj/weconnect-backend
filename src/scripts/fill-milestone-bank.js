import { createPool, transaction } from '../db.js';
import { getConfig } from '../config.js';
import { groqJson } from '../ai/groq.js';
import { authorVariant } from '../exam-bank/author.js';
import { insertExamItem } from '../exam-bank/persist.js';
import { runJavaScript } from '../growth-grading.js';

function arg(name, fallback = '') {
  const found = process.argv.find(item => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

const activityKey = arg('activity');
const count = Math.min(5, Math.max(1, Number(arg('count', '1')) || 1));
if (!activityKey) {
  console.error('Usage: npm run ai:fill-milestone -- --activity=javascript-1 --count=2');
  process.exit(1);
}

const config = getConfig();
const pool = createPool(config.databaseUrl);

try {
  await pool.query(`INSERT INTO exam_item_sources (id, name, license, attribution, homepage) VALUES
    ('generated', 'WeConnect path milestone generator', 'Generated for this project', 'Variants are checked automatically before they can be served', '')
    ON CONFLICT (id) DO NOTHING`);
  const { rows } = await pool.query(`
    SELECT a.id, a.slug, a.skill_id, s.slug AS skill_slug, s.name AS skill_name, v.title, v.questions
    FROM growth_activities a
    JOIN growth_activity_versions v ON v.activity_id = a.id AND v.version = a.published_version
    LEFT JOIN growth_skills s ON s.id = a.skill_id
    WHERE a.slug = $1 OR a.id::text = $1`, [activityKey]);
  const activity = rows[0];
  if (!activity) throw new Error(`No published milestone found for ${activityKey}.`);
  if (activity.questions?.length === 0) throw new Error('This milestone has no seed questions to vary.');

  let approved = 0;
  let rejected = 0;
  for (const seed of activity.questions) {
    for (let index = 1; index <= count; index += 1) {
      const externalId = `generated:${activity.slug}:${seed.id}:${Date.now()}:${index}`;
      let result;
      try {
        result = await authorVariant({
          objective: `${activity.skill_name || activity.skill_slug || 'skill'}: ${activity.title}`,
          seed,
          id: `gen-${activity.slug}-${seed.id}-${index}`,
          complete: messages => groqJson({ messages, temperature: messages[0].content.includes('Decide if') ? 0 : 0.4 }),
          runCode: (solution, tests) => runJavaScript(solution, tests, config),
        });
      } catch (error) {
        console.error(`${seed.id} #${index}: ${error.message}`);
        rejected += 1;
        continue;
      }
      if (result.question) await transaction(pool, client => insertExamItem(client, {
        sourceId: 'generated',
        externalId,
        objectiveCode: `path:${activity.slug}:${seed.id}`,
        objectiveStatement: `${activity.title}: ${seed.id}`,
        skillSlug: activity.skill_slug,
        skillId: activity.skill_id,
        activityId: activity.id,
        status: result.ok ? 'approved' : 'rejected',
        question: result.question,
        metadata: { check: result.check || '', reason: result.reason || '', seedId: seed.id },
      }));
      if (result.ok) approved += 1;
      else rejected += 1;
      console.log(`${result.ok ? 'approved' : 'rejected'} ${seed.id} #${index}${result.reason ? `: ${result.reason}` : ''}`);
    }
  }
  console.log(`\n${activity.slug}: ${approved} approved, ${rejected} rejected. Approved items can be served on the next try for this milestone.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}