# Elevate Design and Pricing: Requirements

## Purpose

A staff-operated design and pricing tool. It turns a dimensioned kitchen plan into a reviewable cabinet layout, a manufacturer-specific SKU schedule, and a price estimate. Elevate can revise the layout, door style, finish, or cabinet line and see the estimate recalculate.

Initial release covers **Integrity, Wellborn, and Shiloh** and includes the pricing workflow previously proposed.

## Design and pricing workflow

1. Upload a legible, dimensioned blueprint, PDF plan, or measured drawing. The agent identifies walls, openings, key dimensions, appliance locations, and plumbing locations where shown.
2. Generate an initial kitchen cabinet layout using the selected manufacturer's available sizes, configurations, and design rules. Flag missing or uncertain dimensions for staff input.
3. Map the proposed cabinets and trim to actual catalog items and SKUs where the manufacturer data supports a reliable match. Show any unresolved or substituted items for review.
4. Let Elevate staff adjust cabinet sizes and positions, appliance placement, door style, finish, and manufacturer. Rebuild the SKU schedule and estimate after changes.
5. Show a readable plan view, an itemized cabinet and trim list, and a budget estimate. Price hardware, installation, delivery, freight, and 3PL as separate amounts using Elevate's supplied rules.
6. Also accept a 2020 design PDF or product list for pricing without generating a new layout. Extract items and quantities for staff review, apply builder-specific templates, discounts, markups, and gross-profit targets, and produce an internal worksheet and customer-facing price summary.

**Rule:** Staff approves the measurements, layout, product choices, and price before anything is released to a customer. The system will not present an uncertain SKU as verified.

## Manufacturer data and training examples

Elevate will supply current, authorized catalogs and price lists for Integrity, Wellborn, and Shiloh, including available sizes, modifications, door styles, finishes, trim, and relevant design restrictions. It will also supply its hardware, installation, delivery, freight, 3PL, and margin rules.

KABS will retain the pricing source and effective date, configure the three lines, and map common cabinet functions so staff can compare equivalent layouts across lines. Manufacturer-specific differences will be flagged.

Elevate will provide completed kitchen examples for each manufacturer:
- the original dimensioned plan,
- the final design or cabinet schedule with SKUs,
- the final quote or price worksheet.

Five complete examples per line are the minimum to begin validation; 15 to 20 per line are the target. Examples may be supplied in stages and used to test extraction, layout and SKU matching, review errors, and refine rules.

## Scope and acceptance

**In scope:** Elevate staff, kitchens with clear dimensions and conventional cabinet configurations.

**Acceptance:** At final acceptance, Elevate and KABS review at least one representative completed job from each of the three lines. For each job the tool must:
- import the plan,
- produce an editable layout,
- show a manufacturer-specific SKU list with exceptions identified,
- recalculate an estimate after a line or door-style change,
- price a supplied 2020 design PDF or product list using Elevate's cost and margin rules.

Staff compare results to the known design and correct them before approval. Issues are logged and either resolved or expressly accepted as limitations.

**Out of scope:** construction-ready drawings, photorealistic renderings, structural or code review, unattended ordering, exact equivalence where a manufacturer does not offer a matching cabinet, direct editing of native 2020 files, manufacturer ordering integrations, bathrooms, countertops, flooring, backsplash, and other room types.

## Status

- Phase A (2020 PDF / product list pricing): not started. Needs Elevate's 2020 file and pricing rules.
- Phase B (catalog ingest and SKU matching): needs Integrity, Wellborn, Shiloh price lists.
- Phase C (dimensioned plan and layout): largest part, needs examples.
- Phase D (editing, estimate, customer summary): depends on A–C.
- Waiting on from Elevate: catalogs, price lists, hardware/install/delivery/freight/3PL/margin rules, completed examples.
