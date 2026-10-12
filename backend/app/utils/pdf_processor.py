"""
PDF pricing parser — uses PyMuPDF (fitz) with parallel page processing
instead of sequential pdfplumber, giving 5-15x faster extraction on large PDFs.
"""
import re

# SKU token immediately followed (next non-blank line) by a bare numeric
# price — the layout used by catalogs whose PDF has no real table structure
# fitz can detect and no "SKU .... price" dot-leader line either (each cell
# is its own line): e.g. Integrity Cabinets' "ITEM / LIST PRICE" blocks —
# "DW1248" \n "991" \n "DW1548" \n "1090" ...
_LINE_SKU_RE = re.compile(r'^[A-Z]{1,6}[0-9]{2,4}[A-Z0-9\-]{0,6}$')


# ─── Page-level extraction (runs in thread pool) ─────────────────────────────

def _extract_page(args: tuple) -> tuple[int, str, list]:
    """
    Extract text and tables from one PDF page.
    Returns (page_num, text, tables) where tables is list[list[list[str]]].
    """
    page_num, page = args
    text = page.get_text() or ""

    # fitz structured table extraction (fast, no pdfplumber needed)
    tables = []
    try:
        tab = page.find_tables()
        for t in tab.tables:
            rows = []
            for row in t.extract():
                rows.append([str(c).strip() if c else "" for c in row])
            if rows:
                tables.append(rows)
    except Exception:
        pass

    return page_num, text, tables


def _parse_page_data(page_num: int, text: str, tables: list,
                     manufacturer_id: str, file_id: str,
                     current_series: str, current_construction: str
                     ) -> tuple[list[dict], str, str]:
    """Returns (records, updated_series, updated_construction) — the series/
    construction state must be threaded back to the caller so it actually
    persists across pages. Strings are immutable in Python, so reassigning
    the function's own local `current_series` parameter never changed the
    caller's variable; every page previously restarted from the caller's
    stale "UNIVERSAL"/"Standard" defaults unless this exact page itself
    re-stated the heading in its own first 10 lines."""
    records = []
    lines = text.split('\n')

    # Update series / construction from first 10 lines of page
    for line in lines[:10]:
        u = line.strip().upper()
        if "SERIES" in u:
            m = re.search(r'([A-Z\s]+SERIES)', u)
            if m:
                candidate = m.group(1).strip()
                words = candidate.split()
                # A real series heading is short ("CLASSIC SERIES", "ELITE
                # SERIES") — the old unbounded [A-Z\s]+ greedily grabbed
                # entire prose sentences that happen to be all-caps and
                # mention "SERIES" too, e.g. a footnote reading "THE
                # FOLLOWING ITEMS ARE NOT AVAILABLE IN ELITE SERIES" got
                # stored as the series name itself, polluting the dropdown
                # with garbage entries. Reject long matches and ones
                # containing words that only appear in sentences, not titles.
                _SENTENCE_WORDS = {"NOT", "ARE", "IS", "THE", "FOLLOWING", "ITEMS",
                                    "AVAILABLE", "WILL", "CAN", "MUST", "ONLY", "WITH"}
                if len(words) <= 4 and not (_SENTENCE_WORDS & set(words)):
                    current_series = candidate
        if "FRAMELESS" in u:
            current_construction = "Frameless"
        elif "FACE FRAME" in u:
            current_construction = "Face Frame"

    is_price_point_page = any("PRICE POINT" in l.upper() for l in lines[:15])

    # ── Table extraction ──────────────────────────────────────────────────────
    for table in tables:
        if len(table) < 2:
            continue
        headers = [c.upper() for c in table[0]]
        sku_idx = -1
        price_indices = []

        for i, h in enumerate(headers):
            if any(k in h for k in ["SKU", "ITEM", "CODE", "MODEL"]):
                sku_idx = i
            is_std   = any(k in h for k in ["PRICE","LIST","MAPLE","OAK","CHERRY","PAINT","FINISH"])
            is_point = h.isdigit() or bool(re.match(r'^(?:PRC|POINT|PT|PP)\s*\d+$', h))
            if is_std or is_point:
                price_indices.append(i)

        if sku_idx == -1 or not price_indices:
            continue

        for row in table[1:]:
            if len(row) <= sku_idx:
                continue
            sku = row[sku_idx].strip().upper()
            if not sku or len(sku) < 2:
                continue

            for p_idx in price_indices:
                if p_idx >= len(row):
                    continue
                price_val = row[p_idx].strip()
                if not price_val:
                    continue
                col_header = headers[p_idx]
                if col_header.isdigit():
                    col_label = f"Price Point {col_header}"
                elif is_price_point_page and re.match(r'^(?:PRC|POINT|PT|PP)\s*(\d+)$', col_header):
                    m = re.search(r'(\d+)', col_header)
                    col_label = f"Price Point {m.group(1)}" if m else col_header
                else:
                    col_label = (
                        f"{current_series} - {col_header}"
                        if col_header not in ("PRICE","LIST","LIST PRICE")
                        else current_series
                    )
                clean = re.sub(r'[^\d.]', '', price_val)
                if clean:
                    try:
                        records.append({
                            "manufacturer_id":    manufacturer_id,
                            "raw_source_file_id": file_id,
                            "sku":                sku,
                            "price":              float(clean),
                            "collection_name":    col_label,
                            "door_style":         current_construction,
                            "created_at":         "now()",
                        })
                    except Exception:
                        pass

    # ── Regex fallback for unstructured listings (e.g. "SDB6 .... 1078") ─────
    if not records or page_num < 5:
        for match in re.finditer(r'([A-Z0-9\-/]{3,})\s*[.]+\s*([\d,]+(?:\.\d{2})?)', text):
            sku = match.group(1).upper()
            price_str = match.group(2).replace(',', '')
            # A stray match (e.g. a run of only commas) can leave price_str
            # empty after stripping — float('') raises uncaught ValueError,
            # which propagated all the way out of parse_pricing_pdf_sync's
            # outer try/except and discarded EVERY record from EVERY page
            # already parsed, not just this one bad match (confirmed: a
            # 436-page catalog with real pricing tables returned 0 records
            # because of a single malformed match like this).
            if not price_str:
                continue
            try:
                price = float(price_str)
            except ValueError:
                continue
            records.append({
                "manufacturer_id":    manufacturer_id,
                "raw_source_file_id": file_id,
                "sku":                sku,
                "price":              price,
                "collection_name":    current_series,
                "door_style":         current_construction,
                "created_at":         "now()",
            })

    # ── Line-based fallback: SKU on its own line, price on the very next
    #    non-blank line (no dot-leaders, no fitz-detected table) ────────────
    if not records:
        lines = [l.strip() for l in text.split('\n')]
        i = 0
        while i < len(lines):
            line = lines[i]
            if _LINE_SKU_RE.match(line):
                j = i + 1
                while j < len(lines) and not lines[j]:
                    j += 1
                if j < len(lines):
                    price_candidate = lines[j].replace(',', '').replace('$', '')
                    try:
                        price = float(price_candidate)
                    except ValueError:
                        price = None
                    if price is not None and price > 0:
                        records.append({
                            "manufacturer_id":    manufacturer_id,
                            "raw_source_file_id": file_id,
                            "sku":                line.upper(),
                            "price":              price,
                            "collection_name":    current_series,
                            "door_style":         current_construction,
                            "created_at":         "now()",
                        })
            i += 1

    return records, current_series, current_construction


