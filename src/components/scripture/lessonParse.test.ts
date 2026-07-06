import { describe, expect, it } from 'vitest';
import {
  computeQuizScore,
  extractJsonBlock,
  parseCourseOutline,
  parseJsonLoose,
  parseQuiz,
  parseShortAnswerGrade,
  type Quiz,
} from './lessonParse';

// ── extractJsonBlock ─────────────────────────────────────────────────────────

describe('extractJsonBlock', () => {
  it('returns plain JSON untouched', () => {
    expect(extractJsonBlock('{"a":1}')).toBe('{"a":1}');
  });

  it('strips ```json fences', () => {
    const raw = '```json\n{"title":"X"}\n```';
    expect(extractJsonBlock(raw)).toBe('{"title":"X"}');
  });

  it('digs JSON out of leading prose and trailing commentary', () => {
    const raw = 'Sure! Here is your course:\n{"title":"James","lessons":[]}\nLet me know if you want changes.';
    expect(extractJsonBlock(raw)).toBe('{"title":"James","lessons":[]}');
  });

  it('handles nested braces and braces inside strings', () => {
    const raw = 'x {"q":"what is {a} vs }b{?","n":{"m":2}} y';
    expect(JSON.parse(extractJsonBlock(raw)!)).toEqual({ q: 'what is {a} vs }b{?', n: { m: 2 } });
  });

  it('handles escaped quotes inside strings', () => {
    const raw = '{"q":"he said \\"hi\\" {"}';
    expect(JSON.parse(extractJsonBlock(raw)!)).toEqual({ q: 'he said "hi" {' });
  });

  it('extracts top-level arrays', () => {
    expect(extractJsonBlock('answer: [1,2,3] done')).toBe('[1,2,3]');
  });

  it('returns null when there is no JSON', () => {
    expect(extractJsonBlock('no json here at all')).toBeNull();
    expect(extractJsonBlock('')).toBeNull();
    expect(extractJsonBlock('{"unbalanced": true')).toBeNull();
  });
});

// ── parseJsonLoose ───────────────────────────────────────────────────────────

