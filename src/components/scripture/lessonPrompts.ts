/**
 * lessonPrompts — the teaching voice behind the Lessons tab.
 *
 * Two registers, both pure string builders (no React, no IPC):
 *   - 'bible'   → echoes Henry's biblical operating mode (see src/henry/charter.ts):
 *                 scripture-first, theologically careful, labels scripture vs
 *                 commentary vs interpretation, quotes public-domain text
 *                 (KJV or WEB) only, warm teacher — never preachy.
 *   - 'general' → clear, patient teacher for anything else ("how MQTT works").
 *
 * Every generation prompt demands strict JSON where the UI must parse the
 * reply (outline, quiz, grading); lessonParse.ts handles the inevitable
 * deviations.
 */

export type CourseKind = 'bible' | 'general';
export type CourseDepth = 'intro' | 'deep-dive';

// ── System voices ───────────────────────────────────────────────────────────

export const BIBLE_TEACHER_SYSTEM = `You are Henry in Bible-teacher mode — scripture-first, grounded, warm, never preachy. This is sacred territory for the learner and you treat it that way: with care and honesty, not performance.

Rules you never break:
- Quote scripture ONLY from public-domain translations — the King James Version (KJV) or the World English Bible (WEB). Name the translation when you quote.
- Never present commentary, interpretation, or speculation as if it were verbatim scripture. Label plainly: scripture / commentary / interpretation / historical context / speculative.
- When unsure about translation, canon, or history, say so plainly.
- Theologically careful: stay within broad orthodox Christian teaching; where traditions genuinely differ, say so instead of picking a side silently.
- Tone: a warm, patient teacher who loves the text and loves the student.`;

export const GENERAL_TEACHER_SYSTEM = `You are Henry in teacher mode — a warm, patient, genuinely excellent teacher. You build understanding step by step: plain language first, precise terms second, always anchored in concrete examples and real-world application. You are honest about what is simplified and what is contested. You never pad; every paragraph earns its place.`;

export function teacherSystemPrompt(kind: CourseKind): string {
  return kind === 'bible' ? BIBLE_TEACHER_SYSTEM : GENERAL_TEACHER_SYSTEM;
}

// ── Course outline ──────────────────────────────────────────────────────────

export function buildOutlinePrompt(opts: {
  topic: string;
  kind: CourseKind;
  depth: CourseDepth;
  lessonCount: number;
}): string {
  const { topic, kind, depth, lessonCount } = opts;
  const depthLine =
    depth === 'deep-dive'
      ? 'Depth: a serious deep-dive — assume a motivated learner who wants to really master this.'
      : 'Depth: an accessible introduction — assume a curious beginner.';
  const scriptureLine =
    kind === 'bible'
      ? `Each lesson should include a "scriptureRefs" array of 2-4 key passage references (e.g. "James 1:2-4") central to that lesson.`
      : '';

  return `Design a course that teaches: ${topic}

${depthLine}
The course must have exactly ${lessonCount} lessons, ordered so each builds on the last.
${scriptureLine}

Reply with ONLY a JSON object, no prose before or after, in exactly this shape:
{
  "title": "Course title (short, inviting)",
  "description": "2-3 sentence description of the journey this course takes the learner on",
  "lessons": [
    { "title": "Lesson title", "objectives": ["objective 1", "objective 2"]${kind === 'bible' ? ', "scriptureRefs": ["Book 1:2-3"]' : ''} }
  ]
}`;
}

// ── Lesson content ──────────────────────────────────────────────────────────

export function buildLessonPrompt(opts: {
  courseTitle: string;
  topic: string;
  kind: CourseKind;
  depth: CourseDepth;
  lessonTitle: string;
  lessonNumber: number;
  lessonTotal: number;
  objectives: string[];
  scriptureRefs?: string[];
  priorLessonTitles: string[];
}): string {
  const { courseTitle, topic, kind, depth, lessonTitle, lessonNumber, lessonTotal, objectives, scriptureRefs, priorLessonTitles } = opts;

  const prior = priorLessonTitles.length
    ? `The learner has already completed: ${priorLessonTitles.join('; ')}. Build on that — don't re-teach it.`
    : 'This is the very first lesson — welcome the learner and set the stage.';

  const objectivesLine = objectives.length ? `Lesson objectives: ${objectives.join('; ')}.` : '';

  const structure =
    kind === 'bible'
      ? `Structure the lesson in markdown with these sections:
## Teaching — the heart of the lesson, taught warmly and clearly
## Key Scriptures — quote each key passage in full (KJV or WEB, name the translation), then briefly explain it${scriptureRefs?.length ? `. Center on: ${scriptureRefs.join(', ')}` : ''}
## Living It Out — concrete real-world application for an ordinary believer this week
## Reflection Questions — 3-4 questions for prayerful reflection`
      : `Structure the lesson in markdown with these sections:
## Teaching — the heart of the lesson, taught step by step with concrete examples
## Key Ideas — the handful of concepts/terms the learner must walk away with
## In the Real World — where this shows up in practice and how to apply it
## Reflection Questions — 3-4 questions to check and deepen understanding`;

  return `Course: "${courseTitle}" (topic: ${topic}, ${depth === 'deep-dive' ? 'deep-dive' : 'introductory'} level).
Write lesson ${lessonNumber} of ${lessonTotal}: "${lessonTitle}".
${prior}
${objectivesLine}

${structure}

Write the complete lesson now in markdown. Start with a single # heading of the lesson title. No JSON, no code fences around the whole reply — just the markdown lesson.`;
}

// ── Quiz ────────────────────────────────────────────────────────────────────

export function buildQuizPrompt(opts: {
  kind: CourseKind;
  lessonTitle: string;
  lessonContent: string;
}): string {
  const { kind, lessonTitle, lessonContent } = opts;
  // Keep the excerpt bounded so we don't blow context on long lessons.
  const excerpt = lessonContent.length > 6000 ? lessonContent.slice(0, 6000) + '\n…' : lessonContent;

  return `Here is the lesson "${lessonTitle}" the learner just studied:

---
${excerpt}
---

Write a 5-question quiz on THIS lesson: exactly 4 multiple-choice questions and 1 short-answer question. Multiple-choice questions have exactly 4 options with one clearly correct answer drawn from the lesson.${kind === 'bible' ? ' Questions may cover the scriptures quoted, their meaning, and application — never trick questions on sacred text.' : ''}

Reply with ONLY a JSON object, no prose before or after, in exactly this shape:
{
  "questions": [
    { "type": "mc", "question": "…", "options": ["…", "…", "…", "…"], "answerIndex": 0 },
    { "type": "short", "question": "…", "expected": "a model answer in 1-3 sentences" }
  ]
}`;
}

// ── Short-answer grading ────────────────────────────────────────────────────

export function buildShortGradePrompt(opts: {
  question: string;
  expected?: string;
  answer: string;
}): string {
  const { question, expected, answer } = opts;
  return `Grade this short answer generously but honestly — the learner passes if they show real understanding, even in their own words.

Question: ${question}
${expected ? `Model answer: ${expected}` : ''}
Learner's answer: ${answer}

Reply with ONLY a JSON object: {"correct": true|false, "feedback": "one or two warm, specific sentences"}`;
}
