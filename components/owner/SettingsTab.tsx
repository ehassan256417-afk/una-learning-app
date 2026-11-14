'use client';

import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/account/client';
import type { PlatformSettings, RegistrationMode } from '@/lib/account/contracts';
import { Invites } from './Invites';
import { errorText, useLoad } from './format';
import { Card, ErrorState, Field, Skeleton } from './ui';

function NumField({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  const n = Number(text);
  const bad = text.trim() === '' || !Number.isFinite(n) || n < min || n > max;
  return (
    <Field label={label} hint={bad ? `Enter a number from ${min} to ${max}.` : (hint ?? `Allowed: ${min} to ${max}.`)}>
      {(id) => (
        <input
          id={id}
          className="ow-input ow-input-narrow"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          aria-invalid={bad}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange(v);
          }}
        />
      )}
    </Field>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="ow-toggle">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>
        <strong>{label}</strong>
        <span className="ow-note">{hint}</span>
      </label>
    </div>
  );
}

const MODES: Array<{ value: RegistrationMode; label: string; text: string }> = [
  { value: 'open', label: 'Open', text: 'Anyone can create an account.' },
  { value: 'invite', label: 'Invite only', text: 'Only people with a valid invite code can create an account.' },
  { value: 'closed', label: 'Closed', text: 'Nobody can create a new account. Existing students can still sign in.' },
];

const clone = (s: PlatformSettings): PlatformSettings => JSON.parse(JSON.stringify(s)) as PlatformSettings;

