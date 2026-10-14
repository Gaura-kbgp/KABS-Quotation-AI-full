-- Elevate's pricing worksheet was a single org-wide row (name='Default'), with no
-- link to any quotation_project — so it could never share a BOM, a pricing engine,
-- or a staff review with the main pipeline (confirmed during the integration audit:
-- only one such row existed in production, for one org).
--
-- This adds an optional project_id so a worksheet can belong to one project. The
-- existing (org_id, name) unique constraint is left untouched — per-project rows
-- use name = the project's id (as text), so uniqueness still falls out of the
-- existing constraint with no need to touch it or juggle partial indexes. The
-- original org-wide row (project_id IS NULL, name='Default') stays as-is, a
-- standalone scratchpad/calculator unrelated to any project.

ALTER TABLE public.elevate_pricing_profiles
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.quotation_projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS elevate_pricing_profiles_project_idx
  ON public.elevate_pricing_profiles (project_id);