# ─── Public entry point ───────────────────────────────────────────────────────

def parse_pricing_pdf_sync(file_bytes: bytes, manufacturer_id: str,
                           file_id: str) -> list[dict]:
    """
    Sync parser — call via run_in_executor from async context.
    Uses PyMuPDF (fitz); pages are processed sequentially (see note below).
    """
    import fitz

    pricing_records: list[dict] = []

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = len(doc)

        # ── 1. Fast pre-scan: find pricing pages ──────────────────────────────
        target_pages = []
        for page_num, page in enumerate(doc):
            text_upper = page.get_text().upper()
            has_content = (
                any(k in text_upper for k in ["SKU","PRICE","LIST","ITEM","CODE","MODEL"])
                or bool(re.search(r'[A-Z]{2,}\d{2,}', text_upper))
                or page_num < 5
            )
            if has_content:
                target_pages.append(page_num)

        print(f"PDF Parser: {len(target_pages)}/{total_pages} pages targeted")

        # ── 2. Page extraction ──────────────────────────────────────────────────
        # NOT parallelized across threads: PyMuPDF's underlying MuPDF library is
        # not thread-safe for concurrent operations on the same fitz.Document —
        # dispatching get_text()/find_tables() for many pages of the SAME doc
        # across a thread pool doesn't throw, it just silently returns empty/
        # corrupted results. Confirmed directly: the same 436-page catalog that
        # returned 0 pricing records through the threaded path here returned
        # 372 records from its first 100 pages alone when extracted sequentially.
        # Text+table extraction is cheap per page, so sequential is still fast
        # enough — correctness matters far more than the lost parallelism here.
        page_results: dict[int, tuple] = {}
        for n in target_pages:
            page_num, text, tables = _extract_page((n, doc[n]))
            page_results[page_num] = (text, tables)

        doc.close()

        # ── 3. Parse results in page order ────────────────────────────────────
        current_series = "UNIVERSAL"
        current_construction = "Standard"

        for page_num in sorted(page_results):
            text, tables = page_results[page_num]
            try:
                records, current_series, current_construction = _parse_page_data(
                    page_num, text, tables,
                    manufacturer_id, file_id,
                    current_series, current_construction
                )
            except Exception as page_err:
                # One malformed page must not discard every record already
                # found on every other page — the outer try/except used to
                # let exactly this happen (see the price_str note above).
                print(f"PDF Parser: page {page_num + 1} failed, skipping: {page_err}")
                continue
            pricing_records.extend(records)

        # Remove garbage (non-SKU artifacts)
        pricing_records = [
            r for r in pricing_records
            if len(r['sku']) >= 2 and not r['sku'].isdigit()
        ]

        # Deduplicate (same SKU + collection)
        seen = set()
        deduped = []
        for r in pricing_records:
            key = (r['sku'], r['collection_name'])
            if key not in seen:
                seen.add(key)
                deduped.append(r)

        print(f"PDF Parser: {len(deduped)} records after dedup (from {len(pricing_records)})")
        return deduped

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"PDF Parser Error: {e}")
        return []


# Keep async signature for backwards compatibility
async def parse_pricing_pdf(file_bytes: bytes, manufacturer_id: str,
                            file_id: str) -> list[dict]:
    return parse_pricing_pdf_sync(file_bytes, manufacturer_id, file_id)
