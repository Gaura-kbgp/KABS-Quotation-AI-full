-- Staff must explicitly confirm a provisional catalog match (nearest-size, category
-- average, manual-pricing-required, estimated door/drawer) before a quotation can be
-- approved or sent. Without this column, setReviewStatusAction() had no way to tell
-- a verified price from an unreviewed guess, and the UI badge (bom-manager-client.tsx)
-- was informational only — staff could approve a quote with a $0 or averaged line item
-- still in it.
ALTER TABLE quotation_boms ADD COLUMN IF NOT EXISTS price_confirmed BOOLEAN DEFAULT FALSE;

-- Backfill: anything already approved/sent under the old rules is grandfathered in as
-- confirmed, so this gate only affects quotes reviewed from here on.
UPDATE quotation_boms b
SET price_confirmed = TRUE
FROM quotation_projects p
WHERE b.project_id = p.id
  AND p.review_status IN ('approved', 'sent');

-- Exact/compressed/fuzzy/dimension matches are reliable enough to not need a manual
-- click from staff on every line item of every project — only the tiers that already
-- get an amber/orange/red badge in the UI do.
UPDATE quotation_boms
SET price_confirmed = TRUE
WHERE price_confirmed = FALSE
  AND precision_level IS NOT NULL
  AND UPPER(precision_level) NOT LIKE 'NEAREST_DIM%'
  AND UPPER(precision_level) NOT IN ('CATEGORY_AVERAGE', 'MANUAL_PRICING_REQUIRED', 'ESTIMATED_DOOR_DRAWER');