describe('parseJsonLoose', () => {
  it('repairs trailing commas', () => {
    expect(parseJsonLoose('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 });
  });

  it('returns null on garbage', () => {
    expect(parseJsonLoose('{{{{')).toBeNull();
  });
});

// ── parseCourseOutline ───────────────────────────────────────────────────────

describe('parseCourseOutline', () => {
  const good = JSON.stringify({
    title: 'The Book of James',
    description: 'Faith that works.',
    lessons: [
      { title: 'Trials & Joy', objectives: ['Understand James 1'], scriptureRefs: ['James 1:2-4'] },
      { title: 'Faith and Works', objectives: ['Explain James 2'] },
    ],
  });

  it('parses a clean outline', () => {
    const o = parseCourseOutline(good);
    expect(o.title).toBe('The Book of James');
    expect(o.lessons).toHaveLength(2);
    expect(o.lessons[0].scriptureRefs).toEqual(['James 1:2-4']);
    expect(o.lessons[1].scriptureRefs).toBeUndefined();
  });

  it('parses an outline wrapped in fences + prose', () => {
    const o = parseCourseOutline('Here you go!\n```json\n' + good + '\n```\nEnjoy the course.');
    expect(o.lessons).toHaveLength(2);
  });

  it('tolerates snake_case scripture refs and string lessons', () => {
    const raw = JSON.stringify({
      title: 'X',
      lessons: [
        { title: 'A', scripture_refs: ['John 3:16'] },
        'Just a title string',
      ],
    });
    const o = parseCourseOutline(raw);
    expect(o.lessons[0].scriptureRefs).toEqual(['John 3:16']);
    expect(o.lessons[1]).toEqual({ title: 'Just a title string', objectives: [] });
  });

  it('falls back to the topic when title is missing', () => {
    const o = parseCourseOutline('{"lessons":[{"title":"Only lesson"}]}', 'MQTT basics');
    expect(o.title).toBe('MQTT basics');
  });

  it('accepts a single objective given as a string', () => {
    const o = parseCourseOutline('{"title":"T","lessons":[{"title":"L","objectives":"just one"}]}');
    expect(o.lessons[0].objectives).toEqual(['just one']);
  });

  it('throws a friendly error on non-JSON', () => {
    expect(() => parseCourseOutline('I cannot help with that.')).toThrow(/valid JSON/i);
  });

  it('throws when there are no lessons', () => {
    expect(() => parseCourseOutline('{"title":"Empty","lessons":[]}')).toThrow(/without any lessons/i);
  });

  it('throws when every lesson lacks a title', () => {
    expect(() => parseCourseOutline('{"title":"T","lessons":[{"objectives":["x"]}]}')).toThrow(/missing a title/i);
  });
});

// ── parseQuiz ────────────────────────────────────────────────────────────────

describe('parseQuiz', () => {
  it('parses a clean quiz', () => {
    const raw = JSON.stringify({
      questions: [
        { type: 'mc', question: 'Q1', options: ['a', 'b', 'c', 'd'], answerIndex: 2 },
        { type: 'short', question: 'Q2', expected: 'Because.' },
      ],
    });
    const quiz = parseQuiz(raw);
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions[0]).toMatchObject({ type: 'mc', answerIndex: 2 });
    expect(quiz.questions[1]).toMatchObject({ type: 'short', expected: 'Because.' });
  });

  it('parses a bare array wrapped in fences', () => {
    const raw = '```json\n[{"type":"mc","question":"Q","options":["x","y"],"answerIndex":0}]\n```';
    expect(parseQuiz(raw).questions).toHaveLength(1);
  });

  it('resolves letter answers ("C") to indexes', () => {
    const raw = JSON.stringify({
      questions: [{ type: 'mc', question: 'Q', options: ['a', 'b', 'c', 'd'], answer: 'C' }],
    });
    const q = parseQuiz(raw).questions[0];
    expect(q.type === 'mc' && q.answerIndex).toBe(2);
  });

  it('resolves the full text of the correct option', () => {
    const raw = JSON.stringify({
      questions: [{ type: 'mc', question: 'Q', options: ['Faith', 'Works', 'Both'], correct: 'both' }],
    });
    const q = parseQuiz(raw).questions[0];
    expect(q.type === 'mc' && q.answerIndex).toBe(2);
  });

  it('accepts 1-based numeric answers when 0-based is out of shape', () => {
    // options length 3, answer 3 → treated as 1-based → index 2
    const raw = JSON.stringify({
      questions: [{ type: 'mc', question: 'Q', options: ['a', 'b', 'c'], answer: 3 }],
    });
    const q = parseQuiz(raw).questions[0];
    expect(q.type === 'mc' && q.answerIndex).toBe(2);
  });

  it('treats an optionless question as short-answer', () => {
    const raw = JSON.stringify({ questions: [{ question: 'Explain grace.', answer: 'Unmerited favor' }] });
    const q = parseQuiz(raw).questions[0];
    expect(q.type).toBe('short');
    expect(q.type === 'short' && q.expected).toBe('Unmerited favor');
  });

  it('drops MC questions whose answer cannot be resolved', () => {
    const raw = JSON.stringify({
      questions: [
        { type: 'mc', question: 'Bad', options: ['a', 'b'], answer: 'zebra' },
        { type: 'mc', question: 'Good', options: ['a', 'b'], answerIndex: 1 },
      ],
    });
    const quiz = parseQuiz(raw);
    expect(quiz.questions).toHaveLength(1);
    expect(quiz.questions[0].question).toBe('Good');
  });

  it('throws when nothing is usable', () => {
    expect(() => parseQuiz('nope')).toThrow(/valid JSON/i);
    expect(() => parseQuiz('{"questions":[{"options":["a","b"]}]}')).toThrow(/usable/i);
  });
});

// ── computeQuizScore ─────────────────────────────────────────────────────────

const QUIZ: Quiz = {
  questions: [
    { type: 'mc', question: 'q1', options: ['a', 'b'], answerIndex: 0 },
    { type: 'mc', question: 'q2', options: ['a', 'b'], answerIndex: 1 },
    { type: 'mc', question: 'q3', options: ['a', 'b'], answerIndex: 0 },
    { type: 'mc', question: 'q4', options: ['a', 'b'], answerIndex: 1 },
    { type: 'short', question: 'q5' },
  ],
};

describe('computeQuizScore', () => {
  it('scores a perfect run at 100', () => {
    const score = computeQuizScore(QUIZ, [0, 1, 0, 1, 'my answer'], [null, null, null, null, true]);
    expect(score).toBe(100);
  });

  it('scores 3/5 at 60 (pass threshold)', () => {
    const score = computeQuizScore(QUIZ, [0, 1, 1, 0, 'x'], [null, null, null, null, true]);
    expect(score).toBe(60);
  });

  it('excludes an ungraded short answer from the denominator', () => {
    // 4 MC all correct, short answer ungraded (AI unavailable) → 4/4
    const score = computeQuizScore(QUIZ, [0, 1, 0, 1, 'x'], [null, null, null, null, null]);
    expect(score).toBe(100);
  });

  it('counts a wrong short answer against the score', () => {
    const score = computeQuizScore(QUIZ, [0, 1, 0, 1, 'x'], [null, null, null, null, false]);
    expect(score).toBe(80);
  });

  it('returns 0 for an empty quiz', () => {
    expect(computeQuizScore({ questions: [] }, [], [])).toBe(0);
  });

  it('treats unanswered MC as wrong', () => {
    const score = computeQuizScore(QUIZ, [null, null, null, null, 'x'], [null, null, null, null, true]);
    expect(score).toBe(20);
  });
});

// ── parseShortAnswerGrade ────────────────────────────────────────────────────

describe('parseShortAnswerGrade', () => {
  it('parses a clean JSON grade', () => {
    expect(parseShortAnswerGrade('{"correct": true, "feedback": "Well said."}')).toEqual({
      correct: true,
      feedback: 'Well said.',
    });
  });

  it('parses a fenced grade with alternate keys', () => {
    const g = parseShortAnswerGrade('```json\n{"is_correct": false, "explanation": "Not quite."}\n```');
    expect(g).toEqual({ correct: false, feedback: 'Not quite.' });
  });

  it('accepts string booleans', () => {
    expect(parseShortAnswerGrade('{"correct":"yes","feedback":"ok"}')?.correct).toBe(true);
    expect(parseShortAnswerGrade('{"correct":"no"}')?.correct).toBe(false);
  });

  it('falls back to leading yes/no plain text', () => {
    expect(parseShortAnswerGrade('Yes — that captures the heart of it.')?.correct).toBe(true);
    expect(parseShortAnswerGrade('Not quite; James is talking about trials.')?.correct).toBe(false);
  });

  it('returns null when it cannot tell', () => {
    expect(parseShortAnswerGrade('Interesting thoughts on this one!')).toBeNull();
    expect(parseShortAnswerGrade('')).toBeNull();
  });
});
