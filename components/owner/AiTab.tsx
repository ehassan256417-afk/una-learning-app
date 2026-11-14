'use client';

import { useState } from 'react';
import { api } from '@/lib/account/client';
import type { AdminAi } from '@/lib/account/contracts';
import { BarChart } from './charts';
import { dateTime, errorText, kindLabel, num, pct, usd, useLoad } from './format';
import { Badge, Card, Empty, ErrorState, Kpi, Meter, Skeleton, TableWrap } from './ui';

type ChartMetric = 'requests' | 'failed' | 'tokens';

export function AiTab({ days, tick }: { days: number; tick: number }) {
  const { data, loading, error, forbidden, reload, setData } = useLoad<AdminAi>(`/api/admin/ai?days=${days}`, tick);
  const [metric, setMetric] = useState<ChartMetric>('requests');
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  if (error) return <ErrorState message={error} forbidden={forbidden} onRetry={reload} />;
  if (!data) return loading ? <Skeleton rows={8} /> : null;

  const t = data.totals;
  const failures = data.failures.filter((f) => showResolved || f.resolvedAt === null);
  const openCount = data.failures.filter((f) => f.resolvedAt === null).length;

  async function toggle(id: number, resolved: boolean) {
    setBusyId(id);
    setRowError(null);
    try {
      await api(`/api/admin/ai/failures/${id}`, { method: 'POST', body: { resolved } });
      setData(
        data
          ? { ...data, failures: data.failures.map((f) => (f.id === id ? { ...f, resolvedAt: resolved ? Date.now() : null } : f)) }
          : data,
      );
    } catch (err) {
      setRowError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  const points = data.daily.map((d) => ({
    day: d.day,
    value: metric === 'requests' ? d.requests : metric === 'failed' ? d.failed : d.promptTokens + d.outputTokens,
  }));

  return (
    <div className={`ow-stack-y ${loading ? 'ow-refreshing' : ''}`}>
      <p className="ow-note">
        Provider {data.provider.id}, model {data.provider.model || 'server default'}. Last {data.rangeDays} days. Days are counted in UTC.
      </p>

      <div className="ow-kpis">
        <Kpi label="Requests" value={num(t.requests)} />
        <Kpi label="Success rate" value={t.requests > 0 ? pct(t.ok, t.requests) : '—'} hint={t.requests > 0 ? `${num(t.ok)} of ${num(t.requests)} succeeded` : 'No requests yet'} />
        <Kpi label="Failed" value={num(t.failed)} />
        <Kpi label="Refused by limits" value={num(t.refused)} />
        <Kpi label="Served from cache" value={num(t.cached)} />
        <Kpi label="Input tokens" value={num(t.promptTokens)} />
        <Kpi label="Output tokens" value={num(t.outputTokens)} />
        <Kpi label="Average response time" value={t.requests > 0 ? `${(t.avgMs / 1000).toFixed(1)} s` : '—'} />
        <Kpi
          label="Estimated cost"
          value={t.estCostUsd === null ? 'No prices set' : `${usd(t.estCostUsd)}`}
          hint={t.estCostUsd === null ? 'Set prices in Settings to see an estimate.' : 'Estimate from your own prices, not a bill.'}
        />
      </div>

      {t.estimatedTokenRequests > 0 && (
        <p className="ow-callout">
          Token counts for {num(t.estimatedTokenRequests)} {t.estimatedTokenRequests === 1 ? 'request were' : 'requests were'} estimated because the provider did not report them. Token totals and cost include those estimates.
        </p>
      )}

      <Card title="Today versus the daily limit" note="Platform-wide AI requests today (UTC day).">
        {data.today.dailyLimit > 0 ? <Meter value={data.today.requests} max={data.today.dailyLimit} label="Platform AI requests today" /> : <p>{num(data.today.requests)} requests today. The daily limit is 0, so new requests are refused.</p>}
      </Card>

      <Card
        title="Daily AI activity"
        actions={
          <div className="ow-chips" role="group" aria-label="Metric to chart">
            {(
              [
                ['requests', 'Requests'],
                ['failed', 'Failures'],
                ['tokens', 'Tokens'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" className="ow-chip" aria-pressed={metric === key} onClick={() => setMetric(key)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {data.daily.length === 0 ? <Empty>No AI requests in this period yet.</Empty> : <BarChart points={points} unit={metric === 'tokens' ? 'tokens (input + output)' : metric === 'failed' ? 'failed requests' : 'requests'} format={num} />}
      </Card>

      <div className="ow-grid-2">
        <Card title="By request type">
          {data.byKind.length === 0 ? (
            <Empty>No AI requests in this period yet.</Empty>
          ) : (
            <TableWrap label="AI requests by type">
              <table className="ow-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col" className="ow-num">
                      Requests
                    </th>
                    <th scope="col" className="ow-num">
                      Failed
                    </th>
                    <th scope="col" className="ow-num">
                      Avg time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byKind.map((r) => (
                    <tr key={r.kind}>
                      <th scope="row">{kindLabel(r.kind)}</th>
                      <td className="ow-num">{num(r.requests)}</td>
                      <td className="ow-num">{num(r.failed)}</td>
                      <td className="ow-num">{(r.avgMs / 1000).toFixed(1)} s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="By model">
          {data.byModel.length === 0 ? (
            <Empty>No AI requests in this period yet.</Empty>
          ) : (
            <TableWrap label="AI requests by model">
              <table className="ow-table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col" className="ow-num">
                      Requests
                    </th>
                    <th scope="col" className="ow-num">
                      Failed
                    </th>
                    <th scope="col" className="ow-num">
                      Tokens in / out
                    </th>
                    <th scope="col" className="ow-num">
                      Avg time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.byModel.map((r) => (
                    <tr key={`${r.provider}/${r.model}`}>
                      <th scope="row" className="ow-wrap">
                        {r.provider} / {r.model || 'default'}
                      </th>
                      <td className="ow-num">{num(r.requests)}</td>
                      <td className="ow-num">{num(r.failed)}</td>
                      <td className="ow-num">
                        {num(r.promptTokens)} / {num(r.outputTokens)}
                      </td>
                      <td className="ow-num">{(r.avgMs / 1000).toFixed(1)} s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <Card title="By student">
        {data.byUser.length === 0 ? (
          <Empty>No AI requests in this period yet.</Empty>
        ) : (
          <TableWrap label="AI requests by student">
            <table className="ow-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col" className="ow-num">
                    Requests
                  </th>
                  <th scope="col" className="ow-num">
                    Failed
                  </th>
                  <th scope="col" className="ow-num">
                    Tokens
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.byUser.map((r) => (
                  <tr key={r.userId ?? 'none'}>
                    <th scope="row" className="ow-wrap">
                      {r.email ?? 'Deleted or unknown account'}
                    </th>
                    <td className="ow-num">{num(r.requests)}</td>
                    <td className="ow-num">{num(r.failed)}</td>
                    <td className="ow-num">{num(r.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Failed and refused requests"
        note={`${num(openCount)} open. Resolving only hides an entry from this list; it changes nothing for the student.`}
        actions={
          <label className="ow-check">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved too
          </label>
        }
      >
        {rowError && (
          <p className="ow-form-error" role="alert">
            {rowError}
          </p>
        )}
        {failures.length === 0 ? (
          <Empty>{data.failures.length === 0 ? 'No failed or refused requests in this period. They will be listed here when they happen.' : 'No open failures. Tick "Show resolved too" to see the resolved ones.'}</Empty>
        ) : (
          <TableWrap label="Failed and refused AI requests">
            <table className="ow-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Student</th>
                  <th scope="col">Type</th>
                  <th scope="col">Model</th>
                  <th scope="col">Result</th>
                  <th scope="col">Error</th>
                  <th scope="col">
                    <span className="ow-sr">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id}>
                    <td>{dateTime(f.ts)}</td>
                    <td className="ow-wrap">{f.userEmail ?? '—'}</td>
                    <td>{kindLabel(f.kind)}</td>
                    <td className="ow-wrap">{f.model || '—'}</td>
                    <td>
                      <Badge tone={f.status === 'failed' ? 'bad' : 'warn'}>{f.status === 'failed' ? 'Failed' : 'Refused'}</Badge>
                      {f.resolvedAt !== null && (
                        <>
                          {' '}
                          <Badge tone="good">Resolved</Badge>
                        </>
                      )}
                    </td>
                    <td className="ow-wrap">
                      <code>{f.errorCode || 'unknown'}</code> {f.errorMessage}
                    </td>
                    <td>
                      <button type="button" className="ow-btn ow-btn-sm" disabled={busyId === f.id} onClick={() => void toggle(f.id, f.resolvedAt === null)}>
                        {f.resolvedAt === null ? 'Mark resolved' : 'Reopen'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
