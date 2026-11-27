-- Systemslab.ai comments: threads that people leave on anything in Practice, Lifecycle or Form, which an
-- admin of that app later marks incorporated or declined. The service knows nothing about the apps'
-- content: a thread points at a target by app, type and id, and optionally at a quoted piece of text
-- in one field of that target. Only this service reads these tables (row level security on, no
-- policies), like every table in the shared Supabase project.

CREATE TABLE comments.threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app TEXT NOT NULL,
  -- What the thread is on, e.g. ('item', 'PR-SM-001') in Practice or ('requirement', 'REQ-012') in Lifecycle.
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  -- The target's revision when the thread was started, if it has one.
  target_rev TEXT,
  -- The anchor, all empty for a comment on the target as a whole: which field, the quoted text, a few
  -- characters either side, and where it started, so the quote can be found again after edits.
  field TEXT,
  quote TEXT,
  prefix TEXT,
  suffix TEXT,
  start_offset INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'incorporated', 'declined')),
  resolution_note TEXT,
  -- For incorporated threads: the revision the change went into.
  resolved_rev TEXT,
  resolved_by UUID,
  resolved_by_name TEXT,
  resolved_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((field IS NULL) = (quote IS NULL))
);
CREATE INDEX threads_target_idx ON comments.threads (app, target_type, target_id);
CREATE INDEX threads_open_idx ON comments.threads (app, status, created_at);

-- The first comment of a thread is what was said when it was started; the rest are replies.
CREATE TABLE comments.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES comments.threads(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  -- Kept with the comment so the service does not join to another app's user table to show it.
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX comments_thread_idx ON comments.comments (thread_id, created_at);

-- People who may mark threads incorporated or declined in one app. Systemslab.ai admins (role 'admin')
-- may do so in every app.
CREATE TABLE comments.app_admins (
  app TEXT NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (app, user_id)
);

ALTER TABLE comments.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments.app_admins ENABLE ROW LEVEL SECURITY;
