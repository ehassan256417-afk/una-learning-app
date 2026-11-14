'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/account/client';
import type { AdminUserDetail } from '@/lib/account/contracts';
import { BarChart, StackedBar } from './charts';
import { bytes, dateOnly, dateTime, errorText, kindLabel, minutes, num, pct, sourceLabel, usd, useLoad } from './format';
import { Badge, Card, ConfirmDialog, CopyButton, Dialog, Empty, ErrorState, Meter, Skeleton, TableWrap } from './ui';

type Action = 'suspend' | 'beta' | 'reset' | 'signout' | 'delete';

interface Props {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}

export function UserDetail({ userId, onClose, onChanged, onDeleted }: Props) {
  const path = `/api/admin/users/${encodeURIComponent(userId)}`;
  const { data, loading, error, forbidden, reload, setData } = useLoad<AdminUserDetail>(path);
  const [action, setAction] = useState<Action | null>(null);
  const [reset, setReset] = useState<{ code: string; expiresAt: number } | null>(null);
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [noteError, setNoteError] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data) setNote(data.note);
  }, [data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(body: { status?: 'active' | 'suspended'; beta?: boolean; note?: string }): Promise<AdminUserDetail> {
    const next = await api<AdminUserDetail>(path, { method: 'PATCH', body });
    setData(next);
    onChanged();
    return next;
  }

  async function saveNote() {
    setNoteState('saving');
    try {
      await patch({ note });
      setNoteState('saved');
    } catch (err) {
      setNoteError(errorText(err));
      setNoteState('error');
    }
  }

  const u = data;
  const isOwner = u?.role === 'owner';

  return (
    <Dialog title={u ? `${u.name || u.email}` : 'Account'} onClose={onClose} wide>
      <button type="button" className="ow-dialog-x ow-btn ow-btn-sm" onClick={onClose}>
        Close
      </button>
      {error ? (
        <ErrorState message={error} forbidden={forbidden} onRetry={reload} />
      ) : !u ? (
        loading ? (
          <Skeleton rows={8} />
        ) : null
      ) : (
        <div className="ow-stack-y">
          <p className="ow-note">
            {u.email}. Opening this record was written to the audit log.
          </p>
          <div className="ow-badges">
            <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status === 'active' ? 'Active' : 'Suspended'}</Badge>
            {u.beta && <Badge tone="info">Beta tester</Badge>}
            {isOwner && <Badge tone="info">Owner</Badge>}
          </div>
          {message && (
            <p className="ow-form-ok" role="status">
              {message}
            </p>
          )}

          <Card title="Actions">
            <div className="ow-actions">
              {!isOwner && (
                <button type="button" className={`ow-btn ${u.status === 'active' ? 'ow-btn-danger-outline' : ''}`} onClick={() => setAction('suspend')}>
                  {u.status === 'active' ? 'Suspend account' : 'Reactivate account'}
                </button>
              )}
              <button type="button" className="ow-btn" onClick={() => setAction('beta')}>
                {u.beta ? 'Remove beta tester mark' : 'Mark as beta tester'}
              </button>
              <button type="button" className="ow-btn" onClick={() => setAction('reset')}>
                Create password reset code
              </button>
              <button type="button" className="ow-btn" onClick={() => setAction('signout')}>
                Sign out everywhere
              </button>
              {!isOwner && (
                <button type="button" className="ow-btn ow-btn-danger-outline" onClick={() => setAction('delete')}>
                  Delete account
                </button>
              )}
            </div>
          </Card>

          <div className="ow-grid-2">
            <Card title="Account">
              <dl className="ow-facts">
                <div>
                  <dt>Joined</dt>
                  <dd>{dateTime(u.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last sign-in</dt>
                  <dd>{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{u.lastSeenAt ? dateTime(u.lastSeenAt) : 'Never'}</dd>
                </div>
                <div>
                  <dt>Sign-ins</dt>
                  <dd>{num(u.loginCount)}</dd>
                </div>
                <div>
                  <dt>Devices signed in now</dt>
                  <dd>{num(u.signedInDevices)}</dd>
                </div>
                <div>
                  <dt>Visits</dt>
                  <dd>{num(u.visits)}</dd>
                </div>
                <div>
                  <dt>Average visit length</dt>
                  <dd>{minutes(u.avgVisitMin)}</dd>
                </div>
                <div>
                  <dt>Invite code used</dt>
                  <dd>{u.inviteCode ?? 'None'}</dd>
                </div>
              </dl>
            </Card>

            <Card title="Learning">
              <dl className="ow-facts">
                <div>
                  <dt>XP</dt>
                  <dd>{num(u.learning.xp)}</dd>
                </div>
                <div>
                  <dt>Streak</dt>
                  <dd>
                    {num(u.learning.streak)} {u.learning.streak === 1 ? 'day' : 'days'}
                  </dd>
                </div>
                <div>
                  <dt>Last study day (UTC)</dt>
                  <dd>{u.learning.lastStudyDay ?? 'Never'}</dd>
                </div>
                <div>
                  <dt>Lessons started</dt>
                  <dd>{num(u.learning.lessonsStarted)}</dd>
                </div>
                <div>
                  <dt>Lessons completed</dt>
                  <dd>{num(u.learning.lessonsCompleted)}</dd>
                </div>
                <div>
                  <dt>Quiz accuracy</dt>
                  <dd>{u.learning.quizTotal > 0 ? `${pct(u.learning.quizCorrect, u.learning.quizTotal)} (${num(u.learning.quizCorrect)} of ${num(u.learning.quizTotal)})` : 'No quiz answers yet'}</dd>
                </div>
                <div>
                  <dt>Review sessions</dt>
                  <dd>{num(u.learning.reviewSessions)}</dd>
                </div>
                <div>
                  <dt>Items tracked</dt>
                  <dd>{num(u.learning.itemsTracked)}</dd>
                </div>
              </dl>
              {u.learning.itemsTracked > 0 ? (
                <StackedBar
                  ariaLabel={`Items tracked: ${u.learning.weak} weak, ${u.learning.learning} learning, ${u.learning.strong} strong`}
                  segments={[
                    { label: 'Weak', value: u.learning.weak, tone: 'bad' },
                    { label: 'Learning', value: u.learning.learning, tone: 'warn' },
                    { label: 'Strong', value: u.learning.strong, tone: 'good' },
                  ]}
                />
              ) : (
                <p className="ow-note">No review items tracked yet.</p>
              )}
            </Card>
          </div>

          <Card title="Activity, last 30 days" note="Active time is real interaction; study time is the part spent in lessons and reviews. Days are counted in UTC.">
            {u.daily.every((d) => d.activeMin === 0 && d.studyMin === 0) ? (
              <Empty>No activity measured for this student in the last 30 days.</Empty>
            ) : (
              <BarChart points={u.daily.map((d) => ({ day: d.day, value: d.activeMin, value2: d.studyMin }))} unit="active minutes" unit2="study minutes" />
            )}
          </Card>

          <div className="ow-grid-2">
            <Card title="AI usage" note="Cost is an estimate from the prices set in Settings.">
              <dl className="ow-facts">
                <div>
                  <dt>Requests</dt>
                  <dd>
                    {num(u.ai.requests)} ({num(u.ai.ok)} ok, {num(u.ai.failed)} failed, {num(u.ai.cached)} cached)
                  </dd>
                </div>
                <div>
                  <dt>Tokens in / out</dt>
                  <dd>
                    {num(u.ai.promptTokens)} / {num(u.ai.outputTokens)}
                  </dd>
                </div>
                <div>
                  <dt>Estimated cost</dt>
                  <dd>{u.ai.estCostUsd === null ? 'No prices set. Set prices in Settings to see an estimate.' : `${usd(u.ai.estCostUsd)} (estimate)`}</dd>
                </div>
              </dl>
              <p className="ow-sub-label">Today versus the daily limit</p>
              <Meter value={u.ai.today} max={u.ai.dailyLimit} label="AI requests today" />
            </Card>

            <Card title="Owner note" note="Only you can see this.">
              <label htmlFor="ow-user-note" className="ow-sr">
                Owner note
              </label>
              <textarea
                id="ow-user-note"
                className="ow-input ow-textarea"
                rows={5}
                maxLength={500}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setNoteState('idle');
                }}
              />
              <div className="ow-actions">
                <button type="button" className="ow-btn ow-btn-primary" onClick={() => void saveNote()} disabled={noteState === 'saving' || note === u.note}>
                  {noteState === 'saving' ? 'Saving…' : 'Save note'}
                </button>
                {noteState === 'saved' && <span className="ow-form-ok">Saved</span>}
                {noteState === 'error' && (
                  <span className="ow-form-error" role="alert">
                    {noteError}
                  </span>
                )}
              </div>
            </Card>
          </div>

          <Card title="Courses">
            {u.courseList.length === 0 ? (
              <Empty>This student has not created a course yet.</Empty>
            ) : (
              <TableWrap label="Courses of this student">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Source</th>
                      <th scope="col" className="ow-num">
                        Lessons
                      </th>
                      <th scope="col" className="ow-num">
                        Size
                      </th>
                      <th scope="col">Updated</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.courseList.map((c) => (
                      <tr key={c.id}>
                        <th scope="row" className="ow-wrap">
                          {c.title || '(untitled)'}
                        </th>
                        <td className="ow-wrap">
                          {sourceLabel(c.sourceKind)}: {c.documentName}
                        </td>
                        <td className="ow-num">
                          {num(c.lessonsReady)} of {num(c.lessonsPlanned)}
                          {c.lessonsFailed > 0 ? `, ${num(c.lessonsFailed)} failed` : ''}
                        </td>
                        <td className="ow-num">{bytes(c.bytes)}</td>
                        <td>{dateOnly(c.updatedAt)}</td>
                        <td>{c.hidden ? <Badge tone="warn">Offline</Badge> : <Badge tone="good">Visible</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Recent AI requests">
            {u.recentAi.length === 0 ? (
              <Empty>No AI requests from this student yet.</Empty>
            ) : (
              <TableWrap label="Recent AI requests of this student">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Type</th>
                      <th scope="col">Model</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="ow-num">
                        Tokens in / out
                      </th>
                      <th scope="col" className="ow-num">
                        Time taken
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.recentAi.map((r) => (
                      <tr key={r.id}>
                        <td>{dateTime(r.ts)}</td>
                        <td>{kindLabel(r.kind)}</td>
                        <td className="ow-wrap">{r.model || '—'}</td>
                        <td>
                          <Badge tone={r.status === 'ok' ? 'good' : r.status === 'failed' ? 'bad' : 'warn'}>
                            {r.status === 'ok' ? (r.cached ? 'OK (cache)' : 'OK') : r.status === 'failed' ? 'Failed' : 'Refused'}
                          </Badge>
                        </td>
                        <td className="ow-num">
                          {num(r.promptTokens)} / {num(r.outputTokens)}
                          {r.tokensEstimated ? ' (est.)' : ''}
                        </td>
                        <td className="ow-num">{(r.durationMs / 1000).toFixed(1)} s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      )}

      {u && action === 'suspend' && (
        <ConfirmDialog
          title={u.status === 'active' ? 'Suspend this account?' : 'Reactivate this account?'}
          body={
            u.status === 'active' ? (
              <p>
                {u.email} will be signed out on every device and will not be able to sign in again until you reactivate the account. Their courses and progress are kept.
              </p>
            ) : (
              <p>{u.email} will be able to sign in again.</p>
            )
          }
          confirmLabel={u.status === 'active' ? 'Suspend account' : 'Reactivate account'}
          danger={u.status === 'active'}
          onConfirm={async () => {
            await patch({ status: u.status === 'active' ? 'suspended' : 'active' });
            setMessage(u.status === 'active' ? 'Account suspended.' : 'Account reactivated.');
          }}
          onClose={() => setAction(null)}
        />
      )}
      {u && action === 'beta' && (
        <ConfirmDialog
          title={u.beta ? 'Remove the beta tester mark?' : 'Mark as beta tester?'}
          body={<p>{u.beta ? `${u.email} will no longer be listed as a beta tester.` : `${u.email} will be listed as a beta tester.`}</p>}
          confirmLabel={u.beta ? 'Remove mark' : 'Mark as beta tester'}
          onConfirm={async () => {
            await patch({ beta: !u.beta });
            setMessage(u.beta ? 'Beta tester mark removed.' : 'Marked as beta tester.');
          }}
          onClose={() => setAction(null)}
        />
      )}
      {u && action === 'signout' && (
        <ConfirmDialog
          title="Sign out everywhere?"
          body={<p>Every device signed in as {u.email} is signed out now. They can sign in again with their password.</p>}
          confirmLabel="Sign out everywhere"
          onConfirm={async () => {
            const res = await api<{ ended: number }>(`${path}/sign-out`, { method: 'POST', body: {} });
            setMessage(`Signed out ${num(res.ended)} ${res.ended === 1 ? 'session' : 'sessions'}.`);
            reload();
          }}
          onClose={() => setAction(null)}
        />
      )}
      {u && action === 'reset' && (
        <ConfirmDialog
          title="Create a password reset code?"
          body={<p>You get a one-time code to give to {u.email}. They enter it on the reset page (/reset) with a new password. The code works for 1 hour. It is shown only once.</p>}
          confirmLabel="Create code"
          onConfirm={async () => {
            const res = await api<{ code: string; expiresAt: number }>(`${path}/reset-code`, { method: 'POST', body: {} });
            setReset(res);
          }}
          onClose={() => setAction(null)}
        />
      )}
      {u && action === 'delete' && (
        <ConfirmDialog
          title="Delete this account permanently?"
          danger
          body={
            <>
              <p>
                This removes {u.email} together with all of their courses, progress and activity. It cannot be undone and the data cannot be recovered.
              </p>
            </>
          }
          typeToConfirm={u.email}
          confirmLabel="Delete account permanently"
          onConfirm={async () => {
            await api(path, { method: 'DELETE', body: { confirmEmail: u.email } });
            onDeleted();
          }}
          onClose={() => setAction(null)}
        />
      )}
      {reset && (
        <Dialog title="Password reset code" onClose={() => setReset(null)}>
          <div className="ow-dialog-body">
            <p className="ow-code" aria-label="Reset code">
              {reset.code}
            </p>
            <p>
              Give this code to the student. They enter it at <code>/reset</code> with their email and a new password. It is valid until {dateTime(reset.expiresAt)} (1 hour) and is not shown again.
            </p>
          </div>
          <div className="ow-dialog-actions">
            <CopyButton text={reset.code} label="Copy code" />
            <button type="button" className="ow-btn ow-btn-primary" data-autofocus onClick={() => setReset(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
