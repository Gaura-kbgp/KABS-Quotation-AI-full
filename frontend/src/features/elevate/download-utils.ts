/**
 * Elevate — worksheet download utilities.
 * Excel via SheetJS (xlsx), PDF via browser print-to-PDF with a styled popup.
 */
import type { Worksheet } from './pricing';
type WorksheetResult = Worksheet;

// ─── Excel ──────────────────────────────────────────────────────────────────

export async function downloadWorksheetExcel(ws: WorksheetResult, filename = 'elevate-worksheet') {
  const XLSX = await import('xlsx');

  // ── Tab 1: Internal Worksheet (staff only) ──────────────────────────────
  const internalRows = [
    ['Code', 'Description', 'Qty', 'List (ea)', 'Ext. List', 'Cost (ea)', 'Ext. Cost', 'Sell (ea)', 'Ext. Sell', 'GP'],
    ...ws.lines.map(l => [
      l.code,
      l.description,
      l.qty,
      +(l.extendedList / l.qty).toFixed(2),
      +l.extendedList.toFixed(2),
      +(l.extendedCost / l.qty).toFixed(2),
      +l.extendedCost.toFixed(2),
      +(l.extendedSell / l.qty).toFixed(2),
      +l.extendedSell.toFixed(2),
      +l.grossProfit.toFixed(2),
    ]),
    [],
    ['', '', '', '', '', '', 'Total Cost',    '', +ws.totals.cost.toFixed(2), ''],
    ['', '', '', '', '', '', 'Builder Disc.', '', +ws.totals.builderDiscount.toFixed(2), ''],
    ['', '', '', '', '', '', 'Gross Profit',  '', +ws.totals.grossProfit.toFixed(2), `${ws.totals.grossProfitPct}%`],
  ];

  const wbInternal = XLSX.utils.aoa_to_sheet(internalRows);
  wbInternal['!cols'] = [
    { wch: 14 }, { wch: 30 }, { wch: 6 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];

  // ── Tab 2: Customer Price Summary ────────────────────────────────────────
  const summaryRows = [
    ['Cabinet & Trim Total', +ws.totals.sellBeforeDiscount.toFixed(2)],
    ['Builder Discount',     +ws.totals.builderDiscount.toFixed(2)],
    ['Product Total',        +ws.totals.productSell.toFixed(2)],
    [],
    ['Installation',  +ws.charges.installation.toFixed(2)],
    ['Delivery',      +ws.charges.delivery.toFixed(2)],
    ['Freight',       +ws.charges.freight.toFixed(2)],
    ['3PL',           +ws.charges.threePl.toFixed(2)],
    ['Hardware',      +ws.charges.hardware.toFixed(2)],
    [],
    ['Tax',           +ws.tax.toFixed(2)],
    [],
    ['GRAND TOTAL',   +ws.grandTotal.toFixed(2)],
  ];
  const wbSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wbSummary['!cols'] = [{ wch: 22 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wbInternal, 'Internal Worksheet');
  XLSX.utils.book_append_sheet(wb, wbSummary, 'Customer Summary');

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ─── PDF (print popup) ──────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function row(cells: string[], header = false) {
  const tag = header ? 'th' : 'td';
  return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
}

export function printWorksheetPdf(ws: WorksheetResult, companyName = 'KABS', projectName = '') {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const itemRows = ws.lines.map(l =>
    row([
      `<span class="mono">${l.code}</span>`,
      l.description || '—',
      String(l.qty),
      `<span class="mono">${fmt(l.extendedList)}</span>`,
      `<span class="mono">${fmt(l.extendedCost)}</span>`,
      `<span class="mono">${fmt(l.extendedSell)}</span>`,
      `<span class="mono">${fmt(l.grossProfit)}</span>`,
    ])
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${projectName ? projectName + ' — ' : ''}Internal Worksheet</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; font-size: 11px; color: #1e293b; padding: 32px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .header h1 { font-size: 18px; font-weight: 900; }
    .header .meta { text-align: right; color: #94a3b8; font-size: 10px; }
    .badge { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;
             border-radius: 4px; padding: 2px 8px; font-size: 9px; font-weight: 700;
             letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { text-align: left; padding: 5px 8px; border-bottom: 2px solid #e2e8f0;
         font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .mono { font-family: 'Courier New', monospace; }
    .right { text-align: right; }
    .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
    .totals table { width: 260px; }
    .totals td:first-child { color: #64748b; }
    .totals td:last-child { text-align: right; font-family: monospace; font-weight: 600; }
    .grand { font-size: 13px; font-weight: 900; border-top: 2px solid #1e293b !important; }
    .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase;
                     letter-spacing: 0.08em; color: #64748b; margin: 20px 0 6px; }
    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-top: 8px; }
    .summary-row { display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding: 3px 0; }
    .footer { margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 10px;
              font-size: 9px; color: #94a3b8; }
    @media print {
      body { padding: 20px; }
      @page { margin: 1.5cm; size: A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${companyName}</h1>
      <div style="color:#64748b;font-size:11px;margin-top:2px;">
        ${projectName ? `<strong>${projectName}</strong> · ` : ''}Internal Worksheet
      </div>
    </div>
    <div class="meta">
      <div>${date}</div>
    </div>
  </div>

  <div class="badge">⚠ Staff Only — Confidential</div>

  <table>
    ${row(['Code', 'Description', 'Qty', 'Ext. List', 'Ext. Cost', 'Ext. Sell', 'GP'], true)}
    ${itemRows}
  </table>

  <div class="totals">
    <table>
      ${row(['Total Cost',    `<span class="mono">${fmt(ws.totals.cost)}</span>`])}
      ${row(['Builder Disc.', `<span class="mono">−${fmt(ws.totals.builderDiscount)}</span>`])}
      ${row(['Gross Profit',  `<span class="mono">${fmt(ws.totals.grossProfit)} (${ws.totals.grossProfitPct}%)</span>`])}
    </table>
  </div>

  <p class="section-title">Customer Price Summary</p>
  <div class="summary-grid">
    <div>
      ${row(['Product Total', `<span class="mono">${fmt(ws.totals.productSell)}</span>`])}
      ${ws.charges.installation > 0 ? row(['Installation', `<span class="mono">${fmt(ws.charges.installation)}</span>`]) : ''}
      ${ws.charges.delivery > 0     ? row(['Delivery',     `<span class="mono">${fmt(ws.charges.delivery)}</span>`])     : ''}
      ${ws.charges.freight > 0      ? row(['Freight',      `<span class="mono">${fmt(ws.charges.freight)}</span>`])      : ''}
      ${ws.charges.threePl > 0      ? row(['3PL',          `<span class="mono">${fmt(ws.charges.threePl)}</span>`])      : ''}
      ${ws.charges.hardware > 0     ? row(['Hardware',     `<span class="mono">${fmt(ws.charges.hardware)}</span>`])     : ''}
      ${ws.tax > 0                  ? row(['Tax',          `<span class="mono">${fmt(ws.tax)}</span>`])                  : ''}
    </div>
    <div style="display:flex;align-items:flex-end;">
      <div style="width:100%;">
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Grand Total</div>
        <div style="font-size:22px;font-weight:900;font-family:monospace;">${fmt(ws.grandTotal)}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    This document is confidential and for internal use only. Generated by KABS Quotation AI.
  </div>

</body>
</html>`;

  const existing = document.getElementById('__kabs_print_frame__');
  if (existing) existing.remove();
  const iframe = document.createElement('iframe');
  iframe.id = '__kabs_print_frame__';
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 400);
}
