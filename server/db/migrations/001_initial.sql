CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS administrators (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permission_level TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cohort TEXT,
  employee_or_candidate_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facilitators (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  dos JSONB NOT NULL DEFAULT '[]',
  donts JSONB NOT NULL DEFAULT '[]',
  evaluation_criteria JSONB NOT NULL DEFAULT '[]',
  scoring_weights JSONB NOT NULL DEFAULT '{}',
  difficulty TEXT,
  conversation_rules JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id TEXT NOT NULL REFERENCES templates(id),
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES templates(id),
  title TEXT NOT NULL,
  type TEXT,
  domain TEXT,
  context TEXT,
  participant_role TEXT,
  other_role TEXT,
  objective TEXT,
  opening_situation TEXT,
  dos JSONB NOT NULL DEFAULT '[]',
  donts JSONB NOT NULL DEFAULT '[]',
  expected_behaviors JSONB NOT NULL DEFAULT '[]',
  evaluation_criteria JSONB NOT NULL DEFAULT '[]',
  impact_emphasis JSONB NOT NULL DEFAULT '[]',
  possible_conversation_directions JSONB NOT NULL DEFAULT '[]',
  difficulty TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scenario_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  participant_id UUID REFERENCES users(id),
  scenario_id TEXT REFERENCES scenarios(id),
  template_id TEXT REFERENCES templates(id),
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'waiting_for_user',
  current_phase TEXT,
  current_objective TEXT,
  running_scores JSONB NOT NULL DEFAULT '{}',
  conversation_history JSONB NOT NULL DEFAULT '[]',
  evaluations JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS assessment_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES assessment_sessions(id),
  participant_id UUID REFERENCES users(id),
  scenario_id TEXT REFERENCES scenarios(id),
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  final_score NUMERIC(5,2)
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT,
  original_response TEXT,
  transcription TEXT,
  audio_reference JSONB,
  input_type TEXT,
  decision TEXT,
  rationale_code TEXT,
  phase INTEGER,
  accepted BOOLEAN,
  evaluation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS response_evaluations (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES assessment_sessions(id),
  turn_id TEXT REFERENCES conversation_turns(id),
  evaluation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_results (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES assessment_sessions(id),
  attempt_number INTEGER,
  scenario_id TEXT REFERENCES scenarios(id),
  template_id TEXT REFERENCES templates(id),
  status TEXT NOT NULL,
  overall_performance TEXT,
  running_scores JSONB NOT NULL DEFAULT '{}',
  strengths JSONB NOT NULL DEFAULT '[]',
  improvement_areas JSONB NOT NULL DEFAULT '[]',
  dos_performance JSONB NOT NULL DEFAULT '[]',
  dont_violations JSONB NOT NULL DEFAULT '[]',
  communication JSONB NOT NULL DEFAULT '{}',
  evidence JSONB NOT NULL DEFAULT '[]',
  better_response_examples JSONB NOT NULL DEFAULT '[]',
  ai_provenance JSONB NOT NULL DEFAULT '{}',
  human_review JSONB,
  immutable_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  result_id TEXT REFERENCES assessment_results(id),
  reviewer_id UUID REFERENCES users(id),
  status TEXT NOT NULL,
  final_score NUMERIC(5,2),
  comments TEXT,
  override_reason TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS use_cases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  business_problem TEXT,
  trigger TEXT,
  current_process TEXT,
  desired_outcome TEXT,
  ai_role TEXT,
  human_role TEXT,
  target_users JSONB NOT NULL DEFAULT '[]',
  stakeholders JSONB NOT NULL DEFAULT '[]',
  inputs JSONB NOT NULL DEFAULT '[]',
  outputs JSONB NOT NULL DEFAULT '[]',
  data_sources JSONB NOT NULL DEFAULT '[]',
  systems JSONB NOT NULL DEFAULT '[]',
  dependencies JSONB NOT NULL DEFAULT '[]',
  constraints JSONB NOT NULL DEFAULT '[]',
  assumptions JSONB NOT NULL DEFAULT '[]',
  risks JSONB NOT NULL DEFAULT '[]',
  success_criteria JSONB NOT NULL DEFAULT '[]',
  kpis JSONB NOT NULL DEFAULT '[]',
  edge_cases JSONB NOT NULL DEFAULT '[]',
  confirmed_facts JSONB NOT NULL DEFAULT '[]',
  open_questions JSONB NOT NULL DEFAULT '[]',
  decisions JSONB NOT NULL DEFAULT '[]',
  conflicting JSONB NOT NULL DEFAULT '[]',
  deferred JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS use_case_conversations (
  id TEXT PRIMARY KEY,
  use_case_id TEXT REFERENCES use_cases(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  turns JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS use_case_turns (
  id TEXT PRIMARY KEY,
  use_case_id TEXT REFERENCES use_cases(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT,
  decision TEXT,
  target_field TEXT,
  question_reason TEXT,
  rationale_code TEXT,
  complete BOOLEAN DEFAULT FALSE,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS use_case_relationships (
  id TEXT PRIMARY KEY,
  use_case_id TEXT REFERENCES use_cases(id) ON DELETE CASCADE,
  related_use_case_id TEXT REFERENCES use_cases(id),
  type TEXT NOT NULL,
  explanation TEXT,
  confidence NUMERIC(4,3),
  direction TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  requires_facilitator_decision BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  record_type TEXT,
  record_id TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audio_assets (
  id TEXT PRIMARY KEY,
  owner_user_id UUID REFERENCES users(id),
  session_id TEXT REFERENCES assessment_sessions(id),
  object_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  duration_ms INTEGER,
  transcript_status TEXT DEFAULT 'not_started',
  transcript_provider TEXT,
  transcript_confidence NUMERIC(4,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replaced_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON assessment_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_id ON conversation_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_use_cases_status ON use_cases(status);
CREATE INDEX IF NOT EXISTS idx_use_case_turns_use_case_id ON use_case_turns(use_case_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id ON refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_expires_at ON refresh_sessions(expires_at);
