-- Run these SQL commands in the Supabase SQL Editor
-- (https://supabase.com/dashboard/project/rmfoquszgkuntfhlkhcd/sql/new)

-- 1) Change pois id from serial to text for frontend compatibility
ALTER TABLE pois ALTER COLUMN id TYPE text;
ALTER TABLE pois ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS pois_id_seq;

-- 2) Add missing columns to pois
ALTER TABLE pois ADD COLUMN IF NOT EXISTS color text DEFAULT '#e94560';
ALTER TABLE pois ADD COLUMN IF NOT EXISTS region text DEFAULT '';

-- 3) Add a fixed row for paint state (tool='_state' holds full paint array in points)
INSERT INTO paint (id, tool, points) VALUES (0, '_state', '[]')
ON CONFLICT (id) DO NOTHING;
