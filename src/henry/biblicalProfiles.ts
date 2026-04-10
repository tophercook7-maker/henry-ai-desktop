/**
 * Bible source profiles — study/canon awareness for Biblical mode (no scripture DB required).
 */

export type BibleSourceCategory = 'protestant' | 'orthodox' | 'ethiopian' | 'study' | 'other';

export type CanonFamily =
  | 'protestant_66'
  | 'orthodox_81'
  | 'ethiopian_orthodox'
  | 'unknown'
  | 'mixed';

export interface BibleSourceProfile {
  id: string;
  label: string;
  category: BibleSourceCategory;
  canonFamily: CanonFamily;
  /** Null when not fixed or edition-dependent */
  booksCount: number | null;
  description: string;
  notes: string;
  priority: number;
}

export const BIBLE_SOURCE_PROFILES = [
  {
    id: 'kjv',
    label: 'KJV-style (66-book Protestant canon)',
    category: 'protestant',
    canonFamily: 'protestant_66',
    booksCount: 66,
    description:
      'Common English tradition aligned with a 66-book Protestant canon. Useful as a baseline Anglophone reference profile.',
    notes:
      'Henry does not assume a specific printed KJV edition. When quoting, label text as your rendering unless the user supplies an exact edition.',
    priority: 40,
  },
  {
    id: 'orthodox_study_bible',
    label: 'Orthodox Study Bible (study profile)',
    category: 'orthodox',
    canonFamily: 'orthodox_81',
    booksCount: null,
    description:
      'A study-oriented profile associated with broader Orthodox canon traditions (often discussed around 81 books, depending on counting and edition).',
    notes:
      'Treat as a configurable study profile, not a single guaranteed print layout. Do not claim verse numbering or deuterocanonical placement without user-provided source text.',
    priority: 35,
  },
  {
    id: 'ethiopian_orthodox_canon',
    label: 'Ethiopian Orthodox canon awareness',
    category: 'ethiopian',
    canonFamily: 'ethiopian_orthodox',
    booksCount: null,
    description:
      'Awareness that the Ethiopian Orthodox Tewahedo Church uses a broader canon than typical Protestant 66-book Bibles; book names, ordering, and counts differ from Protestant tables.',
    notes:
      'Prioritize humility: acknowledge canon breadth and variation in scholarly discussion. Do not flatten Ethiopian tradition into Western tables. Scripture-first still applies—label commentary vs text.',
    priority: 50,
  },
  {
    id: 'ethiopian_study_bible',
    label: 'Ethiopian Study Bible (source profile)',
    category: 'study',
    canonFamily: 'ethiopian_orthodox',
    booksCount: null,
    description:
      'A placeholder for an Ethiopian Study Bible–style source profile: study notes, headings, and helps that may accompany scripture in a given edition.',
    notes:
      'This is not one universal “Ethiopian Study Bible” edition. When the user names a publisher, year, or app, you may align to that. Otherwise treat as a generic study/source lens and keep scripture vs study helps distinct.',
    priority: 45,
  },
] as const satisfies readonly BibleSourceProfile[];

export type BibleSourceProfileId = (typeof BIBLE_SOURCE_PROFILES)[number]['id'];

export const BIBLE_SOURCE_PROFILE_IDS = BIBLE_SOURCE_PROFILES.map((p) => p.id) as BibleSourceProfileId[];

/** Default when Biblical mode is on and none stored yet — canon-aware baseline. */
export const DEFAULT_BIBLICAL_SOURCE_PROFILE_ID: BibleSourceProfileId = 'ethiopian_orthodox_canon';

export function isBibleSourceProfileId(value: string): value is BibleSourceProfileId {
  return (BIBLE_SOURCE_PROFILE_IDS as readonly string[]).includes(value);
}

export function getBibleSourceProfile(id: string): BibleSourceProfile | undefined {
  return BIBLE_SOURCE_PROFILES.find((p) => p.id === id);
}

/**
 * Compact system-prompt addition: active profile + discipline (no DB scripture).
 */
export function getBiblicalCompanionPromptAddition(
  profileId: BibleSourceProfileId | undefined
): string {
  const id = profileId && getBibleSourceProfile(profileId) ? profileId : DEFAULT_BIBLICAL_SOURCE_PROFILE_ID;
  const p = getBibleSourceProfile(id)!;
  return `Active Bible source profile: **${p.label}** (${p.category} / ${p.canonFamily}).
${p.description}
Profile notes: ${p.notes}`;
}
