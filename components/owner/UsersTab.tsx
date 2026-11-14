'use client';

import { useState } from 'react';
import type { AdminUserRow } from '@/lib/account/contracts';
import { UserDetail } from './UserDetail';
import { dateOnly, dateTime, minutes, num, useDebounced, useLoad } from './format';
import { Badge, Card, Empty, ErrorState, Skeleton, TableWrap } from './ui';

export function UsersTab({ tick }: { tick: number }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [beta, setBeta] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const dq = useDebounced(q.trim(), 300);

  const params = new URLSearchParams();
  if (dq) params.set('q', dq);
  if (status) params.set('status', status);
  if (beta) params.set('beta', beta);
  const { data, loading, error, forbidden, reload } = useLoad<{ users: AdminUserRow[] }>(`/api/admin/users?${params.toString()}`, tick);
  const filtered = Boolean(dq || status || beta);

  return (
    <div className="ow-stack-y">
      <Card>
        <div className="ow-toolbar">
          <div className="ow-field ow-grow">
            <label htmlFor="ow-user-search">Search by name or email</label>
            <input id="ow-user-search" type="search" className="ow-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students" />
          </div>
          <div className="ow-field">
            <label htmlFor="ow-user-status">Status</label>
            <select id="ow-user-status" className="ow-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          <div className="ow-field">
            <label htmlFor="ow-user-beta">Beta testers</label>
            <select id="ow-user-beta" className="ow-input" value={beta} onChange={(e) => setBeta(e.target.value)}>
              <option value="">All</option>
              <option value="yes">Beta only</option>
              <option value="no">Not beta</option>
            </select>
          </div>
        </div>
      </Card>

      {error ? (
        <ErrorState message={error} forbidden={forbidden} onRetry={reload} />
      ) : !data ? (
        loading ? (
          <Skeleton rows={7} />
        ) : null
      ) : data.users.length === 0 ? (
        <Card>
          <Empty>{filtered ? 'No accounts match these filters.' : 'No accounts yet. Students appear here as soon as they register.'}</Empty>
        </Card>
      ) : (
        <Card title={`${num(data.users.length)} ${data.users.length === 1 ? 'account' : 'accounts'}`} note="Select a row to open the full record. Opening a record is written to the audit log.">
          <TableWrap label="Accounts">
            <table className={`ow-table ow-table-click ${loading ? 'ow-refreshing' : ''}`}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Beta</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col" className="ow-num">
                    Courses
                  </th>
                  <th scope="col" className="ow-num">
                    Active time
                  </th>
                  <th scope="col" className="ow-num">
                    Study time
                  </th>
                  <th scope="col" className="ow-num">
                    AI requests
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <th scope="row">
                      <button type="button" className="ow-link" onClick={() => setOpenId(u.id)} aria-haspopup="dialog">
                        {u.name || '(no name)'}
                      </button>
                      {u.role === 'owner' && (
                        <>
                          {' '}
                          <Badge tone="info">Owner</Badge>
                        </>
                      )}
                    </th>
                    <td className="ow-wrap">{u.email}</td>
                    <td>
                      <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? 'Active' : 'Suspended'}</Badge>
                    </td>
                    <td>{u.beta ? <Badge tone="info">Beta</Badge> : <span className="ow-dim">No</span>}</td>
                    <td>{dateOnly(u.createdAt)}</td>
                    <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</td>
                    <td className="ow-num">{num(u.courses)}</td>
                    <td className="ow-num">{minutes(u.activeMin)}</td>
                    <td className="ow-num">{minutes(u.studyMin)}</td>
                    <td className="ow-num">{num(u.aiRequests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {openId && (
        <UserDetail
          userId={openId}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onDeleted={() => {
            setOpenId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
