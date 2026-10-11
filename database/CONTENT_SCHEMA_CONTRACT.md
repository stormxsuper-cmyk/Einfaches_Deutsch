# Content Schema Contract — Batch 1

This contract defines how the learning content is stored. It does not claim that every lesson, question, recording, or assessment has already been authored.

## Source of truth

- `backend/src/data/curriculum_master.json` is the source of truth for the current 54-module curriculum map.
- `database/01_schema.sql` creates the base tables.
- `database/02_content_schema.sql` adds normalized content structures and evidence tracking. Apply SQL files in numeric order.
- `database/schema_migrations` records applied migrations.

## Curriculum hierarchy

`levels → units → lessons → lesson_steps`

Each unit carries vocabulary scope, grammar scope, an observable learning outcome, and a proposed assessment. Foundation is a product-defined pre-A1 stage, not an official CEFR level. The curriculum map is CEFR-informed; it is not an official CEFR or Goethe syllabus.

## Content entities

- **Vocabulary:** word, normalized form, meaning, pronunciation/IPA, grammatical gender, plural, inflections, part of speech, examples, related words, usage notes, tags, level, source/license, optional audio.
- **Grammar:** topic code/title, explanation, examples, prerequisites, common errors, level, unit.
- **Reading:** source text, level, translation/support text, vocabulary links, token-by-token metadata for interactive selection.
- **Listening:** audio item, transcript, locale, duration, source attribution, normal/slow audio variants and optional transcript segments.
- **Exercises:** prompt, instructions, type, options, skill targets, difficulty, scoring method, feedback/rubric, publication state and source/license.
- **Writing:** rubric criteria and learner submissions with criterion scores and feedback.
- **Speaking:** structured prompts, preparation/response time, model answer, recordings and self-assessment.
- **Exams:** exam blueprint, sections, timing, per-section scores and skill profile.
- **Knowledge graph:** explicit prerequisite/related/used-in/contrast edges between knowledge items.
- **Learning evidence:** individual events linked to a skill, evidence type, source, score and timestamp.

## Mastery invariants

1. Opening or completing a lesson is not evidence of mastery by itself.
2. Skill dimensions are tracked separately: vocabulary, grammar, pronunciation, reading, listening, writing, speaking and interaction.
3. Evidence types include learn, guided practice, active recall, contextual use, assessment and spaced review.
4. Level unlocks must be based on configured skill evidence and a level-gate assessment, never XP alone.
5. A score is an estimate based on available evidence; it must not be presented as an official certificate or validated CEFR placement until the assessment has been validated.

## Security and licensing invariants

- Exercise answer keys are separated into `exercise_answer_keys`; normal client roles have no SELECT policy in the Supabase RLS script. A trusted server must grade answers.
- User submissions, recordings, progress, mistakes and skill evidence are user-owned records and must be protected by authenticated ownership checks.
- The API verifies a signed Supabase JWT (HS256 secret or RS256/ES256 via JWKS; expiry, issuer, audience and `sub` are checked) on every personal route. The user id used in every query comes only from the verified token, never from the request body or URL. In production the server refuses to start without auth configured.
- The API connects to PostgreSQL with a trusted server role, which bypasses RLS; its protection is the per-query `user_id` filter. RLS (`supabase_rls.sql`) is a second layer that protects direct Supabase client access. `npm run test:rls` checks it on a disposable database.
- Sync (`04_sync.sql`): state rows are last-write-wins by the client's logical time (future times are clamped); append-only logs are idempotent by client UUID. Scores, unlocks, exam results and answer-graded attempts are NOT client-writable, so a client cannot grant itself mastery. Deletions are not synced yet.
- `content_sources` records source URL, attribution and reuse/license notes. Use original learning content; link to official Goethe practice pages rather than copying protected exam content.

## Migration and validation

Run `01_schema.sql` followed by `02_content_schema.sql` on a disposable PostgreSQL database before merging further schema changes. Then run `npm test` in `backend`. The repository's static contract test checks the JSON curriculum and expected schema structures, but it is not a substitute for executing the SQL against PostgreSQL.
