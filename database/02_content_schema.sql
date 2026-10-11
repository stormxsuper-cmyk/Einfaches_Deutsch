-- Batch 1: normalized content model and learning-evidence foundations.
-- Safe to run after 01_schema.sql; additive and designed to be repeatable.
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_url TEXT,
  license_type TEXT NOT NULL CHECK (license_type IN ('original','public_domain','creative_commons','permission_granted','official_external_link')),
  attribution TEXT NOT NULL DEFAULT '',
  reuse_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (license_type <> 'official_external_link' OR source_url IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS cefr_descriptors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  level user_cefr_level NOT NULL,
  skill_dimension TEXT NOT NULL CHECK (skill_dimension IN ('vocabulary','grammar','pronunciation','reading','listening','writing','speaking','interaction')),
  descriptor TEXT NOT NULL,
  observable_evidence JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(observable_evidence) = 'array'),
  source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL,
  is_official_text BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_item_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_item_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  to_item_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('prerequisite','related','used_in','contrasts_with')),
  strength NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (strength BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_item_id <> to_item_id),
  UNIQUE(from_item_id, to_item_id, relation_type)
);

CREATE TABLE IF NOT EXISTS lesson_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  step_order SMALLINT NOT NULL CHECK (step_order > 0),
  step_type TEXT NOT NULL CHECK (step_type IN ('explain','example','guided_practice','active_recall','contextual_use','assessment','reflection','review')),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lesson_id, step_order)
);

CREATE TABLE IF NOT EXISTS lesson_skill_targets (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  target_mastery SMALLINT NOT NULL DEFAULT 70 CHECK (target_mastery BETWEEN 1 AND 100),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(lesson_id, skill_id)
);

CREATE TABLE IF NOT EXISTS unit_outcomes (
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  descriptor_id UUID NOT NULL REFERENCES cefr_descriptors(id) ON DELETE CASCADE,
  outcome_order SMALLINT NOT NULL DEFAULT 1 CHECK (outcome_order > 0),
  PRIMARY KEY(unit_id, descriptor_id)
);

CREATE TABLE IF NOT EXISTS vocabulary_audio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_id UUID NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT 'standard-german',
  speed_variant TEXT NOT NULL DEFAULT 'normal' CHECK (speed_variant IN ('slow','normal')),
  source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL,
  UNIQUE(vocabulary_id, accent, speed_variant)
);

CREATE TABLE IF NOT EXISTS reading_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reading_text_id UUID NOT NULL REFERENCES reading_texts(id) ON DELETE CASCADE,
  token_order INT NOT NULL CHECK (token_order >= 0),
  surface_form TEXT NOT NULL,
  lemma TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  pronunciation TEXT NOT NULL DEFAULT '',
  part_of_speech TEXT NOT NULL DEFAULT '',
  grammar_note TEXT NOT NULL DEFAULT '',
  example_de TEXT NOT NULL DEFAULT '',
  vocabulary_id UUID REFERENCES vocabulary(id) ON DELETE SET NULL,
  UNIQUE(reading_text_id, token_order)
);

CREATE TABLE IF NOT EXISTS audio_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_item_id UUID NOT NULL REFERENCES audio_items(id) ON DELETE CASCADE,
  variant TEXT NOT NULL CHECK (variant IN ('normal','slow')),
  audio_url TEXT NOT NULL,
  duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  transcript_segments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transcript_segments) = 'array'),
  source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL,
  UNIQUE(audio_item_id, variant)
);

CREATE TABLE IF NOT EXISTS exercise_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  option_order SMALLINT NOT NULL CHECK (option_order > 0),
  option_key TEXT NOT NULL,
  option_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(exercise_id, option_order),
  UNIQUE(exercise_id, option_key)
);

CREATE TABLE IF NOT EXISTS exercise_skill_targets (
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  weight NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (weight BETWEEN 0 AND 1),
  PRIMARY KEY(exercise_id, skill_id)
);

