import React, { useMemo, useState } from 'react';
import { Act } from './parts.jsx';
import { buildReport } from '../engine/report.js';
import { fmtDate, addDays } from '../engine/dates.js';

const monthStart = (on) => `${on.slice(0, 7)}-01`;
const prevMonth = (on) => addDays(monthStart(on), -1).slice(0, 7);
const fromSerial = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);

// Show a cell in the on-screen preview the way Excel will.
function show(v, fmt) {
  if (typeof v !== 'number') return v;
  if (fmt === 'yyyy-mm-dd') return fromSerial(v);
  if (fmt === 'mmm-yy') return fmtDate(fromSerial(v)).slice(-8);
  if (fmt?.startsWith('#,##0') && v === 0 && fmt.includes('"-"')) return '-';
  return v.toLocaleString('en-US', { maximumFractionDigits: fmt === '#,##0.00' ? 2 : fmt ? 0 : 2 });
}

export default function Reports({ data, summaries, on }) {
  const [from, setFrom] = useState(monthStart(on));
  const [to, setTo] = useState(on);
  const [fromMonth, setFromMonth] = useState('2024-01');
  const [toMonth, setToMonth] = useState(prevMonth(on));
  const sheets = useMemo(() => buildReport(data, summaries, { on, from, to, fromMonth, toMonth }), [data, summaries, on, from, to, fromMonth, toMonth]);
  const [preview, setPreview] = useState('Pivot');
  const shown = sheets.find((s) => s.name === preview) || sheets[0];

  const download = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      ws['!cols'] = (s.widths || []).map((w) => ({ wch: w }));
      for (let r = (s.headerRow ?? 0) + 1; r < s.rows.length; r++)
        for (const [c, z] of Object.entries(s.formats || {})) {
          const cell = ws[XLSX.utils.encode_cell({ r, c: +c })];
          if (cell && cell.t === 'n') cell.z = z;
        }
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    const fy = (d) => (+d.slice(5, 7) >= 4 ? +d.slice(2, 4) : +d.slice(2, 4) - 1);
    XLSX.writeFile(wb, `AR_FY 22 - ${fy(on) + 1}_${fmtDate(on).replace(/ /g, '-')}.xlsx`);
  };

  return (
    <>
      <div className="card">
        <h2>AR report for Sid</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Same layout as <em>New_File_AR_FY 22 - 26.xlsx</em>: <strong>Pivot</strong> (billing month → Sum of bcy_total, Sum of bcy_balance, Grand Total; void and bad debt left out) and
          <strong> Dump</strong> (every invoice with the Zoho columns and your comments). Then Pending by customer, Aging & collections, and Payments received. Balances include payments recorded here
          and the latest Zoho import.
        </p>
        <div className="toolbar">
          <label>
            Pivot months from
            <input type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
          </label>
          <label>
            to
            <input type="month" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
          </label>
          <label>
            Payments from
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            to
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Act className="primary" onClick={download}>
            Download Excel
          </Act>
        </div>
      </div>
      <div className="card">
        <div className="tabs">
          {sheets.map((s) => (
            <button key={s.name} className={preview === s.name ? 'on' : ''} onClick={() => setPreview(s.name)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <tbody>
              {shown.rows.slice(0, 200).map((r, i) => {
                const head = i === (shown.headerRow ?? 0) || r[0] === 'Total' || r[0] === 'Grand Total';
                return (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={typeof v === 'number' ? 'r' : 'wrap-cell'} style={{ whiteSpace: typeof v === 'string' && v.includes('\n') ? 'pre-line' : undefined, fontWeight: head ? 600 : undefined }}>
                        {i > (shown.headerRow ?? 0) ? show(v, shown.formats?.[j]) : v}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.rows.length > 200 && <div className="hint">Preview shows the first 200 rows; the download has all {shown.rows.length}.</div>}
      </div>
    </>
  );
}
