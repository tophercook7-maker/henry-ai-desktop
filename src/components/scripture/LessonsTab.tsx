/**
 * LessonsTab — Henry as teacher, inside the Scripture panel.
 *
 * Two kinds of courses share one machinery:
 *   ✝  'bible'   — theologically careful, KJV/WEB-quoting Bible courses
 *   🎓 'general' — "Teach me anything" (MQTT, biblical Greek, gardening…)
 *
 * Flow: pick a topic + depth + lesson count → Henry generates a JSON syllabus
 * (parsed defensively in lessonParse.ts; the course row is only created after
 * the outline parses, so failures leave no orphans) → lesson 1 unlocks →
 * opening a lesson generates + caches its markdown → "Mark complete" or a
 * passing quiz (≥60%) unlocks the next lesson. Quiz attempts persist to
 * lesson_reviews.
 *
 * All storage goes through the lessons:* IPC (electron/ipc/lessons.ts); all
 * AI calls go through callHenryAI — the same BYOK/Ollama/proxy front door the
 * rest of the panel uses, so "no provider configured" gets the standard
 * friendly pointer.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { callHenryAI, NoBackendAvailableError } from '../../henry/henryAI';
import { confirmDialog } from '../ui/Toast';
import {
  computeQuizScore,
  parseCourseOutline,
  parseQuiz,
  parseShortAnswerGrade,
  type CourseOutline,
  type Quiz,
  type QuizAnswer,
} from './lessonParse';
import {
  buildLessonPrompt,
  buildOutlinePrompt,
  buildQuizPrompt,
  buildShortGradePrompt,
  teacherSystemPrompt,
  type CourseDepth,
  type CourseKind,
} from './lessonPrompts';

const getApi = () => window.henryAPI;

const PASS_SCORE = 60;
const PREFERRED_MODEL = 'llama-3.3-70b-versatile';

const inp =
  'bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-all';

// ── Small helpers ───────────────────────────────────────────────────────────

function aiErrorMessage(e: unknown): string {
  if (e instanceof NoBackendAvailableError) return e.userFacingMessage;
  return e instanceof Error ? e.message : String(e);
}

function outlineOf(course: HenryLessonCourse | null): CourseOutline | null {
  if (!course) return null;
  try {
    const o = JSON.parse(course.outline_json) as CourseOutline;
    return o && Array.isArray(o.lessons) ? o : null;
  } catch {
    return null;
  }
}

function kindBadge(kind: string) {
  return kind === 'bible' ? (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-henry-accent/10 border border-henry-accent/30 text-henry-accent">✝ Bible</span>
  ) : (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-henry-surface2 border border-henry-border/30 text-henry-text-muted">🎓 General</span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-henry-surface2 overflow-hidden">
        <div className="h-full rounded-full bg-henry-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-henry-text-muted flex-shrink-0">{done}/{total}</span>
    </div>
  );
}

// ── Tiny markdown renderer (no innerHTML, no new deps) ──────────────────────

function inlineMd(text: string): React.ReactNode[] {
  // Split on **bold**, *italic*, `code` — rendered as React nodes, never HTML.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} className="bg-henry-surface2 px-1 rounded text-xs font-mono">{p.slice(1, -1)}</code>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function LessonMarkdown({ content }: { content: string }) {
  const lines = content.replace(/```[a-z]*\n?/g, '').split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const t = line.trimEnd();
        if (!t.trim()) return <div key={i} className="h-1.5" />;
        if (t.startsWith('### ')) return <h4 key={i} className="text-sm font-bold text-henry-text mt-3">{inlineMd(t.slice(4))}</h4>;
        if (t.startsWith('## ')) return <h3 key={i} className="text-base font-bold text-henry-accent mt-4">{inlineMd(t.slice(3))}</h3>;
        if (t.startsWith('# ')) return <h2 key={i} className="text-lg font-bold text-henry-text mt-1">{inlineMd(t.slice(2))}</h2>;
        if (t.startsWith('> '))
          return (
            <blockquote key={i} className="border-l-2 border-henry-accent/50 pl-3 text-henry-text italic text-sm leading-relaxed">
              {inlineMd(t.slice(2))}
            </blockquote>
          );
        if (/^[-*•]\s/.test(t))
          return (
            <div key={i} className="flex gap-2 text-sm text-henry-text leading-relaxed">
              <span className="text-henry-accent flex-shrink-0">•</span>
              <span>{inlineMd(t.replace(/^[-*•]\s/, ''))}</span>
            </div>
          );
        if (/^\d+\.\s/.test(t)) return <div key={i} className="text-sm text-henry-text leading-relaxed ml-1">{inlineMd(t)}</div>;
        if (/^(---|\*\*\*)$/.test(t.trim())) return <hr key={i} className="border-henry-border/20 my-2" />;
        return <p key={i} className="text-sm text-henry-text leading-relaxed">{inlineMd(t)}</p>;
      })}
    </div>
  );
}

// ── New course form ─────────────────────────────────────────────────────────

const BIBLE_SUGGESTIONS = ['The book of James', 'The Sermon on the Mount', 'The life of David', 'Biblical Greek basics', 'The Psalms of trust', 'Romans, step by step'];
const GENERAL_SUGGESTIONS = ['How MQTT works', 'Personal finance basics', 'How 3D printers work', 'Marketing a local business', 'Church history overview', 'How LLMs work'];

function NewCourseForm({ initialKind, onCreated, onCancel }: {
  initialKind: CourseKind;
  onCreated: (courseId: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<CourseKind>(initialKind);
  const [topic, setTopic] = useState('');
  const [depth, setDepth] = useState<CourseDepth>('intro');
  const [lessonCount, setLessonCount] = useState<number>(5);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const t = topic.trim();
    if (!t || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const raw = await callHenryAI({
        messages: [
          { role: 'system', content: teacherSystemPrompt(kind) },
          { role: 'user', content: buildOutlinePrompt({ topic: t, kind, depth, lessonCount }) },
        ],
        maxTokens: 2000,
        temperature: 0.6,
        preferredModel: PREFERRED_MODEL,
        signal: AbortSignal.timeout(120_000),
      });
      // Parse BEFORE touching the database — a bad outline creates no rows.
      const outline = parseCourseOutline(raw || '', t);
      const res = await getApi()?.lessonsCourseCreate?.({
        title: outline.title,
        topic: t,
        kind,
        // depth rides along in outline_json so lesson generation can match it
        outline_json: JSON.stringify({ ...outline, depth }),
        lessons: outline.lessons.map((l) => ({ title: l.title })),
      });
      if (!res?.ok || !res.result) throw new Error((res && !res.ok ? res.error : '') || 'Could not save the course.');
      onCreated(res.result.course.id);
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      setGenerating(false);
    }
  }

  const suggestions = kind === 'bible' ? BIBLE_SUGGESTIONS : GENERAL_SUGGESTIONS;

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="text-henry-text-muted hover:text-henry-accent text-xs font-medium transition-all">← Courses</button>
        <h2 className="text-base font-bold text-henry-text">{kind === 'bible' ? '✝ New Bible course' : '🎓 Teach me anything'}</h2>
      </div>

      {/* Kind toggle */}
      <div className="inline-flex rounded-xl border border-henry-border/30 bg-henry-surface p-0.5">
        {(['bible', 'general'] as CourseKind[]).map((k) => (
          <button key={k} onClick={() => setKind(k)}
            className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all ${kind === k ? 'bg-henry-accent text-white' : 'text-henry-text-muted hover:text-henry-text'}`}>
            {k === 'bible' ? '✝ Bible' : '🎓 Anything'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] uppercase tracking-wider text-henry-text-muted block">What should Henry teach you?</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void generate(); }}
          placeholder={kind === 'bible' ? 'e.g. The book of James' : 'e.g. How MQTT works'}
          className={inp + ' w-full'}
          autoFocus
        />
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => setTopic(s)}
              className="text-[11px] px-2.5 py-1 rounded-full bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/40 transition-all">
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-henry-text-muted block">Depth</label>
          <div className="inline-flex rounded-xl border border-henry-border/30 bg-henry-surface p-0.5 w-full">
            {(['intro', 'deep-dive'] as CourseDepth[]).map((d) => (
              <button key={d} onClick={() => setDepth(d)}
                className={`flex-1 text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all ${depth === d ? 'bg-henry-accent text-white' : 'text-henry-text-muted hover:text-henry-text'}`}>
                {d === 'intro' ? 'Intro' : 'Deep dive'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-henry-text-muted block">Lessons</label>
          <div className="inline-flex rounded-xl border border-henry-border/30 bg-henry-surface p-0.5 w-full">
            {[5, 10, 20].map((n) => (
              <button key={n} onClick={() => setLessonCount(n)}
                className={`flex-1 text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all ${lessonCount === n ? 'bg-henry-accent text-white' : 'text-henry-text-muted hover:text-henry-text'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-400/10 border border-red-400/20 rounded-xl p-3 space-y-2">
          <p className="text-red-400 text-xs leading-relaxed whitespace-pre-wrap">{error}</p>
          <button onClick={() => void generate()} className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
            ↻ Try again
          </button>
        </div>
      )}

      <button
        onClick={() => void generate()}
        disabled={!topic.trim() || generating}
        className="w-full py-3 rounded-xl bg-henry-accent text-white text-sm font-bold hover:bg-henry-accent/80 disabled:opacity-40 transition-all"
      >
        {generating ? 'Henry is building your course…' : '✦ Build my course'}
      </button>
      {generating && <p className="text-[11px] text-henry-text-muted text-center animate-pulse">Designing {lessonCount} lessons on “{topic.trim()}”…</p>}
    </div>
  );
}

