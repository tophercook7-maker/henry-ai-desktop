/**
 * lessonParse — pure helpers for the Lessons tab.
 *
 * Everything an LLM hands back is treated as hostile input: wrapped in code
 * fences, prefixed with chatty prose, trailing commentary, snake_case vs
 * camelCase keys, answers given as letters instead of indexes… These helpers
 * dig the JSON out and normalize it into strict shapes the UI can trust.
 *
 * No React, no IPC, no AI — unit-testable in plain node (lessonParse.test.ts).
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface OutlineLesson {
  title: string;
  objectives: string[];
  scriptureRefs?: string[];
}

export interface CourseOutline {
  title: string;
  description: string;
  lessons: OutlineLesson[];
}

export type QuizQuestion =
  | { type: 'mc'; question: string; options: string[]; answerIndex: number }
  | { type: 'short'; question: string; expected?: string };

export interface Quiz {
  questions: QuizQuestion[];
}

/** Learner's answers, index-aligned with quiz.questions (number for MC, string for short). */
export type QuizAnswer = number | string | null;

export interface ShortAnswerGrade {
  correct: boolean;
  feedback: string;
}

// ── JSON extraction ─────────────────────────────────────────────────────────

/**
 * Pull the first plausible JSON object/array out of raw LLM text.
 * Handles ```json fences, leading prose ("Sure! Here's your course:"),
 * and trailing commentary after the closing brace. Returns null if no
 * balanced JSON value can be found.
 */
export function extractJsonBlock(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();

  // Prefer the contents of the first fenced block if one exists.
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence && fence[1].trim()) text = fence[1].trim();

  // Find the first opening brace/bracket and walk to its balanced close,
  // respecting strings and escapes.
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** extractJsonBlock + JSON.parse, returning null instead of throwing. */
export function parseJsonLoose(raw: string): unknown {
  const block = extractJsonBlock(raw);
  if (!block) return null;
  try {
    return JSON.parse(block);
  } catch {
    // Common LLM slip: trailing commas. One cheap repair pass.
    try {
      return JSON.parse(block.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

// ── Normalizers ─────────────────────────────────────────────────────────────

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter(Boolean);
  const s = asString(v);
  return s ? [s] : [];
}

// ── Course outline ──────────────────────────────────────────────────────────

/**
 * Parse the AI's course outline reply into a CourseOutline.
 * Throws a friendly Error when nothing usable can be recovered — the caller
 * shows the message + a retry button and creates NO database rows.
 */
export function parseCourseOutline(raw: string, fallbackTitle?: string): CourseOutline {
  const data = parseJsonLoose(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    // Maybe the model returned a bare array of lessons.
    if (Array.isArray(data) && data.length > 0) {
      return parseCourseOutline(JSON.stringify({ title: fallbackTitle ?? 'Course', lessons: data }), fallbackTitle);
    }
    throw new Error('Henry\'s outline didn\'t come back as valid JSON. Try again.');
  }

  const obj = data as Record<string, unknown>;
  const rawLessons = obj.lessons ?? obj.syllabus ?? obj.outline ?? obj.modules;
  if (!Array.isArray(rawLessons) || rawLessons.length === 0) {
    throw new Error('The outline came back without any lessons. Try again.');
  }

  const lessons: OutlineLesson[] = [];
  for (const item of rawLessons) {
    if (typeof item === 'string') {
      const title = item.trim();
      if (title) lessons.push({ title, objectives: [] });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const title = asString(l.title ?? l.name ?? l.lesson);
    if (!title) continue;
    const objectives = asStringArray(l.objectives ?? l.goals ?? l.objective);
    const refs = asStringArray(l.scriptureRefs ?? l.scripture_refs ?? l.scriptures ?? l.passages);
    lessons.push(refs.length > 0 ? { title, objectives, scriptureRefs: refs } : { title, objectives });
  }

  if (lessons.length === 0) {
    throw new Error('Every lesson in the outline was missing a title. Try again.');
  }

  return {
    title: asString(obj.title ?? obj.course ?? obj.name) || fallbackTitle || lessons[0].title,
    description: asString(obj.description ?? obj.summary ?? obj.overview),
    lessons,
  };
}

// ── Quiz ────────────────────────────────────────────────────────────────────

/** Convert "B", "b)", "2", 2 … into an option index; -1 when unrecognizable. */
function resolveAnswerIndex(answer: unknown, options: string[]): number {
  if (typeof answer === 'number' && Number.isInteger(answer)) {
    if (answer >= 0 && answer < options.length) return answer;
    // Models sometimes use 1-based indexes.
    if (answer >= 1 && answer <= options.length) return answer - 1;
    return -1;
  }
  const s = asString(answer);
  if (!s) return -1;
  // Letter form: "A", "b)", "C."
  const letter = s.match(/^([A-Za-z])[).\s]*$/);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    return idx >= 0 && idx < options.length ? idx : -1;
  }
  // Numeric string
  if (/^\d+$/.test(s)) return resolveAnswerIndex(parseInt(s, 10), options);
  // Full text of the correct option
  const idx = options.findIndex((o) => o.trim().toLowerCase() === s.toLowerCase());
  return idx;
}

/**
 * Parse the AI's quiz reply. Accepts {questions:[…]} or a bare array.
 * MC questions need ≥2 options and a resolvable correct answer; short-answer
 * questions just need the question text. Throws when nothing usable remains.
 */
export function parseQuiz(raw: string): Quiz {
  const data = parseJsonLoose(raw);
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as Record<string, unknown>).questions
      : null;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('The quiz didn\'t come back as valid JSON. Try again.');
  }

  const questions: QuizQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const question = asString(q.question ?? q.prompt ?? q.text);
    if (!question) continue;

    const type = asString(q.type).toLowerCase();
    const options = asStringArray(q.options ?? q.choices);

    if (type.startsWith('short') || type === 'open' || (options.length < 2 && !type.startsWith('m'))) {
      const expected = asString(q.expected ?? q.answer ?? q.ideal_answer ?? q.idealAnswer ?? q.sample_answer);
      questions.push(expected ? { type: 'short', question, expected } : { type: 'short', question });
      continue;
    }

    if (options.length < 2) continue;
    const answerIndex = resolveAnswerIndex(
      q.answerIndex ?? q.answer_index ?? q.correctIndex ?? q.correct_index ?? q.correct ?? q.answer,
      options,
    );
    if (answerIndex < 0) continue;
    questions.push({ type: 'mc', question, options, answerIndex });
  }

  if (questions.length === 0) {
    throw new Error('None of the quiz questions were usable. Try again.');
  }
  return { questions };
}

