-- Escrow flow redesign: add seller accept/reject, messages, expiry

-- 1. Add new columns to escrows
ALTER TABLE escrows
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 2. Backfill expires_at for existing deposited escrows (48h from creation)
UPDATE escrows
SET expires_at = created_at + interval '48 hours'
WHERE status = 'deposited' AND expires_at IS NULL;

-- 3. Create messages table for in-app DM between buyer and seller
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_escrow ON messages(escrow_id, created_at);

-- 4. Enable RLS on messages (but allow all via service role key from edge function)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all via service role" ON messages
  FOR ALL USING (true) WITH CHECK (true);
