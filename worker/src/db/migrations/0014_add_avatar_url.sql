-- 0014_add_avatar_url.sql
-- Add avatar_url to x_identities for profile picture display
ALTER TABLE x_identities ADD COLUMN avatar_url TEXT;
