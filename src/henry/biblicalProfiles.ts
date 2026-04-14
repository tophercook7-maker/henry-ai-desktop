/**
 * Bible translation profiles — each carries a language register and canon guidance
 * that steers how Henry quotes, paraphrases, and responds in Biblical mode.
 *
 * Honesty rule: Henry does not have a live database of every translation.
 * When a version is selected, Henry:
 *   1. Uses any locally imported scripture that matches the source label.
 *   2. Renders verses in the translation's documented language register
 *      when the local store is empty for that reference.
 *   3. Labels rendered text as his own rendering unless the local store confirms
 *      the exact text came from an imported source.
 */

export type BibleSourceCategory =
  | 'protestant'
  | 'orthodox'
  | 'ethiopian'
  | 'study'
  | 'other';

export type CanonFamily =
  | 'protestant_66'
  | 'orthodox_81'
  | 'ethiopian_orthodox'
  | 'unknown'
  | 'mixed';

export interface BibleSourceProfile {
  id: string;
  label: string;
  shortLabel: string;
  category: BibleSourceCategory;
  canonFamily: CanonFamily;
  booksCount: number | null;
  description: string;
  notes: string;
  /** How Henry should write when quoting or rendering scripture in this version. */
  languageRegister: string;
  priority: number;
}

