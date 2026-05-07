-- Update quotation_boms to support installation points and prices
ALTER TABLE quotation_boms ADD COLUMN IF NOT EXISTS install_points NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE quotation_boms ADD COLUMN IF NOT EXISTS install_price NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE quotation_boms ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT TRUE;
