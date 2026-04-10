/**
 * Labels for Biblical mode — consistent vocabulary for scripture vs explanation.
 */

export type BiblicalContentKind =
  | 'scripture'
  | 'commentary'
  | 'interpretation'
  | 'historical_context'
  | 'speculative';

/** Short guidance Henry can reuse when sectioning answers */
export const BIBLICAL_LABEL_GUIDANCE: Record<BiblicalContentKind, string> = {
  scripture:
    'Verbatim or closely-indicated biblical text. Name translation or tradition if relevant; if paraphrasing, say so.',
  commentary:
    'Notes, glosses, or explanations from a tradition, study Bible, or teacher — not inspired text itself.',
  interpretation:
    'Theological or exegetical reasoning: what someone understands the passage to mean.',
  historical_context:
    'Background from history, language, or setting — scholarly or traditional, not the verse text.',
  speculative:
    'Hypothesis or possibility; not doctrine and not direct scripture. State uncertainty plainly.',
};

/** Markdown-style prefixes for optional inline labeling */
export const biblicalKindPrefix = (kind: BiblicalContentKind): string => {
  const labels: Record<BiblicalContentKind, string> = {
    scripture: '**Scripture**',
    commentary: '**Commentary**',
    interpretation: '**Interpretation**',
    historical_context: '**Historical context**',
    speculative: '**Speculative**',
  };
  return labels[kind];
};
