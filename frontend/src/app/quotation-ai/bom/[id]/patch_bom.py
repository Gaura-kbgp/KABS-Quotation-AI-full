import os

tfile = r'c:\KABS completed project files\KABS-Quotation-AI-full-main\frontend\src\app\quotation-ai\bom\[id]\bom-manager-client.tsx'
with open(tfile, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the <TableCell> block containing matched_sku
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'matched_sku' in line and 'font-mono' in line:
        # Walk back to find opening <TableCell>
        for j in range(i, max(0, i-5), -1):
            if '<TableCell>' in lines[j] and '</TableCell>' not in lines[j]:
                start_idx = j
                break
        # Walk forward to find the closing </TableCell>
        for j in range(i, min(len(lines), i+5)):
            if '</TableCell>' in lines[j]:
                end_idx = j
                break
        break

if start_idx is None or end_idx is None:
    print(f'ERROR: Could not find block. start={start_idx}, end={end_idx}')
    exit(1)

print(f'Replacing lines {start_idx} to {end_idx}')
for j in range(start_idx, end_idx+1):
    print(f'  {j}: {repr(lines[j][:80])}')

# Determine indentation from existing line
indent = '                                      '  # 38 spaces (match existing)

new_lines = [
    indent + '<TableCell>\n',
    indent + '  <div className="font-bold text-slate-900 text-sm leading-tight">{item.sku}</div>\n',
    indent + '  {(() => {\n',
    indent + '    const badge = getPrecisionBadge(item.precision_level);\n',
    indent + '    const ref = item.price_reference || item.matched_sku;\n',
    indent + "    const isEstimated = item.precision_level === 'CATEGORY_AVERAGE' || item.precision_level === 'MANUAL_PRICING_REQUIRED';\n",
    indent + "    const isNearest = (item.precision_level || '').toUpperCase().startsWith('NEAREST_DIM');\n",
    indent + '    return (\n',
    indent + '      <div className="mt-1 space-y-0.5">\n',
    indent + '        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>\n',
    indent + "          {isEstimated ? '\u26a0 ' : isNearest ? '\u2248 ' : '\u2713 '}{badge.label}\n",
    indent + '        </span>\n',
    indent + '        {ref && ref !== item.sku && (\n',
    indent + '          <div className={`text-[9px] font-mono truncate max-w-[200px] mt-0.5 ${\n',
    indent + "            isEstimated ? 'text-orange-500' : isNearest ? 'text-amber-600' : 'text-slate-400'\n",
    indent + '          }`} title={ref}>\n',
    indent + '            {ref}\n',
    indent + '          </div>\n',
    indent + '        )}\n',
    indent + '      </div>\n',
    indent + '    );\n',
    indent + '  })()}\n',
    indent + '</TableCell>\n',
]

lines = lines[:start_idx] + new_lines + lines[end_idx+1:]

with open(tfile, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f'SUCCESS: replaced {end_idx-start_idx+1} lines with {len(new_lines)} new lines')
