"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type AudioJobState = {
  status: "queued" | "processing" | "completed" | "failed" | "needs_review";
  progress: number;
  segments_done: number;
  segments_total: number | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
};

const FIELDS = "status, progress, segments_done, segments_total, error, attempts, max_attempts";
const FINISHED = new Set(["completed", "failed", "needs_review"]);

/**
 * Follows an audio job live: Supabase Realtime (audio_jobs is in the
 * supabase_realtime publication, and RLS limits rows to whoever may see the
 * job), with a 5-second poll as a fallback while the job is running.
 */
export function useAudioJob(jobId: string | undefined, nonce = 0): AudioJobState | null {
  const [job, setJob] = useState<{ id: string; state: AudioJobState } | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const supabase = createClient();
    let alive = true;
    let done = false;
    const load = async () => {
      if (done) return;
      const { data } = await supabase.from("audio_jobs").select(FIELDS).eq("id", jobId).maybeSingle();
      if (!alive || !data) return;
      setJob({ id: jobId, state: data as AudioJobState });
      done = FINISHED.has(data.status);
    };
    void load();
    const channel = supabase.channel(`audio-job-${jobId}-${nonce}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "audio_jobs", filter: `id=eq.${jobId}` }, (payload) => {
        const row = payload.new as AudioJobState;
        if (!alive) return;
        setJob({ id: jobId, state: row });
        done = FINISHED.has(row.status);
      })
      .subscribe();
    const poll = setInterval(() => { void load(); }, 5000);
    return () => { alive = false; clearInterval(poll); void supabase.removeChannel(channel); };
  }, [jobId, nonce]);
  return jobId && job?.id === jobId ? job.state : null;
}
