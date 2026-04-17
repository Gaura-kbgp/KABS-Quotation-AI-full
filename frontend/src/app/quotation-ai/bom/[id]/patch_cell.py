
# Patch script: upgrades the BOM table CAB Code cell to show catalog reference clearly
# Works on LF-normalized content
import os

tfile = r'c:\KABS completed project files\KABS-Quotation-AI-full-main\frontend\src\app\quotation-ai\bom\[id]\bom-manager-client.tsx'
with open(tfile, 'r', encoding='utf-8') as f:
    content = f.read()

# Normalize to LF for finding
normalized = content.replace('\r\n', '\n')

# Find the TableCell block we want to replace (lines 708-730)
OLD = '''                                       <TableCell>
                                         <div className="font-bold text-slate-900 text-sm leading-tight">{item.sku}</div>
                                         {(() => {
                                           const badge = getPrecisionBadge(item.precision_level);
                                           const ref = item.price_reference || item.matched_sku;
                                           const isEstimated = item.precision_level === 'CATEGORY_AVERAGE' || item.precision_level === 'MANUAL_PRICING_REQUIRED';
                                           const isNearest = (item.precision_level || '').toUpperCase().startsWith('NEAREST_DIM');
                                           return (
                                             <div className="mt-1 space-y-0.5">
                                               <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>
                                                 {isEstimated ? '\u26a0 ' : isNearest ? '\u2248 ' : '\u2713 '}{badge.label}
                                               </span>
                                               {ref && ref !== item.sku && (
                                                 <div className={`text-[9px] font-mono truncate max-w-[200px] mt-0.5 ${
                                                   isEstimated ? 'text-orange-500' : isNearest ? 'text-amber-600' : 'text-slate-400'
                                                 }`} title={ref}>
                                                   {ref}
                                                 </div>
                                               )}
                                             </div>
                                           );
                                         })()}
                                       </TableCell>'''

NEW = '''                                       <TableCell>
                                         <div className="font-bold text-slate-900 text-sm leading-tight">{item.sku}</div>
                                         {(() => {
                                           const badge = getPrecisionBadge(item.precision_level);
                                           const rawRef = item.price_reference || item.matched_sku || '';
                                           const isEstimated = item.precision_level === 'CATEGORY_AVERAGE' || item.precision_level === 'MANUAL_PRICING_REQUIRED';
                                           const isNearest = (item.precision_level || '').toUpperCase().startsWith('NEAREST_DIM');
                                           // Parse "Catalog Ref: SKU [COLLECTION] (avg...)" format
                                           const catalogRefMatch = rawRef.match(/^(?:Ref:|Catalog Ref:)\\s*([A-Z0-9\\-\\.]+(?:\\s[A-Z0-9\\-\\.]*)*)/i);
                                           const catalogSku = catalogRefMatch ? catalogRefMatch[1].trim() : (item.matched_sku || '');
                                           const fullRefNote = rawRef;
                                           return (
                                             <div className="mt-1 space-y-1">
                                               <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.cls}`}>
                                                 {isEstimated ? '\u26a0 ' : isNearest ? '\u2248 ' : '\u2713 '}{badge.label}
                                               </span>
                                               {catalogSku && catalogSku !== item.sku && (
                                                 <div className="flex items-center gap-1 mt-0.5">
                                                   <span className="text-[8px] font-black uppercase tracking-wider text-slate-400">Catalog Ref:</span>
                                                   <span className={`text-[10px] font-black font-mono px-1.5 py-0.5 rounded ${
                                                     isEstimated ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                                                     isNearest ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                                     'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                   }`} title={fullRefNote}>
                                                     {catalogSku}
                                                   </span>
                                                 </div>
                                               )}
                                               {fullRefNote && fullRefNote !== catalogSku && rawRef.includes('avg') && (
                                                 <div className="text-[8px] text-slate-400 mt-0.5 max-w-[220px] leading-tight" title={fullRefNote}>
                                                   {fullRefNote.replace(/^(?:Ref:|Catalog Ref:)\\s*[^\\[\\(]+/, '').trim()}
                                                 </div>
                                               )}
                                             </div>
                                           );
                                         })()}
                                       </TableCell>'''

if OLD in normalized:
    # Replace in normalized, then merge back to preserve original line endings
    updated = normalized.replace(OLD, NEW, 1)
    # Re-apply CRLF where original had it (preserve file encoding)
    # Just write as-is with LF since modern editors handle it
    with open(tfile, 'w', encoding='utf-8') as f:
        f.write(updated)
    print('SUCCESS: cell upgraded to show Catalog Ref: clearly')
else:
    # Debug
    idx = normalized.find('<TableCell>\n                                         <div className="font-bold text-slate-900 text-sm leading-tight">')
    print(f'PATTERN NOT FOUND. Search anchor at: {idx}')
    if idx >= 0:
        print(repr(normalized[idx:idx+300]))