export function SettingsTab({ tick }: { tick: number }) {
  const { data, loading, error, forbidden, reload } = useLoad<{ settings: PlatformSettings }>('/api/admin/settings', tick);
  const [saved, setSaved] = useState<PlatformSettings | null>(null);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setSaved(data.settings);
      setDraft(clone(data.settings));
    }
  }, [data]);

  if (error && !draft) return <ErrorState message={error} forbidden={forbidden} onRetry={reload} />;
  if (!draft || !saved) return loading ? <Skeleton rows={8} /> : null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const edit = (fn: (d: PlatformSettings) => void) => {
    const next = clone(draft);
    fn(next);
    setDraft(next);
    setJustSaved(false);
    setSaveError(null);
  };

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api<{ settings: PlatformSettings }>('/api/admin/settings', { method: 'PUT', body: { settings: draft } });
      setSaved(res.settings);
      setDraft(clone(res.settings));
      setJustSaved(true);
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ow-stack-y">
      <Card title="Access" note="Who may create an account.">
        <fieldset className="ow-radios">
          <legend className="ow-sr">Registration mode</legend>
          {MODES.map((m) => (
            <label key={m.value} className="ow-radio">
              <input type="radio" name="ow-registration" value={m.value} checked={draft.registration.mode === m.value} onChange={() => edit((d) => void (d.registration.mode = m.value))} />
              <span>
                <strong>{m.label}</strong>
                <span className="ow-note">{m.text}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Invites />

      <Card title="AI limits" note="Requests above a limit are refused and counted as “refused by limits”.">
        <div className="ow-form-grid">
          <NumField label="Requests per student per day" value={draft.limits.userDailyAiRequests} min={0} max={10000} onChange={(n) => edit((d) => void (d.limits.userDailyAiRequests = n))} hint="Allowed 0 to 10,000. Counted per UTC day." />
          <NumField label="Requests for the whole platform per day" value={draft.limits.dailyAiRequests} min={0} max={100000} onChange={(n) => edit((d) => void (d.limits.dailyAiRequests = n))} hint="Allowed 0 to 100,000. Counted per UTC day." />
          <NumField label="Requests per course" value={draft.limits.courseMaxRequests} min={3} max={60} onChange={(n) => edit((d) => void (d.limits.courseMaxRequests = n))} hint="Planning plus every lesson of one course. Allowed 3 to 60." />
          <NumField label="Tokens per course" value={draft.limits.courseMaxTokens} min={10000} max={2000000} step={1000} onChange={(n) => edit((d) => void (d.limits.courseMaxTokens = n))} hint="Allowed 10,000 to 2,000,000." />
          <NumField label="Courses per student" value={draft.limits.maxCoursesPerUser} min={1} max={200} onChange={(n) => edit((d) => void (d.limits.maxCoursesPerUser = n))} hint="Allowed 1 to 200." />
        </div>
      </Card>

      <Card title="AI model and prices" note="Prices are only used to estimate cost on the AI and Users screens. They never change what the provider charges you.">
        <div className="ow-form-grid">
          <Field label="Model name" hint="Leave empty to use the server's configured default.">
            {(id) => (
              <input
                id={id}
                className="ow-input"
                value={draft.ai.model}
                maxLength={80}
                pattern="[A-Za-z0-9._:/\-]{0,80}"
                onChange={(e) => edit((d) => void (d.ai.model = e.target.value.trim()))}
              />
            )}
          </Field>
          <NumField label="Input price (USD per million tokens)" value={draft.ai.inputPricePerMTok} min={0} max={1000} step={0.01} onChange={(n) => edit((d) => void (d.ai.inputPricePerMTok = n))} hint="0 means not set. Allowed 0 to 1,000." />
          <NumField label="Output price (USD per million tokens)" value={draft.ai.outputPricePerMTok} min={0} max={1000} step={0.01} onChange={(n) => edit((d) => void (d.ai.outputPricePerMTok = n))} hint="0 means not set. Allowed 0 to 1,000." />
        </div>
      </Card>

      <Card title="Features" note="Switch parts of the product on or off for every student.">
        <div className="ow-toggles">
          <Toggle label="Lesson generation" hint="Creating lessons from an uploaded file. The server enforces this: when off, no AI requests are made." checked={draft.features.generation} onChange={(v) => edit((d) => void (d.features.generation = v))} />
          <Toggle label="PowerPoint upload" hint="Accept .pptx files on the upload screen." checked={draft.features.pptxUpload} onChange={(v) => edit((d) => void (d.features.pptxUpload = v))} />
          <Toggle label="Spaced review" hint="Show the review tab and review sessions." checked={draft.features.spacedReview} onChange={(v) => edit((d) => void (d.features.spacedReview = v))} />
          <Toggle label="Sample courses" hint="Show the built-in sample courses to students." checked={draft.features.sampleCourses} onChange={(v) => edit((d) => void (d.features.sampleCourses = v))} />
        </div>
      </Card>

      <Card title="Announcement" note="A banner every student sees at the top of the app.">
        <Toggle label="Show the announcement" hint="Off hides the banner without losing the text." checked={draft.announcement.active} onChange={(v) => edit((d) => void (d.announcement.active = v))} />
        <div className="ow-form-grid">
          <Field label="Text" hint={`${draft.announcement.text.length} of 300 characters.`}>
            {(id) => <textarea id={id} className="ow-input ow-textarea" rows={3} maxLength={300} value={draft.announcement.text} onChange={(e) => edit((d) => void (d.announcement.text = e.target.value))} />}
          </Field>
          <Field label="Tone">
            {(id) => (
              <select id={id} className="ow-input" value={draft.announcement.tone} onChange={(e) => edit((d) => void (d.announcement.tone = e.target.value === 'warning' ? 'warning' : 'info'))}>
                <option value="info">Information</option>
                <option value="warning">Warning</option>
              </select>
            )}
          </Field>
        </div>
        <p className="ow-sub-label">Preview{draft.announcement.active ? '' : ' (not shown to students while switched off)'}</p>
        {draft.announcement.text.trim() ? (
          <div className={`ow-banner ow-banner-${draft.announcement.tone}`} role="note">
            <strong>{draft.announcement.tone === 'warning' ? 'Warning: ' : 'Notice: '}</strong>
            {draft.announcement.text}
          </div>
        ) : (
          <p className="ow-note">Type some text to see the preview.</p>
        )}
      </Card>

      <Card title="Site">
        <div className="ow-form-grid">
          <Field label="Tagline" hint={`${draft.site.tagline.length} of 160 characters.`}>
            {(id) => <input id={id} className="ow-input" maxLength={160} value={draft.site.tagline} onChange={(e) => edit((d) => void (d.site.tagline = e.target.value))} />}
          </Field>
          <Field label="Support email" hint="Shown to students who need help. Leave empty to hide it.">
            {(id) => <input id={id} className="ow-input" type="email" maxLength={120} value={draft.site.supportEmail} onChange={(e) => edit((d) => void (d.site.supportEmail = e.target.value))} />}
          </Field>
        </div>
      </Card>

      <Card title="Learning">
        <div className="ow-form-grid">
          <NumField label="Items in one review session" value={draft.learning.reviewSessionSize} min={5} max={50} onChange={(n) => edit((d) => void (d.learning.reviewSessionSize = n))} hint="Allowed 5 to 50." />
          <NumField label="Daily XP goal" value={draft.learning.dailyGoalXp} min={10} max={1000} onChange={(n) => edit((d) => void (d.learning.dailyGoalXp = n))} hint="Allowed 10 to 1,000." />
        </div>
      </Card>

      <div className="ow-savebar" role="region" aria-label="Save settings">
        <div className="ow-savebar-msg" aria-live="polite">
          {saveError ? (
            <span className="ow-form-error" role="alert">
              {saveError}
            </span>
          ) : justSaved && !dirty ? (
            <span className="ow-form-ok">Saved</span>
          ) : dirty ? (
            <span>You have unsaved changes.</span>
          ) : (
            <span className="ow-dim">No changes.</span>
          )}
        </div>
        <button type="button" className="ow-btn" disabled={!dirty || saving} onClick={() => { setDraft(clone(saved)); setSaveError(null); setJustSaved(false); }}>
          Discard
        </button>
        <button type="button" className="ow-btn ow-btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
