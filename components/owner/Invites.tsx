'use client';

import { useState } from 'react';
import { api } from '@/lib/account/client';
import type { InviteRow } from '@/lib/account/contracts';
import { dateOnly, errorText, num, useLoad } from './format';
import { Badge, Card, ConfirmDialog, CopyButton, Empty, ErrorState, Field, Skeleton, TableWrap } from './ui';

export function Invites() {
  const { data, loading, error, forbidden, reload, setData } = useLoad<{ invites: InviteRow[] }>('/api/admin/invites');
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<InviteRow | null>(null);

  async function create() {
    const uses = Number(maxUses);
    if (!Number.isInteger(uses) || uses < 1 || uses > 500) {
      setFormError('Uses must be a whole number between 1 and 500.');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const res = await api<{ code: string; invites: InviteRow[] }>('/api/admin/invites', { method: 'POST', body: { note: note.trim(), maxUses: uses } });
      setData({ invites: res.invites });
      setFresh(res.code);
      setNote('');
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  const status = (i: InviteRow) => (i.revokedAt ? { tone: 'bad' as const, text: 'Revoked' } : i.uses >= i.maxUses ? { tone: 'neutral' as const, text: 'Used up' } : { tone: 'good' as const, text: 'Active' });

  return (
    <Card title="Beta invites" note="A code lets one person (or several, if you allow more uses) register while registration is set to invite only.">
      <div className="ow-toolbar">
        <Field label="Note (who is it for?)">
          {(id) => <input id={id} className="ow-input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="For example: Dr. Smith's class" />}
        </Field>
        <Field label="Uses allowed">
          {(id) => <input id={id} className="ow-input ow-input-narrow" type="number" min={1} max={500} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />}
        </Field>
        <button type="button" className="ow-btn ow-btn-primary ow-align-end" onClick={() => void create()} disabled={creating}>
          {creating ? 'Creating…' : 'Create invite'}
        </button>
      </div>
      {formError && (
        <p className="ow-form-error" role="alert">
          {formError}
        </p>
      )}
      {fresh && (
        <p className="ow-callout" role="status">
          New invite code: <code>{fresh}</code> <CopyButton text={fresh} label="Copy code" />
        </p>
      )}
      {error ? (
        <ErrorState message={error} forbidden={forbidden} onRetry={reload} />
      ) : !data ? (
        loading ? (
          <Skeleton rows={3} />
        ) : null
      ) : data.invites.length === 0 ? (
        <Empty>No invites yet. Codes you create will be listed here with how often each was used.</Empty>
      ) : (
        <TableWrap label="Invites">
          <table className="ow-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Note</th>
                <th scope="col" className="ow-num">
                  Uses
                </th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="ow-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.invites.map((i) => {
                const s = status(i);
                return (
                  <tr key={i.code}>
                    <th scope="row">
                      <code>{i.code}</code>
                    </th>
                    <td className="ow-wrap">{i.note || '—'}</td>
                    <td className="ow-num">
                      {num(i.uses)} / {num(i.maxUses)}
                    </td>
                    <td>
                      <Badge tone={s.tone}>{s.text}</Badge>
                    </td>
                    <td>{dateOnly(i.createdAt)}</td>
                    <td>
                      <div className="ow-row-actions">
                        <CopyButton text={i.code} />
                        {!i.revokedAt && (
                          <button type="button" className="ow-btn ow-btn-sm ow-btn-danger-outline" onClick={() => setRevoke(i)}>
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {revoke && (
        <ConfirmDialog
          title="Revoke this invite?"
          body={<p>The code {revoke.code} stops working. People who already registered with it keep their accounts.</p>}
          confirmLabel="Revoke invite"
          danger
          onConfirm={async () => {
            const res = await api<{ invites: InviteRow[] }>(`/api/admin/invites/${encodeURIComponent(revoke.code)}`, { method: 'DELETE' });
            setData({ invites: res.invites });
          }}
          onClose={() => setRevoke(null)}
        />
      )}
    </Card>
  );
}
