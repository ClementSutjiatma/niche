-- Mac Mini Marketplace Migration
-- Transforms trading card marketplace to Mac Mini marketplace
-- Adds structured spec columns for hardware details

-- 1. Add structured Mac Mini columns to listings
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS chip TEXT,
  ADD COLUMN IF NOT EXISTS ram INTEGER,
  ADD COLUMN IF NOT EXISTS storage INTEGER,
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS year INTEGER,
  ADD COLUMN IF NOT EXISTS has_warranty BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_box BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_accessories TEXT;

-- 2. Delete all existing sample trading card listings
DELETE FROM escrows;
DELETE FROM listings;

-- 3. Insert 15 sample Mac Mini listings
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

  -- M4 base (3)
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status, chip, ram, storage, condition, year, has_warranty, includes_box, includes_accessories) VALUES
    (sample_user_id, 'Mac Mini M4 16GB/256GB', 460, 50, 'M4', 'Like-new M4 Mac Mini, barely used for 2 months. Perfect for dev work or home server. All ports working.', 'active', 'M4', 16, 256, 'like-new', 2024, false, true, 'power cable'),
    (sample_user_id, 'Mac Mini M4 16GB/512GB', 540, 75, 'M4', 'Brand new, sealed in box. Bought as backup but never opened. Full Apple warranty until Dec 2025.', 'active', 'M4', 16, 512, 'new', 2024, true, true, 'power cable'),
    (sample_user_id, 'Mac Mini M4 24GB/512GB', 650, 100, 'M4', 'Used as a daily driver for 4 months. Upgraded RAM config. Minor desk scuff on bottom, not visible when placed.', 'active', 'M4', 24, 512, 'good', 2024, false, false, 'power cable');

  -- M4 Pro (3)
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status, chip, ram, storage, condition, year, has_warranty, includes_box, includes_accessories) VALUES
    (sample_user_id, 'Mac Mini M4 Pro 24GB/512GB', 1250, 200, 'M4 Pro', 'Excellent condition M4 Pro. Used for ML training, runs cool and quiet. Apple warranty active.', 'active', 'M4 Pro', 24, 512, 'like-new', 2024, true, true, 'power cable, HDMI cable'),
    (sample_user_id, 'Mac Mini M4 Pro 24GB/1TB', 1450, 200, 'M4 Pro', 'New in box, sealed. Ordered wrong config and missed return window. Full warranty.', 'active', 'M4 Pro', 24, 1024, 'new', 2024, true, true, 'power cable'),
    (sample_user_id, 'Mac Mini M4 Pro 48GB/1TB', 1800, 300, 'M4 Pro', 'Maxed out M4 Pro config. Used as AI inference server for 3 months. Runs perfectly, no issues.', 'active', 'M4 Pro', 48, 1024, 'like-new', 2024, true, false, 'power cable');

  -- M4 Max (2)
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status, chip, ram, storage, condition, year, has_warranty, includes_box, includes_accessories) VALUES
    (sample_user_id, 'Mac Mini M4 Max 36GB/1TB', 2050, 400, 'M4 Max', 'Brand new sealed. Won in company raffle, already have one. Full Apple warranty.', 'active', 'M4 Max', 36, 1024, 'new', 2024, true, true, 'power cable'),
    (sample_user_id, 'Mac Mini M4 Max 64GB/2TB', 2800, 500, 'M4 Max', 'Top spec M4 Max. Used for video editing for 2 months. Absolute beast. Warranty active until 2026.', 'active', 'M4 Max', 64, 2048, 'like-new', 2024, true, false, 'power cable, USB-C cable');

  -- M2 (3)
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status, chip, ram, storage, condition, year, has_warranty, includes_box, includes_accessories) VALUES
    (sample_user_id, 'Mac Mini M2 8GB/256GB', 340, 50, 'M2', 'Solid M2 base model. Used as media server for a year. Works great, just upgrading to M4.', 'active', 'M2', 8, 256, 'good', 2023, false, false, 'power cable'),
    (sample_user_id, 'Mac Mini M2 16GB/512GB', 480, 75, 'M2', 'Upgraded M2 config, barely used. Kept as a secondary machine. Original box and packaging.', 'active', 'M2', 16, 512, 'like-new', 2023, false, true, 'power cable'),
    (sample_user_id, 'Mac Mini M2 Pro 16GB/512GB', 820, 120, 'M2 Pro', 'M2 Pro workhorse. Used for iOS development daily. Runs Xcode builds fast. Some thermal paste aging.', 'active', 'M2 Pro', 16, 512, 'good', 2023, false, false, 'power cable');

  -- M2 Pro (1)
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status, chip, ram, storage, condition, year, has_warranty, includes_box, includes_accessories) VALUES
    (sample_user_id, 'Mac Mini M2 Pro 32GB/1TB', 1100, 180, 'M2 Pro', 'High-spec M2 Pro. Was my main dev machine for 18 months. Still runs everything smoothly.', 'active', 'M2 Pro', 32, 1024, 'good', 2023, false, false, 'power cable');

  -- M1 (2)
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status, chip, ram, storage, condition, year, has_warranty, includes_box, includes_accessories) VALUES
    (sample_user_id, 'Mac Mini M1 8GB/256GB', 280, 40, 'M1', 'Original M1 Mac Mini. Still surprisingly capable. Used as home server. Minor wear on casing.', 'active', 'M1', 8, 256, 'good', 2020, false, false, 'power cable'),
    (sample_user_id, 'Mac Mini M1 16GB/512GB', 380, 60, 'M1', 'Upgraded M1 with 16GB. Showing age but still solid for web dev and light tasks. Comes with original box.', 'active', 'M1', 16, 512, 'fair', 2020, false, true, 'power cable');

  -- M4 Pro (1 more)
  INSERT INTO listings (user_id, item_name, price, min_deposit, category, item_description, status, chip, ram, storage, condition, year, has_warranty, includes_box, includes_accessories) VALUES
    (sample_user_id, 'Mac Mini M4 Pro 48GB/2TB', 2100, 350, 'M4 Pro', 'Top storage M4 Pro. Used for large model training, handles everything. Upgrading to Max.', 'active', 'M4 Pro', 48, 2048, 'good', 2024, false, false, 'power cable');

END $$;

-- 4. Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_listings_chip ON listings(chip);
CREATE INDEX IF NOT EXISTS idx_listings_ram ON listings(ram);
CREATE INDEX IF NOT EXISTS idx_listings_condition ON listings(condition);