// ── Quiz view ───────────────────────────────────────────────────────────────

interface QuizResult {
  score: number;
  passed: boolean;
  mcResults: Array<boolean | null>; // per-question: true/false for MC, null for short
  shortFeedback: string | null;
  shortCorrect: boolean | null;
}

function QuizSection({ lesson, kind, onLessonChanged }: {
  lesson: HenryLesson;
  kind: CourseKind;
  onLessonChanged: (lesson: HenryLesson, unlocked: HenryLesson | null) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'generating' | 'answering' | 'grading' | 'done'>('idle');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<QuizAnswer[]>([]);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateQuiz() {
    setPhase('generating');
    setError(null);
    setResult(null);
    try {
      const raw = await callHenryAI({
        messages: [
          { role: 'system', content: teacherSystemPrompt(kind) },
          { role: 'user', content: buildQuizPrompt({ kind, lessonTitle: lesson.title, lessonContent: lesson.content_md || '' }) },
        ],
        maxTokens: 1200,
        temperature: 0.3,
        preferredModel: PREFERRED_MODEL,
        signal: AbortSignal.timeout(120_000),
      });
      const q = parseQuiz(raw || '');
      setQuiz(q);
      setAnswers(q.questions.map(() => null));
      setPhase('answering');
    } catch (e) {
      setError(aiErrorMessage(e));
      setPhase('idle');
    }
  }

  async function submit() {
    if (!quiz) return;
    setPhase('grading');
    setError(null);
    try {
      // Grade MC locally; grade the short answer with one AI call.
      const shortGrades: Array<boolean | null> = quiz.questions.map(() => null);
      const mcResults: Array<boolean | null> = quiz.questions.map((q, i) =>
        q.type === 'mc' ? answers[i] === q.answerIndex : null,
      );
      let shortFeedback: string | null = null;
      let shortCorrect: boolean | null = null;

      const shortIdx = quiz.questions.findIndex((q) => q.type === 'short');
      if (shortIdx >= 0) {
        const q = quiz.questions[shortIdx];
        const answer = String(answers[shortIdx] ?? '').trim();
        if (answer && q.type === 'short') {
          try {
            const raw = await callHenryAI({
              messages: [
                { role: 'system', content: teacherSystemPrompt(kind) },
                { role: 'user', content: buildShortGradePrompt({ question: q.question, expected: q.expected, answer }) },
              ],
              maxTokens: 300,
              temperature: 0,
              preferredModel: PREFERRED_MODEL,
              signal: AbortSignal.timeout(60_000),
            });
            const grade = parseShortAnswerGrade(raw || '');
            if (grade) {
              shortGrades[shortIdx] = grade.correct;
              shortCorrect = grade.correct;
              shortFeedback = grade.feedback || null;
            }
          } catch {
            // AI grading unavailable — the short answer is excluded from the
            // denominator (computeQuizScore) rather than counted against you.
            shortFeedback = 'Henry couldn\'t grade your written answer this time — it wasn\'t counted either way.';
          }
        } else {
          // Left blank counts as wrong.
          shortGrades[shortIdx] = false;
          shortCorrect = false;
        }
      }

      const score = computeQuizScore(quiz, answers, shortGrades);
      const res = await getApi()?.lessonsReviewSave?.({
        lesson_id: lesson.id,
        quiz_json: JSON.stringify(quiz),
        answers_json: JSON.stringify(answers),
        score,
      });
      if (!res?.ok || !res.result) throw new Error((res && !res.ok ? res.error : '') || 'Could not save your quiz attempt.');

      setResult({ score, passed: res.result.passed, mcResults, shortFeedback, shortCorrect });
      setPhase('done');
      onLessonChanged(res.result.lesson, res.result.unlocked);
    } catch (e) {
      setError(aiErrorMessage(e));
      setPhase('answering');
    }
  }

  const allAnswered = quiz
    ? quiz.questions.every((q, i) => (q.type === 'mc' ? typeof answers[i] === 'number' : String(answers[i] ?? '').trim().length > 0))
    : false;

  if (phase === 'idle') {
    return (
      <div className="space-y-2">
        {error && (
          <div className="bg-red-400/10 border border-red-400/20 rounded-xl p-3">
            <p className="text-red-400 text-xs leading-relaxed whitespace-pre-wrap">{error}</p>
          </div>
        )}
        <button onClick={() => void generateQuiz()}
          className="w-full py-2.5 rounded-xl bg-henry-accent/10 border border-henry-accent/30 text-henry-accent text-sm font-semibold hover:bg-henry-accent/20 transition-all">
          {error ? '↻ Retry quiz' : '🎯 Check my understanding'}
        </button>
      </div>
    );
  }

  if (phase === 'generating') {
    return <p className="text-henry-text-muted text-sm animate-pulse py-2">Henry is writing your quiz…</p>;
  }

  if (!quiz) return null;

  return (
    <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-5 space-y-5">
      <p className="text-[11px] uppercase tracking-wider text-henry-accent font-semibold">Check my understanding</p>

      {quiz.questions.map((q, i) => {
        const graded = phase === 'done' ? result : null;
        const mcVerdict = graded ? graded.mcResults[i] : null;
        return (
          <div key={i} className="space-y-2">
            <p className="text-sm text-henry-text font-medium">
              {i + 1}. {q.question}
              {graded && q.type === 'mc' && (
                <span className={`ml-2 text-xs font-bold ${mcVerdict ? 'text-green-400' : 'text-red-400'}`}>{mcVerdict ? '✓' : '✕'}</span>
              )}
              {graded && q.type === 'short' && graded.shortCorrect !== null && (
                <span className={`ml-2 text-xs font-bold ${graded.shortCorrect ? 'text-green-400' : 'text-red-400'}`}>{graded.shortCorrect ? '✓' : '✕'}</span>
              )}
            </p>
            {q.type === 'mc' ? (
              <div className="space-y-1">
                {q.options.map((opt, oi) => {
                  const selected = answers[i] === oi;
                  const showCorrect = phase === 'done' && oi === q.answerIndex;
                  const showWrong = phase === 'done' && selected && oi !== q.answerIndex;
                  return (
                    <button
                      key={oi}
                      disabled={phase !== 'answering'}
                      onClick={() => setAnswers((a) => a.map((v, ai) => (ai === i ? oi : v)))}
                      className={`w-full text-left text-[13px] px-3 py-2 rounded-xl border transition-all ${
                        showCorrect
                          ? 'border-green-400/50 bg-green-400/10 text-green-300'
                          : showWrong
                            ? 'border-red-400/50 bg-red-400/10 text-red-300'
                            : selected
                              ? 'border-henry-accent/60 bg-henry-accent/10 text-henry-text'
                              : 'border-henry-border/25 bg-henry-bg text-henry-text-muted hover:text-henry-text hover:border-henry-accent/30'
                      }`}
                    >
                      <span className="font-mono text-[11px] mr-2">{String.fromCharCode(65 + oi)}.</span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1.5">
                <textarea
                  value={String(answers[i] ?? '')}
                  disabled={phase !== 'answering'}
                  onChange={(e) => setAnswers((a) => a.map((v, ai) => (ai === i ? e.target.value : v)))}
                  rows={3}
                  placeholder="Answer in your own words…"
                  className={inp + ' w-full resize-none text-[13px]'}
                />
                {phase === 'done' && result?.shortFeedback && (
                  <p className="text-xs text-henry-text-muted leading-relaxed border-l-2 border-henry-accent/40 pl-2">{result.shortFeedback}</p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <div className="bg-red-400/10 border border-red-400/20 rounded-xl p-3">
          <p className="text-red-400 text-xs leading-relaxed whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {phase === 'answering' && (
        <button onClick={() => void submit()} disabled={!allAnswered}
          className="w-full py-2.5 rounded-xl bg-henry-accent text-white text-sm font-bold hover:bg-henry-accent/80 disabled:opacity-40 transition-all">
          Submit answers
        </button>
      )}
      {phase === 'grading' && <p className="text-henry-text-muted text-sm animate-pulse">Henry is grading…</p>}
      {phase === 'done' && result && (
        <div className={`rounded-xl p-4 text-center space-y-1 border ${result.passed ? 'bg-green-400/10 border-green-400/25' : 'bg-amber-400/10 border-amber-400/25'}`}>
          <p className={`text-2xl font-bold ${result.passed ? 'text-green-400' : 'text-amber-400'}`}>{result.score}%</p>
          <p className="text-xs text-henry-text-muted">
            {result.passed
              ? 'Passed — lesson complete. The next lesson is unlocked. 🎉'
              : `You need ${PASS_SCORE}% to complete the lesson. Review the lesson and try again — you've got this.`}
          </p>
          {!result.passed && (
            <button onClick={() => void generateQuiz()}
              className="text-[11px] mt-1 px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
              ↻ Take a fresh quiz
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lesson view ─────────────────────────────────────────────────────────────

function LessonView({ course, outline, lesson, allLessons, onBack, onLessonChanged }: {
  course: HenryLessonCourse;
  outline: CourseOutline | null;
  lesson: HenryLesson;
  allLessons: HenryLesson[];
  onBack: () => void;
  onLessonChanged: (lesson: HenryLesson, unlocked: HenryLesson | null) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const generatingRef = useRef(false);

  const kind = (course.kind === 'bible' ? 'bible' : 'general') as CourseKind;

  const generateContent = useCallback(async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setGenError(null);
    try {
      const outlineLesson = outline?.lessons?.[lesson.idx];
      const depth: CourseDepth =
        (outline as (CourseOutline & { depth?: CourseDepth }) | null)?.depth === 'deep-dive' ? 'deep-dive' : 'intro';
      const raw = await callHenryAI({
        messages: [
          { role: 'system', content: teacherSystemPrompt(kind) },
          {
            role: 'user',
            content: buildLessonPrompt({
              courseTitle: course.title,
              topic: course.topic,
              kind,
              depth,
              lessonTitle: lesson.title,
              lessonNumber: lesson.idx + 1,
              lessonTotal: allLessons.length,
              objectives: outlineLesson?.objectives ?? [],
              scriptureRefs: outlineLesson?.scriptureRefs,
              priorLessonTitles: allLessons.filter((l) => l.idx < lesson.idx).map((l) => l.title),
            }),
          },
        ],
        maxTokens: 2500,
        temperature: 0.6,
        preferredModel: PREFERRED_MODEL,
        signal: AbortSignal.timeout(180_000),
      });
      const content = (raw || '').trim();
      if (!content) throw new Error('Henry sent back an empty lesson. Try again.');
      const res = await getApi()?.lessonsLessonSaveContent?.({ id: lesson.id, content_md: content });
      if (!res?.ok || !res.result) throw new Error((res && !res.ok ? res.error : '') || 'Could not save the lesson.');
      onLessonChanged(res.result, null);
    } catch (e) {
      setGenError(aiErrorMessage(e));
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [course, outline, lesson.id, lesson.idx, lesson.title, allLessons, kind, onLessonChanged]);

  // First open: generate + cache lesson content.
  useEffect(() => {
    if (!lesson.content_md && !generatingRef.current) void generateContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  async function markComplete() {
    const res = await getApi()?.lessonsLessonUpdateStatus?.({ id: lesson.id, status: 'completed' });
    if (res?.ok && res.result) onLessonChanged(res.result.lesson, res.result.unlocked);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-henry-text-muted hover:text-henry-accent text-xs font-medium transition-all flex-shrink-0">← {course.title}</button>
        <span className="text-[10px] text-henry-text-muted">Lesson {lesson.idx + 1} of {allLessons.length}</span>
        {lesson.status === 'completed' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-400/10 border border-green-400/25 text-green-400">
            ✓ Completed{typeof lesson.score === 'number' ? ` · ${Math.round(lesson.score)}%` : ''}
          </span>
        )}
      </div>

      {generating && (
        <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-6 text-center space-y-2">
          <div className="text-3xl animate-pulse">{kind === 'bible' ? '✝' : '🎓'}</div>
          <p className="text-henry-accent text-sm font-semibold animate-pulse">Henry is preparing “{lesson.title}”…</p>
          <p className="text-henry-text-muted text-xs">Writing the teaching, gathering {kind === 'bible' ? 'scriptures' : 'examples'}, shaping reflection questions.</p>
        </div>
      )}

      {genError && !generating && (
        <div className="bg-red-400/10 border border-red-400/20 rounded-xl p-4 space-y-2">
          <p className="text-red-400 text-xs leading-relaxed whitespace-pre-wrap">{genError}</p>
          <button onClick={() => void generateContent()}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
            ↻ Try again
          </button>
        </div>
      )}

      {lesson.content_md && !generating && (
        <>
          <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-5">
            <LessonMarkdown content={lesson.content_md} />
          </div>

          <QuizSection key={lesson.id} lesson={lesson} kind={kind} onLessonChanged={onLessonChanged} />

          {lesson.status !== 'completed' && (
            <button onClick={() => void markComplete()}
              className="w-full py-2.5 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text hover:border-henry-accent/30 transition-all">
              ✓ Mark complete (skip the quiz)
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Course view ─────────────────────────────────────────────────────────────

const STATUS_META: Record<HenryLesson['status'], { icon: string; label: string }> = {
  locked: { icon: '🔒', label: 'Locked' },
  available: { icon: '○', label: 'Ready' },
  in_progress: { icon: '◐', label: 'In progress' },
  completed: { icon: '✓', label: 'Completed' },
};

function CourseView({ course, lessons, onBack, onOpenLesson }: {
  course: HenryLessonCourse;
  lessons: HenryLesson[];
  onBack: () => void;
  onOpenLesson: (l: HenryLesson) => void;
}) {
  const outline = outlineOf(course);
  const done = lessons.filter((l) => l.status === 'completed').length;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-henry-text-muted hover:text-henry-accent text-xs font-medium transition-all">← Courses</button>
        {kindBadge(course.kind)}
      </div>
      <div>
        <h2 className="text-lg font-bold text-henry-text">{course.title}</h2>
        {outline?.description && <p className="text-henry-text-muted text-xs mt-1 leading-relaxed">{outline.description}</p>}
        <div className="mt-3"><ProgressBar done={done} total={lessons.length} /></div>
      </div>

      <div className="space-y-1.5">
        {lessons.map((l) => {
          const meta = STATUS_META[l.status];
          const locked = l.status === 'locked';
          return (
            <button
              key={l.id}
              disabled={locked}
              onClick={() => onOpenLesson(l)}
              className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                locked
                  ? 'border-henry-border/15 bg-henry-surface/40 opacity-50 cursor-not-allowed'
                  : l.status === 'completed'
                    ? 'border-green-400/20 bg-henry-surface hover:border-green-400/40'
                    : 'border-henry-border/25 bg-henry-surface hover:border-henry-accent/40'
              }`}
            >
              <span className={`text-sm w-5 text-center flex-shrink-0 ${l.status === 'completed' ? 'text-green-400' : 'text-henry-text-muted'}`}>{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-henry-text font-medium truncate">{l.idx + 1}. {l.title}</p>
                <p className="text-[10px] text-henry-text-muted">
                  {meta.label}
                  {l.status === 'completed' && typeof l.score === 'number' ? ` · ${Math.round(l.score)}%` : ''}
                </p>
              </div>
              {!locked && <span className="text-henry-text-muted text-xs flex-shrink-0">→</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Root: LessonsTab ────────────────────────────────────────────────────────

type View =
  | { t: 'courses' }
  | { t: 'new'; kind: CourseKind }
  | { t: 'course'; id: string }
  | { t: 'lesson'; courseId: string; lessonId: string };

export default function LessonsTab() {
  const [view, setView] = useState<View>({ t: 'courses' });
  const [courses, setCourses] = useState<HenryLessonCourse[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<{ course: HenryLessonCourse; lessons: HenryLesson[] } | null>(null);

  const loadCourses = useCallback(async () => {
    try {
      const res = await getApi()?.lessonsCoursesList?.();
      if (res?.ok && res.result) setCourses(res.result);
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void loadCourses(); }, [loadCourses]);

  const openCourse = useCallback(async (id: string) => {
    try {
      const res = await getApi()?.lessonsCourseGet?.(id);
      if (res?.ok && res.result) {
        setActive(res.result);
        setView({ t: 'course', id });
        return;
      }
    } catch { /* ignore */ }
    setView({ t: 'courses' });
  }, []);

  async function deleteCourse(c: HenryLessonCourse) {
    const ok = await confirmDialog(`Delete “${c.title}” and all its lessons and quiz history?`, { destructive: true });
    if (!ok) return;
    await getApi()?.lessonsCourseDelete?.(c.id);
    void loadCourses();
  }

  /** Merge a changed lesson (and any newly unlocked one) into the active course. */
  function handleLessonChanged(changed: HenryLesson, unlocked: HenryLesson | null) {
    setActive((prev) => {
      if (!prev) return prev;
      const lessons = prev.lessons.map((l) =>
        l.id === changed.id ? changed : unlocked && l.id === unlocked.id ? unlocked : l,
      );
      return { ...prev, lessons };
    });
    void loadCourses(); // keep list progress counts fresh
  }

  // ── Render ──
  if (view.t === 'new') {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <NewCourseForm
          initialKind={view.kind}
          onCancel={() => setView({ t: 'courses' })}
          onCreated={(id) => { void loadCourses(); void openCourse(id); }}
        />
      </div>
    );
  }

  if (view.t === 'course' && active) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <CourseView
          course={active.course}
          lessons={active.lessons}
          onBack={() => { setView({ t: 'courses' }); void loadCourses(); }}
          onOpenLesson={(l) => setView({ t: 'lesson', courseId: active.course.id, lessonId: l.id })}
        />
      </div>
    );
  }

  if (view.t === 'lesson' && active) {
    const lesson = active.lessons.find((l) => l.id === view.lessonId);
    if (lesson) {
      return (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <LessonView
            course={active.course}
            outline={outlineOf(active.course)}
            lesson={lesson}
            allLessons={active.lessons}
            onBack={() => setView({ t: 'course', id: active.course.id })}
            onLessonChanged={handleLessonChanged}
          />
        </div>
      );
    }
  }

  // Courses home
  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Entry points */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setView({ t: 'new', kind: 'bible' })}
          className="p-4 rounded-2xl bg-henry-accent/8 border border-henry-accent/25 text-left hover:bg-henry-accent/15 transition-all">
          <p className="text-xl mb-1">✝</p>
          <p className="text-sm font-bold text-henry-text">New Bible course</p>
          <p className="text-[11px] text-henry-text-muted mt-0.5 leading-snug">A book, a theme, a character — Henry teaches it lesson by lesson, scripture-first.</p>
        </button>
        <button onClick={() => setView({ t: 'new', kind: 'general' })}
          className="p-4 rounded-2xl bg-henry-surface border border-henry-border/25 text-left hover:border-henry-accent/40 transition-all">
          <p className="text-xl mb-1">🎓</p>
          <p className="text-sm font-bold text-henry-text">Teach me anything</p>
          <p className="text-[11px] text-henry-text-muted mt-0.5 leading-snug">Any topic at all — Henry builds a full course with lessons and quizzes.</p>
        </button>
      </div>

      {/* Course list */}
      {loaded && courses.length === 0 && (
        <div className="text-center py-10">
          <p className="text-3xl mb-3">📚</p>
          <p className="text-henry-text-muted text-sm">No courses yet.</p>
          <p className="text-henry-text-muted text-xs mt-1">Pick one of the buttons above and Henry will build your first course.</p>
        </div>
      )}
      {courses.map((c) => {
        const total = Number(c.lesson_count ?? 0);
        const done = Number(c.completed_count ?? 0);
        return (
          <div key={c.id} className="group bg-henry-surface rounded-2xl border border-henry-border/20 p-4 hover:border-henry-accent/30 transition-all cursor-pointer"
            onClick={() => void openCourse(c.id)}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-henry-text truncate">{c.title}</p>
                  {kindBadge(c.kind)}
                </div>
                <p className="text-[11px] text-henry-text-muted mt-0.5 truncate">{c.topic}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); void deleteCourse(c); }}
                className="text-[10px] px-2 py-1 rounded text-henry-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all flex-shrink-0">
                ✕
              </button>
            </div>
            <div className="mt-3"><ProgressBar done={done} total={total} /></div>
          </div>
        );
      })}
    </div>
  );
}
