-- Add Twitter/X username to users table for social trust
-- This allows displaying X badges on listings

-- 1. Add twitter_username column to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS twitter_username TEXT,
  ADD COLUMN IF NOT EXISTS twitter_user_id TEXT;

-- 2. Create index for faster lookups by Twitter ID
CREATE INDEX IF NOT EXISTS idx_users_twitter_id ON users(twitter_user_id);

-- 3. Update channel_type enum to support 'twitter' (if using enum)
-- Note: If channel_type is TEXT, this is not needed
-- For now, we'll store 'twitter' as a string value

-- 4. Add unique constraint on twitter_user_id (optional, prevents duplicates)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_twitter_user_id') THEN
    ALTER TABLE users ADD CONSTRAINT unique_twitter_user_id UNIQUE (twitter_user_id);
  END IF;
END $$;
