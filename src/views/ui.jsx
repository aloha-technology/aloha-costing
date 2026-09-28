import React, { useMemo, useState } from 'react';
import { pct, marginClass } from '../format.js';

export function Kpi({ label, value, note, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

export function Margin({ value, target }) {
  return <span className={`pill ${marginClass(value, target)}`}>{value == null ? 'no revenue' : pct(value)}</span>;
}

export function Severity({ level }) {
  return <span className={`sev ${level}`}>{level}</span>;
}

// Sortable table. columns: [{key, label, render?, sort?, align?}]
export function Table({ columns, rows, initialSort, onRowClick, rowKey }) {
  const [sort, setSort] = useState(initialSort || { key: columns[0].key, dir: 'desc' });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    const get = col?.sort || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const cmp = x == null ? 1 : y == null ? -1 : typeof x === 'string' ? x.localeCompare(y) : x - y;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.align === 'right' ? 'r' : ''}
                onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'click' : ''}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'r' : ''}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
