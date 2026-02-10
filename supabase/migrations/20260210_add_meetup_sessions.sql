-- Meetup coordination: track phone submission status + HMAC hashes for webhook matching
-- No phone numbers or meetup details stored — only booleans and irreversible hashes

CREATE TABLE IF NOT EXISTS meetup_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  buyer_phone_submitted BOOLEAN NOT NULL DEFAULT false,
  seller_phone_submitted BOOLEAN NOT NULL DEFAULT false,
  buyer_phone_hash TEXT,
  seller_phone_hash TEXT,
  buyer_phone_enc TEXT,    -- AES-GCM encrypted, decryptable only by edge function
  seller_phone_enc TEXT,   -- AES-GCM encrypted, decryptable only by edge function
  conversation_history JSONB NOT NULL DEFAULT '[]'::jsonb,  -- LLM agent context
  safety_tip_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetup_sessions_escrow ON meetup_sessions(escrow_id);
CREATE INDEX IF NOT EXISTS idx_meetup_sessions_buyer_hash ON meetup_sessions(buyer_phone_hash);
CREATE INDEX IF NOT EXISTS idx_meetup_sessions_seller_hash ON meetup_sessions(seller_phone_hash);

ALTER TABLE meetup_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON meetup_sessions
  FOR ALL USING (true) WITH CHECK (true);
