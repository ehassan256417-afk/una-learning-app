'use client';

import { useState } from 'react';
import { api } from '@/lib/account/client';
import type { AdminCourseRow } from '@/lib/account/contracts';
import { bytes, dateTime, num, sourceLabel, useDebounced, useLoad } from './format';
import { Badge, Card, ConfirmDialog, Empty, ErrorState, Skeleton, TableWrap } from './ui';

type Pending = { kind: 'hide' | 'restore' | 'delete'; course: AdminCourseRow } | null;

const coursePath = (c: AdminCourseRow) => `/api/admin/courses/${encodeURIComponent(c.userId)}/${encodeURIComponent(c.id)}`;

export function ContentTab({ tick }: { tick: number }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const dq = useDebounced(q.trim(), 300);
  const params = new URLSearchParams();
  if (dq) params.set('q', dq);
  if (state) params.set('state', state);
  const { data, loading, error, forbidden, reload } = useLoad<{ courses: AdminCourseRow[] }>(`/api/admin/courses?${params.toString()}`, tick);

  return (
    <div className="ow-stack-y">
      <p className="ow-note">You see titles, file names and counts only. Lesson text is never shown to you here.</p>
      <Card>
        <div className="ow-toolbar">
          <div className="ow-field ow-grow">
            <label htmlFor="ow-course-search">Search by title, file or student email</label>
            <input id="ow-course-search" type="search" className="ow-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses" />
          </div>
          <div className="ow-field">
            <label htmlFor="ow-course-state">Show</label>
            <select id="ow-course-state" className="ow-input" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All courses</option>
              <option value="incomplete">Incomplete (lessons missing or failed)</option>
              <option value="hidden">Taken offline</option>
            </select>
          </div>
        </div>
      </Card>

      {error ? (
        <ErrorState message={error} forbidden={forbidden} onRetry={reload} />
      ) : !data ? (
        loading ? (
          <Skeleton rows={6} />
        ) : null
      ) : data.courses.length === 0 ? (
        <Card>
          <Empty>{dq || state ? 'No courses match these filters.' : 'No courses yet. Courses appear here after a student uploads a file and lessons are created.'}</Empty>
        </Card>
      ) : (
        <Card title={`${num(data.courses.length)} ${data.courses.length === 1 ? 'course' : 'courses'}`}>
          <TableWrap label="Courses">
            <table className={`ow-table ${loading ? 'ow-refreshing' : ''}`}>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Source file</th>
                  <th scope="col">Type</th>
                  <th scope="col">Student</th>
                  <th scope="col" className="ow-num">
                    Lessons ready / planned
                  </th>
                  <th scope="col" className="ow-num">
                    Failed
                  </th>
                  <th scope="col" className="ow-num">
                    Size
                  </th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="ow-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.courses.map((c) => (
                  <tr key={`${c.userId}/${c.id}`}>
                    <th scope="row" className="ow-wrap">
                      {c.title || '(untitled)'}
                      {c.hidden && (
                        <>
                          {' '}
                          <Badge tone="warn">Offline</Badge>
                        </>
                      )}
                      {c.hidden && c.hiddenReason && <div className="ow-note">Reason: {c.hiddenReason}</div>}
                    </th>
                    <td className="ow-wrap">{c.documentName || '—'}</td>
                    <td>{sourceLabel(c.sourceKind)}</td>
                    <td className="ow-wrap">{c.userEmail}</td>
                    <td className="ow-num">
                      {num(c.lessonsReady)} / {num(c.lessonsPlanned)}
                    </td>
                    <td className="ow-num">{c.lessonsFailed > 0 ? <Badge tone="bad">{num(c.lessonsFailed)} failed</Badge> : '0'}</td>
                    <td className="ow-num">{bytes(c.bytes)}</td>
                    <td>{dateTime(c.updatedAt)}</td>
                    <td>
                      <div className="ow-row-actions">
                        {c.hidden ? (
                          <button type="button" className="ow-btn ow-btn-sm" onClick={() => setPending({ kind: 'restore', course: c })}>
                            Put back
                          </button>
                        ) : (
                          <button type="button" className="ow-btn ow-btn-sm" onClick={() => setPending({ kind: 'hide', course: c })}>
                            Take offline
                          </button>
                        )}
                        <button type="button" className="ow-btn ow-btn-sm ow-btn-danger-outline" onClick={() => setPending({ kind: 'delete', course: c })}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {pending?.kind === 'hide' && (
        <ConfirmDialog
          title="Take this course offline?"
          body={
            <p>
              {pending.course.userEmail} will stop seeing “{pending.course.title || 'untitled'}”. Nothing is deleted, and you can put it back at any time.
            </p>
          }
          inputLabel="Reason (optional, kept in the audit log)"
          inputPlaceholder="For example: reported content"
          confirmLabel="Take offline"
          onConfirm={async (reason) => {
            await api(coursePath(pending.course), { method: 'PATCH', body: { hidden: true, reason: reason || undefined } });
            reload();
          }}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'restore' && (
        <ConfirmDialog
          title="Put this course back?"
          body={<p>{pending.course.userEmail} will see “{pending.course.title || 'untitled'}” again.</p>}
          confirmLabel="Put back"
          onConfirm={async () => {
            await api(coursePath(pending.course), { method: 'PATCH', body: { hidden: false } });
            reload();
          }}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete this course permanently?"
          danger
          body={
            <p>
              “{pending.course.title || 'untitled'}” of {pending.course.userEmail} will be removed with all of its lessons. This cannot be undone. If you only want the student to stop seeing it, use Take offline instead.
            </p>
          }
          confirmLabel="Delete permanently"
          onConfirm={async () => {
            await api(coursePath(pending.course), { method: 'DELETE' });
            reload();
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