export const BIBLE_SOURCE_PROFILES = [
  {
    id: 'kjv',
    label: 'King James Version (KJV)',
    shortLabel: 'KJV',
    category: 'protestant',
    canonFamily: 'protestant_66',
    booksCount: 66,
    description: 'The 1611 Authorized Version. Formal, poetic, archaic English with thee/thou/hath/shalt. 66-book Protestant canon.',
    notes: 'When quoting scripture without a locally imported text, render in formal archaic style that honors the KJV register. Label your rendering clearly unless the local store confirms the exact text.',
    languageRegister: `You are responding in KJV (King James Version) mode. When quoting or rendering scripture:
- Use formal archaic English: thee, thou, thy, thine, ye, hath, doth, shalt, wilt, art, dost, wouldest
- Preserve the poetic, elevated register of the 1611 tradition
- Structure long passages with the semicolon-heavy, rhythmic cadence of the KJV
- Example: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." (John 3:16, KJV)
- Label your rendering: if the local store has this verse, use its exact text; otherwise note "(KJV rendering)" next to your quotation`,
    priority: 40,
  },
  {
    id: 'niv',
    label: 'New International Version (NIV)',
    shortLabel: 'NIV',
    category: 'protestant',
    canonFamily: 'protestant_66',
    booksCount: 66,
    description: 'The 1978/2011 NIV. Clear, modern English prioritizing meaning-for-meaning accuracy. Most widely read translation worldwide.',
    notes: 'When quoting scripture without a locally imported text, render in clear modern English in the NIV style. Label your rendering clearly.',
    languageRegister: `You are responding in NIV (New International Version) mode. When quoting or rendering scripture:
- Use clear, natural, contemporary English — no archaic forms
- Prioritize meaning-for-meaning accuracy over word-for-word literal rendering
- Keep sentences readable and conversational without sacrificing theological precision
- Example: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life." (John 3:16, NIV)
- Label your rendering: if the local store has this verse, use its exact text; otherwise note "(NIV rendering)"`,
    priority: 50,
  },
  {
    id: 'esv',
    label: 'English Standard Version (ESV)',
    shortLabel: 'ESV',
    category: 'protestant',
    canonFamily: 'protestant_66',
    booksCount: 66,
    description: 'The 2001/2016 ESV. Essentially literal word-for-word accuracy in readable modern English. Widely used in study and theology.',
    notes: 'When quoting scripture without a locally imported text, render in the ESV style — precise, dignified, essentially literal. Label your rendering clearly.',
    languageRegister: `You are responding in ESV (English Standard Version) mode. When quoting or rendering scripture:
- Use essentially literal word-for-word translation style in modern English
- Maintain the precise, dignified, slightly formal register of the ESV
- Favor accuracy to the original text structure over dynamic readability
- Example: "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life." (John 3:16, ESV)
- Label your rendering: if the local store has this verse, use its exact text; otherwise note "(ESV rendering)"`,
    priority: 45,
  },
  {
    id: 'nkjv',
    label: 'New King James Version (NKJV)',
    shortLabel: 'NKJV',
    category: 'protestant',
    canonFamily: 'protestant_66',
    booksCount: 66,
    description: 'The 1982 NKJV. Modernized KJV — eliminates thee/thou but retains the traditional, dignified KJV register and Textus Receptus base.',
    notes: 'When quoting scripture without a locally imported text, render in the NKJV style — KJV dignity without archaic pronouns. Label your rendering clearly.',
    languageRegister: `You are responding in NKJV (New King James Version) mode. When quoting or rendering scripture:
- Use the dignified, slightly formal register of the traditional KJV but with modern pronouns (you/your instead of thee/thou)
- No archaic verb forms (say "has" not "hath", "will" not "wilt")
- Maintain the majesty and rhythm of the KJV tradition in modern form
- Example: "For God so loved the world that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life." (John 3:16, NKJV)
- Label your rendering: if the local store has this verse, use its exact text; otherwise note "(NKJV rendering)"`,
    priority: 42,
  },
  {
    id: 'nlt',
    label: 'New Living Translation (NLT)',
    shortLabel: 'NLT',
    category: 'protestant',
    canonFamily: 'protestant_66',
    booksCount: 66,
    description: 'The 1996/2015 NLT. Thought-for-thought dynamic equivalence. Warm, plain, highly readable. Often recommended for devotional reading.',
    notes: 'When quoting scripture without a locally imported text, render in the NLT style — warm, plain, devotional. Label your rendering clearly.',
    languageRegister: `You are responding in NLT (New Living Translation) mode. When quoting or rendering scripture:
- Use warm, plain, everyday language — the goal is immediate clarity for any reader
- Thought-for-thought dynamic rendering: capture the meaning, not just the words
- Use simple sentence structures; avoid complex theological vocabulary unless explaining it
- Example: "For this is how God loved the world: He gave his one and only Son, so that everyone who believes in him will not perish but have eternal life." (John 3:16, NLT)
- Label your rendering: if the local store has this verse, use its exact text; otherwise note "(NLT rendering)"`,
    priority: 38,
  },
  {
    id: 'nasb',
    label: 'New American Standard Bible (NASB)',
    shortLabel: 'NASB',
    category: 'protestant',
    canonFamily: 'protestant_66',
    booksCount: 66,
    description: 'The 1971/2020 NASB. Highly literal word-for-word. Considered one of the most accurate English translations for serious study.',
    notes: 'When quoting scripture without a locally imported text, render in the NASB style — highly literal, precise. Label your rendering clearly.',
    languageRegister: `You are responding in NASB (New American Standard Bible) mode. When quoting or rendering scripture:
- Use highly literal word-for-word translation style — the most precise English rendering possible
- Formal, precise language that closely mirrors original-language sentence structure
- Do not smooth out difficult phrases; preserve the original structure even if slightly awkward
- Example: "For God so loved the world, that He gave His only Son, so that everyone who believes in Him will not perish, but have eternal life." (John 3:16, NASB 2020)
- Label your rendering: if the local store has this verse, use its exact text; otherwise note "(NASB rendering)"`,
    priority: 43,
  },
  {
    id: 'orthodox_study_bible',
    label: 'Orthodox Study Bible',
    shortLabel: 'Orthodox SB',
    category: 'orthodox',
    canonFamily: 'orthodox_81',
    booksCount: null,
    description: 'Study profile for Orthodox traditions (often ~81 books). Includes deuterocanonical books and Orthodox patristic commentary approach.',
    notes: 'Treat as a configurable study profile. Acknowledge deuterocanonical books. Do not claim exact verse numbering without user-provided source text.',
    languageRegister: `You are responding in Orthodox Study Bible mode. When quoting or rendering scripture:
- Use a reverent, liturgical register appropriate to Orthodox Christian tradition
- Acknowledge the broader Orthodox canon including deuterocanonical books (Tobit, Judith, Maccabees, Wisdom, Sirach, etc.)
- Note when a book or passage may not appear in Protestant 66-book Bibles
- Reference patristic interpretation tradition where relevant (Church Fathers, councils)
- Label your rendering clearly: note when quoting from the deuterocanon and that your rendering is approximate unless locally imported text is present`,
    priority: 35,
  },
  {
    id: 'ethiopian_orthodox_canon',
    label: 'Ethiopian Orthodox Canon',
    shortLabel: 'Ethiopian Orthodox',
    category: 'ethiopian',
    canonFamily: 'ethiopian_orthodox',
    booksCount: null,
    description: 'The broader canon of the Ethiopian Orthodox Tewahedo Church. Book names, ordering, and total count differ significantly from Protestant tables.',
    notes: 'Prioritize humility: acknowledge canon breadth and variation. Do not flatten Ethiopian tradition into Western tables. Scripture-first still applies.',
    languageRegister: `You are responding in Ethiopian Orthodox Canon mode. When quoting or rendering scripture:
- Honor the distinct Ethiopian Orthodox Tewahedo tradition — the broadest biblical canon in Christianity
- Acknowledge books not found in Protestant Bibles: Enoch (Henok), Jubilees (Kufale), 4 Ezra, Shepherd of Hermas, and others recognized in the Ethiopian canon
- Use Ge'ez/Amharic transliterations for book names when helpful (e.g., Henok for Enoch, Dawit for Psalms of David)
- Apply the liturgical, meditative register of the Ethiopian Orthodox Tewahedo tradition
- Be explicit about canon differences: when referencing a book not in Protestant Bibles, note its Ethiopian Orthodox canonical status
- Never flatten Ethiopian tradition into Western Protestant or Catholic frameworks`,
    priority: 50,
  },
  {
    id: 'ethiopian_study_bible',
    label: 'Ethiopian Study Bible',
    shortLabel: 'Ethiopian SB',
    category: 'study',
    canonFamily: 'ethiopian_orthodox',
    booksCount: null,
    description: 'Study-oriented Ethiopian Bible profile with notes, headings, and helps. Configurable by edition (publisher, year, app).',
    notes: 'This is not one universal edition. When the user names a publisher or year, align to that. Otherwise treat as a study/source lens keeping scripture distinct from study helps.',
    languageRegister: `You are responding in Ethiopian Study Bible mode. When quoting or rendering scripture:
- Combine the Ethiopian Orthodox canon awareness with study-oriented commentary and helps
- Draw on both the biblical text and study notes, but label them clearly: scripture, study note, commentary, and personal interpretation are always distinct
- Reference the Ethiopian Orthodox patristic tradition and Tewahedo theology where relevant
- If a specific edition is mentioned (publisher, year, digital app), align to that when possible
- Maintain the Ethiopian Orthodox liturgical register while keeping clarity for the reader`,
    priority: 45,
  },
] as const satisfies readonly BibleSourceProfile[];

