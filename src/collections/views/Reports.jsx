import React, { useMemo, useState } from 'react';
import { Act } from './parts.jsx';
import { buildReport } from '../engine/report.js';
import { fmtDate } from '../engine/dates.js';

const monthStart = (on) => `${on.slice(0, 7)}-01`;

export default function Reports({ data, summaries, on }) {
  const [from, setFrom] = useState(monthStart(on));
  const [to, setTo] = useState(on);
  const sheets = useMemo(() => buildReport(data, summaries, { on, from, to }), [data, summaries, on, from, to]);
  const [preview, setPreview] = useState('Summary');
  const shown = sheets.find((s) => s.name === preview);

  const download = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      ws['!cols'] = (s.widths || []).map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    XLSX.writeFile(wb, `Aloha Receivables_${fmtDate(on).replace(/ /g, '-')}.xlsx`);
  };

  return (
    <>
      <div className="card">
        <h2>Receivables report for Sid</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          One Excel file with: Summary (totals and aging), Pending by customer (same columns as your current Pending Invoices sheet, with your comment), Month-wise AR,
          Open invoices, and Payments received in the period (with bank charges and payer check). Share your current sample and the layout can be matched exactly.
        </p>
        <div className="toolbar">
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
              {shown.rows.slice(0, 200).map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={typeof v === 'number' ? 'r' : 'wrap-cell'} style={{ whiteSpace: typeof v === 'string' && v.includes('\n') ? 'pre-line' : undefined, fontWeight: i === 0 || r[0] === 'Total' ? 600 : undefined }}>
                      {typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.rows.length > 200 && <div className="hint">Preview shows the first 200 rows; the download has all {shown.rows.length}.</div>}
      </div>
    </>
  );
}
