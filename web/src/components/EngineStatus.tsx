"use client";

import { useEffect, useState } from "react";

type Status =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; solver: string; summary: Record<string, string | number> };

const LABELS: [string, string][] = [
  ["sessions", "Sessions"],
  ["teaching_hours", "Teaching hours"],
  ["rooms", "Rooms"],
  ["faculty", "Faculty"],
  ["student_groups", "Student groups"],
  ["booking_requests", "Spectra requests"],
  ["exams", "Midsem exams"],
];

export function EngineStatus() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/engine/status")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) setStatus({ state: "ok", solver: j.health.solver, summary: j.summary });
        else setStatus({ state: "error", message: j.error });
      })
      .catch(() => !cancelled && setStatus({ state: "error", message: "Could not reach the app server" }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.state === "loading") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">
        {LABELS.map(([k]) => (
          <div key={k} className="h-20 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
        ))}
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
        <p className="font-semibold">Engine offline</p>
        <p className="opacity-80">{status.message}. Start it with <code>uvicorn app.main:app</code> in <code>engine/</code>.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm opacity-70">
        Engine online · {status.solver} · dataset <code>{String(status.summary.dataset_id)}</code>
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LABELS.map(([k, label]) => (
          <div key={k} className="rounded-xl border border-black/10 p-4 dark:border-white/15">
            <div className="text-2xl font-semibold tabular-nums">{status.summary[k]}</div>
            <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
