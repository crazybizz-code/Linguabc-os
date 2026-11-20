"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Flag, Loader2, Maximize, Volume2 } from "lucide-react";
import { AnswerInput } from "@/components/questions/answer-input";
import { blocksOf, isAnswered, type Answers } from "@/lib/questions";
import { cn } from "@/components/ui/primitives";
import { reportFocus, saveExam, startExam, submitExam, type ExamStart } from "../../actions";

/**
 * The IELTS computer-delivered test screen for one module of a mock.
 * Full screen, timed by the server's deadline, autosaving, and locked:
 * leaving full screen or the tab is recorded and covered by a warning.
 * Listening plays each part once, in order, with no pause or rewind,
 * then gives two minutes to check before submitting.
 */
type Phase = "intro" | "loading" | "running" | "done";
const REVIEW_MS = 2 * 60_000;
const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function ExamApp({ sessionId, sessionName, skill, candidate }: { sessionId: string; sessionName: string; skill: "reading" | "listening"; candidate: string }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [exam, setExam] = useState<ExamStart>();
  const [error, setError] = useState<string>();
  const [answers, setAnswers] = useState<Answers>({});
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [part, setPart] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState(0); // server clock - client clock
  const [left, setLeft] = useState(false); // left full screen
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [track, setTrack] = useState(-1); // listening: part being played
  const [needsTap, setNeedsTap] = useState(false);
  const [reviewEnds, setReviewEnds] = useState<number>();
  const [volume, setVolume] = useState(0.9);
  const audio = useRef<HTMLAudioElement>(null);
  const submitting = useRef(false);
  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  const listening = skill === "listening";
  const numbered = useMemo(() => {
    const sections = exam?.sections ?? [];
    return sections.map((s, i) => ({ ...s, start: 1 + sections.slice(0, i).reduce((a, x) => a + x.questions.length, 0) }));
  }, [exam]);
  const allQuestions = numbered.flatMap((s, i) => s.questions.map((q, k) => ({ q, n: s.start + k, part: i })));
  const answered = allQuestions.filter(({ q }) => isAnswered(q, answers[q.id])).length;

  // ---- deadline: the server's, or for listening the end of the review time if sooner
  const serverDeadline = exam ? Date.parse(exam.deadlineAt) - offset : 0;
  const deadline = reviewEnds ? Math.min(serverDeadline, reviewEnds) : serverDeadline;
  const remaining = deadline - now;

  const submit = useCallback(async () => {
    if (!exam || submitting.current) return;
    submitting.current = true;
    setConfirming(false);
    audio.current?.pause();
    const r = await submitExam(exam.attemptId, answersRef.current);
    if (r.error) { setError(r.error); submitting.current = false; return; }
    setPhase("done");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [exam]);

  // ---- clock and auto-submit
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (phase === "running" && exam && remaining <= 0) void submit();
  }, [phase, exam, remaining, submit]);

  // ---- autosave a moment after each change
  useEffect(() => {
    if (phase !== "running" || !exam) return;
    const id = setTimeout(async () => {
      const r = await saveExam(exam.attemptId, answers);
      if (r.error && /time is up|already submitted/i.test(r.error)) void submit();
      setSaved(r.error ? "idle" : "saved");
    }, 1200);
    return () => clearTimeout(id);
  }, [answers, phase, exam, submit]);

  // ---- lockdown: full screen, tab switches, copy and paste
  useEffect(() => {
    if (phase !== "running" || !exam) return;
    const report = () => { void reportFocus(exam.attemptId); };
    const onFull = () => { if (!document.fullscreenElement) { setLeft(true); report(); } else setLeft(false); };
    const onVisible = () => { if (document.hidden) { setLeft(true); report(); } };
    const block = (e: Event) => e.preventDefault();
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    document.addEventListener("fullscreenchange", onFull);
    document.addEventListener("visibilitychange", onVisible);
    for (const ev of ["contextmenu", "copy", "cut", "paste", "dragstart"]) document.addEventListener(ev, block);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("fullscreenchange", onFull);
      document.removeEventListener("visibilitychange", onVisible);
      for (const ev of ["contextmenu", "copy", "cut", "paste", "dragstart"]) document.removeEventListener(ev, block);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [phase, exam]);

  // ---- listening: play each part once, in order
  const playTrack = useCallback(async (i: number, at = 0) => {
    const el = audio.current;
    const src = exam?.sections[i]?.audio;
    if (!el || !src) return;
    setTrack(i);
    setPart(i);
    el.src = src;
    el.volume = volume;
    el.currentTime = at;
    try { await el.play(); setNeedsTap(false); } catch { setNeedsTap(true); }
  }, [exam, volume]);

  const onEnded = () => {
    if (!exam) return;
    const next = track + 1;
    if (next < exam.sections.length && exam.sections[next].audio) setTimeout(() => void playTrack(next), 3000);
    else { setTrack(exam.sections.length); setReviewEnds(Date.now() + REVIEW_MS); }
  };

  // On resume, carry on from where the recording would be now.
  const resumeListening = useCallback(async (x: ExamStart, off: number) => {
    const elapsed = (Date.now() + off - Date.parse(x.startedAt)) / 1000;
    if (elapsed < 5) return playTrack(0);
    const durations = await Promise.all(x.sections.map((s) => new Promise<number>((resolve) => {
      if (!s.audio) return resolve(0);
      const a = new Audio(); a.preload = "metadata"; a.src = s.audio;
      a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => resolve(0);
    })));
    let t = elapsed;
    for (let i = 0; i < durations.length; i++) {
      if (t < durations[i]) return playTrack(i, t);
      t -= durations[i] + 3;
    }
    setTrack(x.sections.length);
    setReviewEnds(Date.parse(x.startedAt) - off + (durations.reduce((a, b) => a + b + 3, 0) * 1000) + REVIEW_MS);
  }, [playTrack]);

  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);

  // ---- start
  const begin = async () => {
    setError(undefined);
    try { await document.documentElement.requestFullscreen(); } catch { /* the overlay asks again */ }
    setPhase("loading");
    const r = await startExam(sessionId, skill);
    if (r.error || !r.exam) { setError(r.error ?? "Could not start the test."); setPhase("intro"); return; }
    const off = Date.parse(r.exam.serverNow) - Date.now();
    setOffset(off);
    setExam(r.exam);
    setAnswers(r.exam.answers ?? {});
    setNow(Date.now());
    setPhase("running");
    if (!document.fullscreenElement) setLeft(true);
    if (r.exam.skill === "listening") void resumeListening(r.exam, off);
  };

  const goTo = (n: number) => {
    const item = allQuestions.find((x) => x.n === n);
    if (!item) return;
    setPart(item.part);
    setTimeout(() => document.getElementById(`q-${n}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  };
  const set = (id: string, v: Answers[string]) => { setSaved("saving"); setAnswers((a) => ({ ...a, [id]: v })); };
  const toggleFlag = (id: string) => setFlags((f) => { const x = new Set(f); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  // ===================================================================== screens
  if (phase === "intro" || phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F2F2] p-4 font-[Arial,Helvetica,sans-serif] text-[#1A1A1A]">
        <div className="w-full max-w-xl border border-[#CCCCCC] bg-white p-8 shadow-sm">
          <p className="text-[13px] text-[#555]">{sessionName}</p>
          <h1 className="mt-1 text-[24px] font-bold">IELTS Academic {listening ? "Listening" : "Reading"}</h1>
          <p className="mt-1 text-[14px]">Candidate: <span className="font-semibold">{candidate}</span></p>
          <ul className="mt-5 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed">
            {listening ? (
              <>
                <li>There are four parts and 40 questions.</li>
                <li>You will hear each part <b>once only</b>. The recording cannot be paused or replayed.</li>
                <li>When the recording ends, you have 2 minutes to check your answers.</li>
                <li>Use headphones and check the volume before you start.</li>
              </>
            ) : (
              <>
                <li>There are three passages and 40 questions.</li>
                <li>You have <b>60 minutes</b>. There is no extra transfer time.</li>
              </>
            )}
            <li>The test runs in full screen. Leaving full screen or switching tabs is recorded and reported to your mentor.</li>
            <li>Your answers are saved as you go and submitted automatically when time runs out.</li>
          </ul>
          {error && <p className="mt-4 border-l-4 border-[#B4483D] bg-[#FBEDEB] px-3 py-2 text-[13.5px] text-[#8C2F25]">{error}</p>}
          <button type="button" onClick={begin} disabled={phase === "loading"}
            className="mt-6 inline-flex h-11 items-center gap-2 bg-[#1A1A1A] px-6 text-[15px] font-semibold text-white hover:bg-black disabled:opacity-60">
            {phase === "loading" && <Loader2 className="h-4 w-4 animate-spin" />} Start test
          </button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F2F2] p-4 font-[Arial,Helvetica,sans-serif]">
        <div className="w-full max-w-md border border-[#CCCCCC] bg-white p-8 text-center">
          <h1 className="text-[22px] font-bold">Your answers have been submitted</h1>
          <p className="mt-2 text-[14px] text-[#444]">Your mentor will send your results once the whole mock has been marked.</p>
          <a href="/student/mocks" className="mt-6 inline-flex h-11 items-center bg-[#1A1A1A] px-6 text-[15px] font-semibold text-white">Back to my mocks</a>
        </div>
      </div>
    );
  }

  const sec = numbered[part];
  const low = remaining < 5 * 60_000;
  return (
    <div className="flex h-screen select-none flex-col bg-white font-[Arial,Helvetica,sans-serif] text-[#1A1A1A]">
      {/* header */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[#BBBBBB] bg-[#2B2B2B] px-4 text-white">
        <div className="min-w-0 text-[13px] leading-tight">
          <p className="truncate font-semibold">{candidate}</p>
          <p className="truncate text-[#BDBDBD]">IELTS Academic {listening ? "Listening" : "Reading"}</p>
        </div>
        <div className={cn("text-center font-semibold tabular-nums", low ? "text-[#FF8A7A]" : "text-white")}>
          <p className="text-[20px] leading-none">{fmt(remaining)}</p>
          <p className="text-[11px] font-normal text-[#BDBDBD]">{reviewEnds ? "checking time left" : "minutes left"}</p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          {listening && (
            <label className="flex items-center gap-1.5"><Volume2 className="h-4 w-4" />
              <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-24 accent-white" />
            </label>
          )}
          <span className="hidden text-[#BDBDBD] sm:inline">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : ""}</span>
        </div>
      </header>

      {/* part banner */}
      <div className="shrink-0 border-b border-[#DDDDDD] bg-[#F4F4F4] px-5 py-2.5 text-[14px]">
        <span className="font-bold">{listening ? `Part ${part + 1}` : `Reading Passage ${part + 1}`}</span>
        <span className="ml-2 text-[#555]">
          {listening
            ? track === part ? "Listen and answer questions" : track > part ? "This part has been played" : "Recording not started yet"
            : "You should spend about 20 minutes on"} {`Questions ${sec.start}–${sec.start + sec.questions.length - 1}`}
        </span>
      </div>

      {/* body */}
      <div className={cn("min-h-0 flex-1", listening ? "overflow-y-auto" : "grid grid-cols-1 md:grid-cols-2")}>
        {!listening && (
          <article className="min-h-0 overflow-y-auto border-r border-[#DDDDDD] px-6 py-5">
            <h2 className="mb-3 text-[18px] font-bold">{sec.title}</h2>
            <div className="whitespace-pre-line text-[15px] leading-[1.7]">{sec.passage}</div>
          </article>
        )}
        <section className={cn("min-h-0 overflow-y-auto px-6 py-5", listening && "mx-auto max-w-3xl")}>
          {blocksOf(sec.questions, sec.groups, sec.start).map((block, bi) => (
            <div key={bi} className="mb-6 space-y-3">
              <p className="text-[14px] font-bold">
                Questions {block.items[0].n}{block.items.length > 1 ? `–${block.items[block.items.length - 1].n}` : ""}
              </p>
              {block.group?.instructions && <p className="text-[14px] italic text-[#333]">{block.group.instructions}</p>}
              {block.items.map(({ q, n }) => (
                <div key={q.id} id={`q-${n}`} className={cn("scroll-mt-24 border-l-4 py-1 pl-3", flags.has(q.id) ? "border-[#E0A100]" : "border-transparent")}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="whitespace-pre-line text-[15px] font-semibold">{n}.{q.type === "gap" ? "" : ` ${q.prompt}`}</p>
                    <button type="button" onClick={() => toggleFlag(q.id)} title="Review this question later"
                      className={cn("flex shrink-0 items-center gap-1 border px-2 py-0.5 text-[11.5px]", flags.has(q.id) ? "border-[#E0A100] bg-[#FFF4D6]" : "border-[#CCCCCC] text-[#666]")}>
                      <Flag className="h-3 w-3" /> Review
                    </button>
                  </div>
                  <div className="select-text">
                    <AnswerInput q={q} groups={sec.groups} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
                  </div>
                </div>
              ))}
            </div>
          ))}
          {listening && track >= numbered.length && (
            <p className="border-l-4 border-[#2B2B2B] bg-[#F4F4F4] px-3 py-2 text-[14px]">The recording has finished. Check your answers; they are submitted when the time runs out.</p>
          )}
        </section>
      </div>

      {/* navigator */}
      <footer className="shrink-0 border-t border-[#BBBBBB] bg-[#F4F4F4] px-3 py-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {numbered.map((s, i) => (
            <div key={s.id} className={cn("flex shrink-0 items-center gap-1 border px-2 py-1", i === part ? "border-[#2B2B2B] bg-white" : "border-transparent")}>
              <button type="button" onClick={() => setPart(i)} className="mr-1 text-[12.5px] font-bold">{listening ? "Part" : "Passage"} {i + 1}</button>
              {s.questions.map((q, k) => {
                const n = s.start + k;
                const done = isAnswered(q, answers[q.id]);
                return (
                  <button key={q.id} type="button" onClick={() => goTo(n)}
                    className={cn("relative h-7 min-w-7 border text-[12px] tabular-nums",
                      done ? "border-[#2B2B2B] bg-[#2B2B2B] text-white" : "border-[#AAAAAA] bg-white text-[#1A1A1A]")}>
                    {n}
                    {flags.has(q.id) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#E0A100]" />}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
            <button type="button" disabled={part === 0} onClick={() => setPart((p) => p - 1)} className="flex h-8 w-8 items-center justify-center border border-[#AAAAAA] bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" disabled={part === numbered.length - 1} onClick={() => setPart((p) => p + 1)} className="flex h-8 w-8 items-center justify-center border border-[#AAAAAA] bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            <button type="button" onClick={() => setConfirming(true)} className="h-8 bg-[#2B2B2B] px-4 text-[13px] font-semibold text-white">Submit</button>
          </div>
        </div>
      </footer>

      {listening && <audio ref={audio} onEnded={onEnded} preload="auto" className="hidden" />}

      {/* overlays */}
      {needsTap && !left && (
        <Overlay>
          <p className="text-[15px]">Your browser needs one click to start the recording.</p>
          <button type="button" onClick={() => { void audio.current?.play().then(() => setNeedsTap(false)).catch(() => {}); }}
            className="mt-4 h-10 bg-[#2B2B2B] px-5 text-[14px] font-semibold text-white">Play recording</button>
        </Overlay>
      )}
      {left && (
        <Overlay>
          <p className="text-[16px] font-bold">You left the test screen</p>
          <p className="mt-1 text-[14px] text-[#444]">This has been recorded. Return to full screen to continue — the timer has not stopped.</p>
          <button type="button" onClick={() => { document.documentElement.requestFullscreen().then(() => setLeft(false)).catch(() => setLeft(false)); }}
            className="mt-4 inline-flex h-10 items-center gap-2 bg-[#2B2B2B] px-5 text-[14px] font-semibold text-white"><Maximize className="h-4 w-4" /> Return to the test</button>
        </Overlay>
      )}
      {confirming && (
        <Overlay>
          <p className="text-[16px] font-bold">Submit your answers?</p>
          <p className="mt-1 text-[14px] text-[#444]">
            You have answered {answered} of {allQuestions.length} questions{flags.size ? `, and ${flags.size} are marked for review` : ""}. You can&apos;t change your answers after submitting.
          </p>
          {error && <p className="mt-2 text-[13px] text-[#B4483D]">{error}</p>}
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="h-10 border border-[#AAAAAA] px-5 text-[14px]">Go back</button>
            <button type="button" onClick={() => void submit()} className="h-10 bg-[#2B2B2B] px-5 text-[14px] font-semibold text-white">Submit</button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md border border-[#BBBBBB] bg-white p-6 text-center">{children}</div>
    </div>
  );
}
