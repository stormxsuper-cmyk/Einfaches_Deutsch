const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const curriculumPath = path.join(root, 'backend', 'src', 'data', 'curriculum_master.json');
const schemaPath = path.join(root, 'database', '01_schema.sql');
const migrationPath = path.join(root, 'database', '02_content_schema.sql');
const curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));
const baseSchema = fs.readFileSync(schemaPath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');
const errors = [];
const expectedLevels = ['Foundation', 'A1', 'A2', 'B1', 'B2'];
const expectedSkills = ['vocabulary', 'grammar', 'pronunciation', 'reading', 'listening', 'writing', 'speaking', 'interaction'];
if (!curriculum.mastery_policy?.lesson_completion_is_not_mastery) errors.push('Mastery policy must explicitly reject lesson-completion-as-mastery.');
for (const skill of expectedSkills) if (!curriculum.mastery_policy?.skill_dimensions?.includes(skill)) errors.push(`Missing mastery dimension: ${skill}`);
const levels = curriculum.levels || [];
if (JSON.stringify(levels.map(x => x.level)) !== JSON.stringify(expectedLevels)) errors.push('Curriculum levels/order must be Foundation, A1, A2, B1, B2.');
const ids = new Set();
let moduleCount = 0;
for (const level of levels) {
  if (!level.purpose || !Array.isArray(level.modules) || !level.modules.length) errors.push(`Level ${level.level} needs a purpose and modules.`);
  if (level.level === 'Foundation' && !(/pre.?A1|not an official CEFR/i.test(level.purpose) || /ليست مستوى CEFR رسميًا|قبل A1/i.test(level.purpose) || /pre-A1/i.test(curriculum.alignment || ''))) errors.push('Foundation must be clearly identified as pre-A1/non-official CEFR.');
  for (const module of level.modules || []) {
    moduleCount++;
    for (const field of ['id', 'title', 'vocabulary_scope', 'grammar_scope', 'learning_outcome', 'assessment']) {
      if (typeof module[field] !== 'string' || !module[field].trim()) errors.push(`Module ${module.id || '(unknown)'} missing ${field}.`);
    }
    if (ids.has(module.id)) errors.push(`Duplicate module ID: ${module.id}`);
    ids.add(module.id);
  }
}
if (moduleCount !== 54) errors.push(`Expected 54 curriculum map modules, found ${moduleCount}.`);
const requiredTables = ['content_sources','cefr_descriptors','knowledge_item_edges','lesson_steps','lesson_skill_targets','unit_outcomes','vocabulary_audio','reading_tokens','audio_variants','exercise_options','exercise_skill_targets','exercise_answer_keys','writing_rubrics','writing_submissions','speaking_tasks','speaking_recordings','user_skill_evidence','exam_sections'];
for (const table of requiredTables) if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, 'i').test(migration)) errors.push(`Missing schema table: ${table}`);
for (const column of ['grammatical_gender','plural_form','ipa','inflections','usage_notes','publication_status','content_version','last_evidence_at','confidence']) {
  if (!new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`, 'i').test(migration)) errors.push(`Missing schema field: ${column}`);
}
if (!/BEGIN;[\s\S]*COMMIT;/i.test(migration)) errors.push('Migration must be transaction-wrapped.');
if (!/lesson_completion_is_not_mastery/.test(fs.readFileSync(path.join(root, 'backend', 'src', 'data', 'curriculum_master.json'), 'utf8'))) errors.push('Mastery contract missing.');
if (!/CREATE TABLE IF NOT EXISTS knowledge_items/i.test(baseSchema) || !/CREATE TABLE IF NOT EXISTS lessons/i.test(baseSchema)) errors.push('Base schema missing core tables.');
if (errors.length) {
  console.error('CONTENT SCHEMA VALIDATION FAILED');
  errors.forEach(e => console.error(`- ${e}`));
  process.exit(1);
}
console.log(`PASS: ${levels.length} levels, ${moduleCount} modules, ${expectedSkills.length} skill dimensions, ${requiredTables.length} normalized content/evidence tables, additive migration contract.`);