CREATE TABLE IF NOT EXISTS exercise_answer_keys (
  exercise_id UUID PRIMARY KEY REFERENCES exercises(id) ON DELETE CASCADE,
  accepted_answers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(accepted_answers) = 'array'),
  explanation TEXT NOT NULL DEFAULT '',
  scoring_method TEXT NOT NULL DEFAULT 'exact' CHECK (scoring_method IN ('exact','normalized_text','multiple_select','rubric','manual_self_review')),
  rubric JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rubric) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS writing_rubrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  level user_cefr_level NOT NULL,
  task_type TEXT NOT NULL,
  criteria JSONB NOT NULL CHECK (jsonb_typeof(criteria) = 'array'),
  max_score NUMERIC(6,2) NOT NULL CHECK (max_score > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS writing_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_profiles(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  rubric_id UUID REFERENCES writing_rubrics(id) ON DELETE SET NULL,
  prompt_snapshot TEXT NOT NULL DEFAULT '',
  response_text TEXT NOT NULL,
  criterion_scores JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(criterion_scores) = 'object'),
  feedback JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(feedback) = 'object'),
  total_score NUMERIC(6,2),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS speaking_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  level user_cefr_level NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  preparation_seconds SMALLINT NOT NULL DEFAULT 0 CHECK (preparation_seconds >= 0),
  response_seconds SMALLINT NOT NULL DEFAULT 60 CHECK (response_seconds > 0),
  model_answer TEXT NOT NULL DEFAULT '',
  self_assessment JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(self_assessment) = 'array'),
  source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS speaking_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_profiles(id) ON DELETE CASCADE,
  speaking_task_id UUID NOT NULL REFERENCES speaking_tasks(id) ON DELETE CASCADE,
  recording_url TEXT,
  duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  self_assessment JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(self_assessment) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_skill_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_profiles(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('learn','guided_practice','active_recall','contextual_use','assessment','spaced_review','writing_rubric','speaking_self_review')),
  source_type TEXT NOT NULL CHECK (source_type IN ('lesson_step','exercise_attempt','exam_result','review_event','writing_submission','speaking_recording')),
  source_id UUID,
  score NUMERIC(5,2) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  section_code TEXT NOT NULL,
  title TEXT NOT NULL,
  skill_dimension TEXT NOT NULL CHECK (skill_dimension IN ('vocabulary','grammar','pronunciation','reading','listening','writing','speaking','interaction')),
  duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  max_score NUMERIC(6,2) NOT NULL DEFAULT 100 CHECK (max_score > 0),
  section_order SMALLINT NOT NULL CHECK (section_order > 0),
  UNIQUE(exam_id, section_code),
  UNIQUE(exam_id, section_order)
);

ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS grammatical_gender TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS plural_form TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS ipa TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS inflections JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS usage_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE vocabulary ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;
ALTER TABLE grammar_topics ADD COLUMN IF NOT EXISTS explanation_ar TEXT NOT NULL DEFAULT '';
ALTER TABLE grammar_topics ADD COLUMN IF NOT EXISTS examples JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE grammar_topics ADD COLUMN IF NOT EXISTS common_errors JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE grammar_topics ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS estimated_minutes SMALLINT NOT NULL DEFAULT 10 CHECK (estimated_minutes BETWEEN 1 AND 240);
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','review','published','retired'));
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS content_version INT NOT NULL DEFAULT 1 CHECK (content_version > 0);
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE reading_texts ADD COLUMN IF NOT EXISTS word_count INT CHECK (word_count IS NULL OR word_count >= 0);
ALTER TABLE reading_texts ADD COLUMN IF NOT EXISTS estimated_minutes SMALLINT CHECK (estimated_minutes IS NULL OR estimated_minutes > 0);
ALTER TABLE reading_texts ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;
ALTER TABLE audio_items ADD COLUMN IF NOT EXISTS duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds > 0);
ALTER TABLE audio_items ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'de-DE';
ALTER TABLE audio_items ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS feedback_rules JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','review','published','retired'));
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;
ALTER TABLE exercise_attempts ADD COLUMN IF NOT EXISTS duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds >= 0);
ALTER TABLE exercise_attempts ADD COLUMN IF NOT EXISTS confidence_rating SMALLINT CHECK (confidence_rating IS NULL OR confidence_rating BETWEEN 1 AND 5);
ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS last_evidence_at TIMESTAMPTZ;
ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1);
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS evidence_count INT NOT NULL DEFAULT 0 CHECK (evidence_count >= 0);
ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS is_unlocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mistakes ADD COLUMN IF NOT EXISTS error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE mistakes ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE mistakes ADD COLUMN IF NOT EXISTS remediation JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','review','published','retired'));
ALTER TABLE exams ADD COLUMN IF NOT EXISTS duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds > 0);
ALTER TABLE exams ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;
ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS section_scores JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS skill_profile JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS completed_minutes SMALLINT NOT NULL DEFAULT 0 CHECK (completed_minutes >= 0);
ALTER TABLE daily_plans ADD COLUMN IF NOT EXISTS generated_from JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_knowledge_edges_from ON knowledge_item_edges(from_item_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_to ON knowledge_item_edges(to_item_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_steps_lesson_order ON lesson_steps(lesson_id, step_order);
CREATE INDEX IF NOT EXISTS idx_reading_tokens_lookup ON reading_tokens(reading_text_id, token_order);
CREATE INDEX IF NOT EXISTS idx_skill_evidence_user_skill_date ON user_skill_evidence(user_id, skill_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_writing_submissions_user_date ON writing_submissions(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_speaking_recordings_user_date ON speaking_recordings(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_exams_level_status ON exams(level, publication_status);
CREATE INDEX IF NOT EXISTS idx_exercises_unit_status ON exercises(unit_id, publication_status);
CREATE INDEX IF NOT EXISTS idx_lessons_unit_status ON lessons(unit_id, publication_status);
CREATE INDEX IF NOT EXISTS idx_vocabulary_level_word ON vocabulary(level, normalized_word);

INSERT INTO schema_migrations(version, description)
VALUES ('002_content_schema', 'Normalized content schema, CEFR outcomes, skill evidence, and richer content metadata')
ON CONFLICT(version) DO NOTHING;
COMMIT;
