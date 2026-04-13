
import os

tfile = r'c:\KABS completed project files\KABS-Quotation-AI-full-main\frontend\src\app\quotation-ai\bom\[id]\bom-manager-client.tsx'
with open(tfile, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the TableCell that contains 'price_reference || item.matched_sku'
start_idx = None
end_idx = None

for i, line in enumerate(lines):
    if '<TableCell>' in line and start_idx is None:
        # Look ahead to see if this TableCell contains our code
        for j in range(i, min(len(lines), i+5)):
            if 'price_reference' in lines[j] or 'matched_sku' in lines[j]:
                start_idx = i
                break
    if start_idx is not None and '</TableCell>' in line and i > start_idx:
        end_idx = i
        break

if start_idx is None or end_idx is None:
    print(f'ERROR: start={start_idx} end={end_idx}')
    exit(1)

print(f'Block found: lines {start_idx+1} to {end_idx+1}')

ind = '                                      '  # 38 spaces

new_lines = [
    ind + '<TableCell>\n',
    ind + '  <div className="font-bold text-slate-900 text-sm leading-tight">{item.sku}</div>\n',
    ind + '  {(() => {\n',
    ind + '    const badge = getPrecisionBadge(item.precision_level);\n',
    ind + '    const rawRef = item.price_reference || item.matched_sku || \'\';\n',
    ind + '    const isEstimated = item.precision_level === \'CATEGORY_AVERAGE\' || item.precision_level === \'MANUAL_PRICING_REQUIRED\';\n',
    ind + '    const isNearest = (item.precision_level || \'\').toUpperCase().startsWith(\'NEAREST_DIM\');\n',
    ind + '    // Parse "Catalog Ref: SKUCODE [COLLECTION] (avg...)" or "Ref: SKUCODE [...]"\n',
    ind + '    const refMatch = rawRef.match(/^(?:Ref:|Catalog Ref:)\\s*([A-Z0-9][A-Z0-9\\-\\.\\s]*?)(?:\\s*\\[|\\s*\\(|$)/i);\n',
    ind + '    const catalogSku = refMatch ? refMatch[1].trim() : (item.matched_sku || \'\');\n',
    ind + '    const colMatch = rawRef.match(/\\[([^\\]]+)\\]/);\n',
    ind + '    const catalogCol = colMatch ? colMatch[1] : \'\';\n',
    ind + '    const avgNote = rawRef.match(/\\(([^)]+)\\)/);\n',
    ind + '    const avgText = avgNote ? avgNote[1] : \'\';\n',
    ind + '    return (\n',
    ind + '      <div className="mt-1 space-y-1">\n',
    ind + '        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>\n',
    ind + '          {isEstimated ? \'\u26a0 \' : isNearest ? \'\u2248 \' : \'\u2713 \'}{badge.label}\n',
    ind + '        </span>\n',
    ind + '        {catalogSku && catalogSku !== item.sku && (\n',
    ind + '          <div className="flex items-center gap-1 mt-0.5 flex-wrap">\n',
    ind + '            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap">Catalog Ref:</span>\n',
    ind + '            <span\n',
    ind + '              className={`text-[10px] font-black font-mono px-1.5 py-0.5 rounded ${\n',
    ind + '                isEstimated ? \'bg-orange-50 text-orange-700 border border-orange-200\' :\n',
    ind + '                isNearest ? \'bg-amber-50 text-amber-700 border border-amber-200\' :\n',
    ind + '                \'bg-emerald-50 text-emerald-700 border border-emerald-200\'\n',
    ind + '              }`}\n',
    ind + '              title={rawRef}\n',
    ind + '            >\n',
    ind + '              {catalogSku}\n',
    ind + '            </span>\n',
    ind + '            {catalogCol && <span className="text-[8px] text-slate-400 font-mono">[{catalogCol}]</span>}\n',
    ind + '          </div>\n',
    ind + '        )}\n',
    ind + '        {avgText && (\n',
    ind + '          <div className="text-[8px] text-slate-400 leading-tight">{avgText}</div>\n',
    ind + '        )}\n',
    ind + '      </div>\n',
    ind + '    );\n',
    ind + '  })()}\n',
    ind + '</TableCell>\n',
]

lines = lines[:start_idx] + new_lines + lines[end_idx+1:]

with open(tfile, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f'SUCCESS: upgraded cell (lines {start_idx+1}-{end_idx+1} -> {len(new_lines)} new lines)')