export type BibleSourceProfileId = (typeof BIBLE_SOURCE_PROFILES)[number]['id'];

export const BIBLE_SOURCE_PROFILE_IDS = BIBLE_SOURCE_PROFILES.map(
  (p) => p.id
) as BibleSourceProfileId[];

/** Default: NIV — most widely recognized, clear modern English. */
export const DEFAULT_BIBLICAL_SOURCE_PROFILE_ID: BibleSourceProfileId = 'niv';

export function isBibleSourceProfileId(value: string): value is BibleSourceProfileId {
  return (BIBLE_SOURCE_PROFILE_IDS as readonly string[]).includes(value);
}

export function getBibleSourceProfile(id: string): BibleSourceProfile | undefined {
  return BIBLE_SOURCE_PROFILES.find((p) => p.id === id);
}

/**
 * System prompt addition for the chosen Bible version.
 * Includes the version's language register instructions so Henry actually
 * responds in the style of the chosen translation.
 */
export function getBiblicalCompanionPromptAddition(
  profileId: BibleSourceProfileId | undefined
): string {
  const id =
    profileId && getBibleSourceProfile(profileId)
      ? profileId
      : DEFAULT_BIBLICAL_SOURCE_PROFILE_ID;
  const p = getBibleSourceProfile(id)!;

  return `## Active Bible version: ${p.label}

${p.description}

${p.languageRegister}

Study notes: ${p.notes}`;
}
