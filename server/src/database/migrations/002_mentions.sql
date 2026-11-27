-- People mentioned in a comment. The comment body holds each mention as @[Name](user id), so it reads the
-- same wherever it is shown; this table lets a person find every thread they were mentioned in.
CREATE TABLE comments.mentions (
  comment_id UUID NOT NULL REFERENCES comments.comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX mentions_user_idx ON comments.mentions (user_id);

ALTER TABLE comments.mentions ENABLE ROW LEVEL SECURITY;
