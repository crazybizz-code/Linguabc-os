"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { RotateCcw, Volume2 } from "lucide-react";
import { buttonPrimary, cn } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";

export type VocabWord = {
  word: string;
  pos?: string | null;
  phonetic?: string | null;
  definition?: string | null;
  example?: string | null;
  translation?: string | null;
};

/**
 * Words the learner has finished with, kept on this device between visits.
 * Read through a store so the value is the same on the server and the client.
 */
const listeners = new Set<() => void>();
const EMPTY: string[] = [];
let cache: { key: string; raw: string | null; value: string[] } | null = null;

function read(key: string): string[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY; // storage switched off: the deck still works, it just forgets
  }
  if (!cache || cache.key !== key || cache.raw !== raw) {
    let value: string[] = EMPTY;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) value = parsed.filter((x) => typeof x === "string");
    } catch {
      value = EMPTY;
    }
    cache = { key, raw, value };
  }
  return cache.value;
}

function write(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // nothing to do: progress simply isn't remembered
  }
  cache = null;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useKnown(deckId: string) {
  const key = `linguabc.vocab.${deckId}`;
  const known = useSyncExternalStore(subscribe, () => read(key), () => EMPTY);
  return [known, (next: string[]) => write(key, next), () => write(key, [])] as const;
}

/**
 * The words from the text, as cards to flip and work through. Vocabulary is
 * the part of a lesson that needs repeating, so the deck remembers what the
 * learner has already got and starts with the rest.
 */
export function CueCards({ deckId, words }: { deckId: string; words: VocabWord[] }) {
  const t = useT();
  const [known, setKnown, reset] = useKnown(deckId);
  const [queue, setQueue] = useState<string[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [started, setStarted] = useState(false);

  const byWord = useMemo(() => new Map(words.map((w) => [w.word, w])), [words]);
  const left = words.filter((w) => !known.includes(w.word));

  const begin = () => {
    setQueue(left.map((w) => w.word));
    setFlipped(false);
    setStarted(true);
  };
  const current = queue.length > 0 ? byWord.get(queue[0]) : undefined;

  const next = (gotIt: boolean) => {
    const [head, ...rest] = queue;
    setFlipped(false);
    if (gotIt) {
      setKnown([...known, head]);
      setQueue(rest);
    } else {
      setQueue([...rest, head]);
    }
  };

  const say = (text: string) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-GB";
      window.speechSynthesis.speak(u);
    } catch {
      // no speech support on this device
    }
  };

  if (words.length === 0) return null;

  if (!started || !current) {
    const done = left.length === 0;
    return (
      <div className="py-2 text-center">
        <p className="text-[13px] text-muted-foreground">
          {done
            ? t("You have been through all {n} words.", { n: words.length })
            : t("{n} words from this text, ready to review.", { n: left.length })}
        </p>
        <div className="mt-3 flex justify-center gap-2">
          {!done && (
            <button type="button" onClick={begin} className={buttonPrimary}>
              {known.length > 0 ? t("Continue reviewing") : t("Start reviewing")}
            </button>
          )}
          {known.length > 0 && (
            <button type="button" onClick={() => { reset(); setStarted(false); }}
              className="flex h-10 items-center gap-1.5 rounded-[11px] border border-border/80 px-3.5 text-[13px] font-medium">
              <RotateCcw className="h-3.5 w-3.5" /> {t("Start over")}
            </button>
          )}
        </div>
      </div>
    );
  }

  const total = words.length;
  const position = Math.min(total - queue.length + 1, total);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span>{t("{a} of {b}", { a: position, b: total })}</span>
        <button type="button" onClick={() => setStarted(false)} className="underline">{t("Pause")}</button>
      </div>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className={cn(
          "flex min-h-[190px] w-full flex-col items-center justify-center rounded-[18px] border px-5 py-6 text-center transition-colors",
          flipped ? "border-[#12392B]/30 bg-[#E7EFE4]/50" : "border-border/70 bg-white/70",
        )}
      >
        {flipped ? (
          <>
            <p className="text-[15px] font-medium leading-snug">{current.definition}</p>
            {current.translation && <p className="mt-2 text-[14px] text-[#12392B]">{current.translation}</p>}
            {current.example && <p className="mt-3 text-[13px] italic leading-relaxed text-muted-foreground">“{current.example}”</p>}
          </>
        ) : (
          <>
            <p className="text-[24px] font-semibold tracking-[-0.02em]">{current.word}</p>
            {current.phonetic && <p className="mt-1 text-[13px] text-muted-foreground">{current.phonetic}</p>}
            {current.pos && <p className="mt-2 text-[11px] uppercase tracking-[0.08em] text-[#5F6B66]">{current.pos}</p>}
            <p className="mt-4 text-[11.5px] text-muted-foreground">{t("Tap to see the meaning")}</p>
          </>
        )}
      </button>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => say(current.word)} aria-label={t("Hear the word")}
          className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-border/80 text-[#3B4A42]">
          <Volume2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => next(false)}
          className="h-10 flex-1 rounded-[11px] border border-border/80 text-[13px] font-medium">
          {t("Again")}
        </button>
        <button type="button" onClick={() => next(true)} className={cn(buttonPrimary, "flex-1 justify-center")}>
          {t("Got it")}
        </button>
      </div>
    </div>
  );
}
