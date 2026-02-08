-- Trading Card Marketplace Migration
-- This migration transforms the house sublet marketplace to trading cards
-- with partial deposit + remaining payment flow

-- 1. Delete all existing listings and escrows (fresh start)
DELETE FROM escrows;
DELETE FROM listings;

-- 2. Add new columns to listings
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS min_deposit NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS item_description TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT;

-- 3. Drop old house-related columns (if they exist)
ALTER TABLE listings
  DROP COLUMN IF EXISTS neighborhood,
  DROP COLUMN IF EXISTS rooms,
  DROP COLUMN IF EXISTS date_start,
  DROP COLUMN IF EXISTS date_end,
  DROP COLUMN IF EXISTS description;

-- 4. Rename escrows.amount to deposit_amount (if not already renamed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'escrows' AND column_name = 'amount'
  ) THEN
    ALTER TABLE escrows RENAME COLUMN amount TO deposit_amount;
  END IF;
END $$;

-- 5. Add new columns to escrows
ALTER TABLE escrows
  ADD COLUMN IF NOT EXISTS total_price NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_payment_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS remaining_payment_confirmed_at TIMESTAMP WITH TIME ZONE;

-- 6. Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_escrows_remaining_payment ON escrows(remaining_payment_tx_hash);

-- 7. Insert sample trading card listings
-- Get the first user ID for ownership
DO $$
DECLARE
  sample_user_id UUID;
BEGIN
  SELECT id INTO sample_user_id FROM users LIMIT 1;

  -- If no users exist, create a placeholder
  IF sample_user_id IS NULL THEN
    INSERT INTO users (channel_id, channel_type, wallet_address, display_name)
    VALUES ('sample@example.com', 'email', '0x0000000000000000000000000000000000000000', 'Sample User')
    RETURNING id INTO sample_user_id;
  END IF;

  -- Insert Pokemon cards
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status) VALUES
    (sample_user_id, 'Charizard Base Set 1st Edition', 50, 10, 'Pokemon', 'Mint condition, original 1999 print. PSA 9 grade.', 'active'),
    (sample_user_id, 'Blastoise Base Set', 30, 8, 'Pokemon', 'Near mint, holographic, classic water starter.', 'active'),
    (sample_user_id, 'Pikachu Illustrator', 150, 50, 'Pokemon', 'Ultra rare promo card from 1998 CoroCoro Comic contest.', 'active'),
    (sample_user_id, 'Mewtwo EX Full Art', 25, 5, 'Pokemon', 'Full art from BREAKthrough set, excellent condition.', 'active'),
    (sample_user_id, 'Rayquaza VMAX Rainbow', 40, 10, 'Pokemon', 'Rainbow rare from Evolving Skies, pack fresh.', 'active');

  -- Insert Magic: The Gathering cards
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status) VALUES
    (sample_user_id, 'Black Lotus Alpha', 200, 75, 'Magic', 'Graded BGS 8.5, iconic Power Nine card.', 'active'),
    (sample_user_id, 'Mox Sapphire', 100, 30, 'Magic', 'Unlimited edition, lightly played condition.', 'active'),
    (sample_user_id, 'Tarmogoyf Future Sight', 35, 10, 'Magic', 'Modern staple, near mint condition.', 'active'),
    (sample_user_id, 'Liliana of the Veil', 45, 12, 'Magic', 'Innistrad original printing, mint.', 'active');

  -- Insert Sports cards
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status) VALUES
    (sample_user_id, 'Michael Jordan 1986 Fleer Rookie', 120, 40, 'Sports', 'PSA 8 graded, iconic basketball rookie card.', 'active'),
    (sample_user_id, 'Tom Brady 2000 Playoff Contenders Auto', 80, 25, 'Sports', 'BGS 9 with auto grade 10, legendary QB rookie.', 'active'),
    (sample_user_id, 'Mike Trout 2009 Bowman Chrome Auto', 60, 20, 'Sports', 'PSA 9, modern baseball icon.', 'active'),
    (sample_user_id, 'LeBron James 2003 Topps Chrome Rookie', 55, 15, 'Sports', 'Raw card, excellent centering and edges.', 'active');

  -- Insert Yu-Gi-Oh cards
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status) VALUES
    (sample_user_id, 'Blue-Eyes White Dragon 1st Edition', 28, 8, 'Yu-Gi-Oh', 'LOB 1st edition, light play condition.', 'active'),
    (sample_user_id, 'Dark Magician Girl MFC 1st', 22, 6, 'Yu-Gi-Oh', 'Magicians Force 1st edition, near mint.', 'active');
END $$;
