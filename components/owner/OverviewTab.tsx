'use client';

import { useState } from 'react';
import type { AdminOverview, DailyPoint } from '@/lib/account/contracts';
import { BarChart } from './charts';
import { minutes, num, num1, pct, useLoad } from './format';
import { Card, Empty, ErrorState, Kpi, Skeleton, TableWrap, Trend } from './ui';

type Metric = 'visits' | 'visitors' | 'pageViews' | 'signups' | 'logins' | 'activeUsers' | 'activeMin' | 'studyMin';

const METRICS: Array<{ key: Metric; label: string; unit: string }> = [
  { key: 'visits', label: 'Visits', unit: 'visits' },
  { key: 'visitors', label: 'Visitors (estimated)', unit: 'visitors (estimated)' },
  { key: 'pageViews', label: 'Page views', unit: 'page views' },
  { key: 'signups', label: 'Sign-ups', unit: 'sign-ups' },
  { key: 'logins', label: 'Sign-ins', unit: 'sign-ins' },
  { key: 'activeUsers', label: 'Active students', unit: 'active students' },
  { key: 'activeMin', label: 'Active minutes', unit: 'active minutes' },
  { key: 'studyMin', label: 'Study minutes', unit: 'study minutes' },
];

export function OverviewTab({ days, tick }: { days: number; tick: number }) {
  const { data, loading, error, forbidden, reload } = useLoad<AdminOverview>(`/api/admin/overview?days=${days}`, tick);
  const [metric, setMetric] = useState<Metric>('visits');

  if (error) return <ErrorState message={error} forbidden={forbidden} onRetry={reload} />;
  if (!data) return loading ? <Skeleton rows={8} /> : null;

  const t = data.totals;
  const p = data.previous;
  const noTraffic = t.visits === 0 && t.pageViews === 0;
  const metricDef = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const points = data.daily.map((d: DailyPoint) => ({ day: d.day, value: d[metric] }));

  return (
    <div className={`ow-stack-y ${loading ? 'ow-refreshing' : ''}`}>
      <p className="ow-note">
        Last {data.rangeDays} days compared with the {data.rangeDays} days before. Days are counted in UTC.
      </p>

      <div className="ow-kpis">
        <Kpi label="Visits" value={num(t.visits)} trend={<Trend current={t.visits} previous={p.visits} />} />
        <Kpi label="Unique visitors" value={num(t.visitors)} hint="Estimated: one browser = one visitor" trend={<Trend current={t.visitors} previous={p.visitors} />} />
        <Kpi label="Page views" value={num(t.pageViews)} trend={<Trend current={t.pageViews} previous={p.pageViews} />} />
        <Kpi label="New accounts" value={num(t.signups)} trend={<Trend current={t.signups} previous={p.signups} />} />
        <Kpi label="Sign-ins" value={num(t.logins)} trend={<Trend current={t.logins} previous={p.logins} />} />
        <Kpi label="Active students" value={num(t.activeUsers)} hint="Signed in with measured activity" trend={<Trend current={t.activeUsers} previous={p.activeUsers} />} />
        <Kpi label="Active time" value={minutes(t.activeMin)} hint="Real interaction, tab visible" trend={<Trend current={t.activeMin} previous={p.activeMin} />} />
        <Kpi label="Study time" value={minutes(t.studyMin)} hint="Inside lessons and reviews" trend={<Trend current={t.studyMin} previous={p.studyMin} />} />
        <Kpi label="Average visit length" value={minutes(t.avgVisitMin)} trend={<Trend current={t.avgVisitMin} previous={p.avgVisitMin} />} />
      </div>

      <Card title="Right now" note="Active means real interaction measured in the browser.">
        <dl className="ow-facts ow-facts-wide">
          <div>
            <dt>Active in the last 5 minutes</dt>
            <dd>{num(data.live.activeNow)}</dd>
          </div>
          <div>
            <dt>Active students today</dt>
            <dd>{num(data.live.activeUsersToday)}</dd>
          </div>
          <div>
            <dt>Active students, 7 days</dt>
            <dd>{num(data.live.activeUsers7d)}</dd>
          </div>
          <div>
            <dt>Active students, 30 days</dt>
            <dd>{num(data.live.activeUsers30d)}</dd>
          </div>
          <div>
            <dt>Accounts, all time</dt>
            <dd>{num(data.allTime.users)}</dd>
          </div>
          <div>
            <dt>Visitors, all time (estimated)</dt>
            <dd>{num(data.allTime.visitors)}</dd>
          </div>
          <div>
            <dt>Visits, all time</dt>
            <dd>{num(data.allTime.visits)}</dd>
          </div>
          <div>
            <dt>Courses, all time</dt>
            <dd>{num(data.allTime.courses)}</dd>
          </div>
          <div>
            <dt>Lessons completed, all time</dt>
            <dd>{num(data.allTime.lessonsCompleted)}</dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Daily activity"
        actions={
          <div className="ow-chips" role="group" aria-label="Metric to chart">
            {METRICS.map((m) => (
              <button key={m.key} type="button" className="ow-chip" aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        {data.daily.length === 0 ? <Empty>No days to show in this period yet.</Empty> : <BarChart points={points} unit={metricDef.unit} format={metric === 'activeMin' || metric === 'studyMin' ? (n) => num1(n) : num} />}
      </Card>

      <div className="ow-grid-2">
        <Card title="Funnel" note="Each step shows its share of the step before it and how many dropped off.">
          {noTraffic && data.funnel.every((f) => f.count === 0) ? (
            <Empty>No visits recorded in this period yet. The funnel fills in as people visit.</Empty>
          ) : (
            <ol className="ow-funnel">
              {data.funnel.map((step, i) => {
                const prev = i > 0 ? data.funnel[i - 1].count : null;
                const top = Math.max(1, data.funnel[0]?.count ?? 1);
                return (
                  <li key={step.step}>
                    <div className="ow-hbar-head">
                      <span className="ow-hbar-label">{step.label}</span>
                      <span className="ow-hbar-value">
                        <strong>{num(step.count)}</strong>
                        {prev !== null && prev > 0 && ` · ${pct(step.count, prev)} of previous step · dropped ${num(Math.max(0, prev - step.count))}`}
                      </span>
                    </div>
                    <div className="ow-hbar-track" aria-hidden="true">
                      <div className="ow-hbar-fill" style={{ width: `${Math.min(100, (step.count / top) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card title="Returning visitors" note="Counted by browser, so one person on two devices counts twice.">
          {data.retention.newVisitors === 0 ? (
            <Empty>No new visitors in this period yet.</Empty>
          ) : (
            <div>
              <p className="ow-big">{pct(data.retention.returned, data.retention.newVisitors)}</p>
              <p className="ow-note">
                {num(data.retention.returned)} of {num(data.retention.newVisitors)} new browsers came back.
              </p>
            </div>
          )}
          <h4 className="ow-sub">Referrers</h4>
          {data.referrers.length === 0 ? (
            <Empty>No referrers recorded in this period yet. Visits that arrive directly are not listed.</Empty>
          ) : (
            <TableWrap label="Referrers">
              <table className="ow-table">
                <thead>
                  <tr>
                    <th scope="col">Referrer</th>
                    <th scope="col" className="ow-num">
                      Visits
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.referrers.map((r) => (
                    <tr key={r.referrer}>
                      <td className="ow-wrap">{r.referrer}</td>
                      <td className="ow-num">{num(r.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <div className="ow-grid-2">
        <Card title="Top pages">
          {data.topPages.length === 0 ? (
            <Empty>No page views recorded in this period yet.</Empty>
          ) : (
            <TableWrap label="Top pages">
              <table className="ow-table">
                <thead>
                  <tr>
                    <th scope="col">Page</th>
                    <th scope="col" className="ow-num">
                      Views
                    </th>
                    <th scope="col" className="ow-num">
                      Visitors
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPages.map((r) => (
                    <tr key={r.path}>
                      <th scope="row" className="ow-wrap">
                        {r.path}
                      </th>
                      <td className="ow-num">{num(r.views)}</td>
                      <td className="ow-num">{num(r.visitors)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="Where visits end" note="Exit share = visits that ended on a page divided by all visits that touched it.">
          {data.exits.length === 0 ? (
            <Empty>No visits have ended in this period yet.</Empty>
          ) : (
            <TableWrap label="Exit pages">
              <table className="ow-table">
                <thead>
                  <tr>
                    <th scope="col">Page</th>
                    <th scope="col" className="ow-num">
                      Exits
                    </th>
                    <th scope="col" className="ow-num">
                      Visits
                    </th>
                    <th scope="col" className="ow-num">
                      Exit share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.exits.map((r) => (
                    <tr key={r.path}>
                      <th scope="row" className="ow-wrap">
                        {r.path}
                      </th>
                      <td className="ow-num">{num(r.exits)}</td>
                      <td className="ow-num">{num(r.visits)}</td>
                      <td className="ow-num">{pct(r.exits, r.visits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <Card title="How visitors move" note="Page-to-page moves inside a visit.">
        {data.transitions.length === 0 ? (
          <Empty>No page-to-page movement recorded in this period yet.</Empty>
        ) : (
          <TableWrap label="Page transitions">
            <table className="ow-table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col" className="ow-num">
                    Moves
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.transitions.map((r) => (
                  <tr key={`${r.from}>${r.to}`}>
                    <td className="ow-wrap">{r.from}</td>
                    <td className="ow-wrap">
                      <span aria-hidden="true">→ </span>
                      {r.to}
                    </td>
                    <td className="ow-num">{num(r.count)}</td>
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
