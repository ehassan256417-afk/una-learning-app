'use client';

import { ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadFigures } from '@/lib/learning/figure-store';
import type { Provenance } from '@/lib/learning/types';

/** At most this many pictures under one note, so the explanation stays the main thing. */
const MAX_SHOWN = 2;

/**
 * Pictures from the student's own slides, shown under a note that cites the
 * same slide. The caption says plainly that the lesson text was written from
 * the slide's words: no model has looked at the picture.
 */
export function SourceFigures({
  documentId,
  provenance,
  unit,
}: {
  documentId: string;
  provenance: Provenance;
  unit: 'page' | 'slide';
}) {
  const pages =
    provenance.kind === 'pdf' ? [...new Set(provenance.citations.map((c) => c.page))].sort((a, b) => a - b) : [];
  const pageKey = pages.join(',');
  const [figures, setFigures] = useState<Array<{ id: string; page: number; url: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const wanted = pageKey ? pageKey.split(',').map(Number) : [];
    void loadFigures(documentId, wanted).then((found) => {
      if (cancelled) return;
      const shown = found.slice(0, MAX_SHOWN).map((f) => {
        const url = URL.createObjectURL(f.blob);
        urls.push(url);
        return { id: f.id, page: f.page, url };
      });
      setFigures(shown);
    });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
      setFigures([]);
    };
  }, [documentId, pageKey]);

  if (figures.length === 0) return null;
  return (
    <div className="figures">
      {figures.map((f) => (
        <figure key={f.id}>
          {/* A blob URL from this device; next/image cannot optimise it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.url} alt={`Picture from ${unit} ${f.page} of your file`} loading="lazy" />
          <figcaption>
            <ImageIcon size={13} /> From {unit} {f.page} of your file
          </figcaption>
        </figure>
      ))}
      <small className="figures-note">
        Shown as it appears in your file. The explanation above was written from the {unit}&apos;s text, not from the
        picture.
      </small>
    </div>
  );
}