// ── Grading ─────────────────────────────────────────────────────────────────

/**
 * Grade a quiz where every question carries equal weight. MC questions are
 * checked locally against answerIndex; short answers arrive pre-graded (true /
 * false / null). A null short-answer grade (AI grading unavailable) simply
 * removes that question from the denominator rather than penalizing.
 * Returns an integer percent 0–100.
 */
export function computeQuizScore(
  quiz: Quiz,
  answers: QuizAnswer[],
  shortGrades: Array<boolean | null>,
): number {
  let correct = 0;
  let total = 0;
  quiz.questions.forEach((q, i) => {
    if (q.type === 'mc') {
      total += 1;
      if (typeof answers[i] === 'number' && answers[i] === q.answerIndex) correct += 1;
    } else {
      const grade = shortGrades[i];
      if (grade === null || grade === undefined) return; // ungraded — excluded
      total += 1;
      if (grade === true) correct += 1;
    }
  });
  if (total === 0) return 0;
  return Math.round((correct / total) * 100);
}

/**
 * Parse the AI's short-answer grading reply. Prefers JSON
 * {correct: boolean, feedback: string}; falls back to reading a leading
 * yes/no/correct/incorrect out of plain text. Never throws — a null return
 * means "couldn't grade".
 */
export function parseShortAnswerGrade(raw: string): ShortAnswerGrade | null {
  const data = parseJsonLoose(raw);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const g = data as Record<string, unknown>;
    const c = g.correct ?? g.isCorrect ?? g.is_correct ?? g.pass;
    if (typeof c === 'boolean') {
      return { correct: c, feedback: asString(g.feedback ?? g.explanation ?? g.comment) };
    }
    if (typeof c === 'string') {
      const s = c.toLowerCase();
      if (['true', 'yes', 'correct'].includes(s)) return { correct: true, feedback: asString(g.feedback) };
      if (['false', 'no', 'incorrect'].includes(s)) return { correct: false, feedback: asString(g.feedback) };
    }
  }
  // Plain-text fallback
  const text = asString(raw).toLowerCase();
  if (!text) return null;
  if (/^(yes|correct|that('|')?s right|right)\b/.test(text)) return { correct: true, feedback: asString(raw) };
  if (/^(no|incorrect|not quite|wrong)\b/.test(text)) return { correct: false, feedback: asString(raw) };
  return null;
}
