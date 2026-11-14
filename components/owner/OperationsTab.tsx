'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/account/client';
import type { AdminOps, AuditRow } from '@/lib/account/contracts';
import { bytes, dateTime, duration, errorText, num, pct, useLoad } from './format';
import { Card, Empty, ErrorState, Kpi, Skeleton, TableWrap } from './ui';

function AuditLog({ tick }: { tick: number }) {
  const { data, loading, error, forbidden, reload } = useLoad<{ entries: AuditRow[] }>('/api/admin/audit', tick);
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = data?.entries ?? [];
    return f ? all.filter((e) => `${e.actorEmail} ${e.action} ${e.target} ${e.detail}`.toLowerCase().includes(f)) : all;
  }, [data, filter]);

  return (
    <Card title="Audit log" note="Every change you make, and every time you open a student's record, is written here.">
      <div className="ow-field">
        <label htmlFor="ow-audit-filter">Filter by person, action, target or detail</label>
        <input id="ow-audit-filter" type="search" className="ow-input" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {error ? (
        <ErrorState message={error} forbidden={forbidden} onRetry={reload} />
      ) : !data ? (
        loading ? (
          <Skeleton rows={5} />
        ) : null
      ) : rows.length === 0 ? (
        <Empty>{data.entries.length === 0 ? 'Nothing recorded yet. Entries appear when you change a setting or open a student record.' : 'No entries match this filter.'}</Empty>
      ) : (
        <TableWrap label="Audit log">
          <table className="ow-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.ts)}</td>
                  <td className="ow-wrap">{e.actorEmail}</td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td className="ow-wrap">{e.target || '—'}</td>
                  <td className="ow-wrap">{e.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function OperationsTab({ tick }: { tick: number }) {
  const { data, loading, error, forbidden, reload, setData } = useLoad<AdminOps>('/api/admin/ops', tick);
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [auditTick, setAuditTick] = useState(0);

  async function backup() {
    setBackingUp(true);
    setBackupError(null);
    try {
      setData(await api<AdminOps>('/api/admin/ops/backup', { method: 'POST', body: {} }));
      setAuditTick((n) => n + 1);
    } catch (err) {
      setBackupError(errorText(err));
    } finally {
      setBackingUp(false);
    }
  }

  return (
    <div className="ow-stack-y">
      {error ? (
        <ErrorState message={error} forbidden={forbidden} onRetry={reload} />
      ) : !data ? (
        loading ? (
          <Skeleton rows={6} />
        ) : null
      ) : (
        <>
          <div className="ow-kpis">
            <Kpi label="AI provider" value={data.provider.id} hint={`Model: ${data.provider.model || 'server default'}`} />
            <Kpi label="Uptime" value={duration(data.uptimeSec)} hint={`Started ${dateTime(data.startedAt)}`} />
            <Kpi label="Node version" value={data.node} />
            <Kpi label="Database size" value={bytes(data.dbBytes)} />
            <Kpi label="HTTP responses since start" value={num(data.http.total)} hint={`${num(data.http.clientErrors)} client errors (4xx), ${pct(data.http.clientErrors, data.http.total)}`} />
            <Kpi label="Server errors (5xx)" value={num(data.http.serverErrors)} hint={`${pct(data.http.serverErrors, data.http.total)} of responses`} />
          </div>

          <div className="ow-grid-2">
            <Card title="Backup">
              <p>{data.lastBackup ? `Last backup: ${data.lastBackup.file}, ${dateTime(data.lastBackup.at)}.` : 'No backup has been made yet.'}</p>
              <div className="ow-actions">
                <button type="button" className="ow-btn ow-btn-primary" onClick={() => void backup()} disabled={backingUp}>
                  {backingUp ? 'Backing up…' : 'Back up now'}
                </button>
              </div>
              {backupError && (
                <p className="ow-form-error" role="alert">
                  {backupError}
                </p>
              )}
            </Card>

            <Card title="Database rows">
              {Object.keys(data.rows).length === 0 ? (
                <Empty>No tables reported.</Empty>
              ) : (
                <TableWrap label="Row counts per table">
                  <table className="ow-table">
                    <thead>
                      <tr>
                        <th scope="col">Table</th>
                        <th scope="col" className="ow-num">
                          Rows
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(data.rows).map(([name, count]) => (
                        <tr key={name}>
                          <th scope="row">{name}</th>
                          <td className="ow-num">{num(count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          </div>
        </>
      )}
      <AuditLog tick={tick + auditTick} />
    </div>
  );
}
