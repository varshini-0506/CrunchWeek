"use client";

import { useState } from "react";
import { Button, ErrorBox, useBusy } from "@/components/ui";
import { api, DAY_NAME, fmtHour, periodHour } from "@/lib/api";

type Result = {
  verdict: string; clash_free: boolean; local_ok: boolean; tokens: number; distinct: number; rounds: number; rounds_passed: number;
  error_bound: number | null; error_bound_per_round: number; ms: number; week: string;
  counts: { classes: number; rooms: number; teachers: number; sections: number };
  clashes: { kind: string; who: string; day: string; period: number }[];
  local_problems: { rule: string; detail: string }[];
  planted: { moved: string; onto: string; day: string; start_period: number; room_id: string } | null;
};

const STEPS = [
  ["Tokens", "Every busy hour of every room, teacher and section becomes one token. Closed rooms and away teachers count as busy."],
  ["Certificate", "The planner claims each busy hour once, in order. One pass checks the order, so nothing can repeat."],
  ["Equation", "Both lists become polynomials over the 2^61−1 field. A clash-free week makes them identical."],
  ["Quantum sample points", "The two sides are compared at 8 independent sample points. Each point cuts the chance of a wrong pass to almost nothing."],
  ["Locate", "If anything collides, the same test on each resource and day says exactly where."],
];

const pow10 = (x: number) => (x <= 0 ? "0" : `1 in 10^${Math.floor(-Math.log10(x))}`);

export default function QVerify() {
  const [week, setWeek] = useState<"regular" | "spectra">("spectra");
  const [r, setR] = useState<Result | null>(null);
  const { busy, error, run } = useBusy();
  const go = (plant: boolean) => run(async () => setR(await api<Result>(`/verify?week=${week}${plant ? "&plant=true" : ""}`)));
  const ok = r?.clash_free && r?.local_ok;

  return (
    <section className="overflow-hidden rounded-[8px] bg-[#0e1a1d] text-[#f4efe6]" aria-labelledby="qv-h">
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[.25em] text-[#5fd3a8]">Quantum-inspired</div>
          <h2 id="qv-h" className="font-poster mt-1 text-[40px] uppercase leading-none">Verifier</h2>
          <p className="mt-3 max-w-[560px] text-[15px] text-[#f4efe6]/80">
            Proves the whole week is clash-free in one pass, without comparing classes two by two. It checks every room, teacher and section, every closed room and every Spectra event.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="flex rounded-[10px] bg-white/10 p-1 text-[13px]">
              {(["regular", "spectra"] as const).map((w) => (
                <button key={w} onClick={() => setWeek(w)} className={`rounded-[8px] px-3 py-1.5 font-medium ${week === w ? "bg-[#e8b34a] text-[#0e1a1d]" : "text-[#f4efe6]/80"}`}>{w === "regular" ? "Regular week" : "Spectra week"}</button>
              ))}
            </div>
            <Button disabled={busy} onClick={() => go(false)}>Verify this week</Button>
            <Button disabled={busy} onClick={() => go(true)} className="border border-white/25 !bg-transparent !text-[#f4efe6] hover:!bg-white/10 disabled:!bg-transparent disabled:!text-[#f4efe6]">Plant a clash and verify</Button>
          </div>
          <p className="mt-2 text-[12px] text-[#f4efe6]/55">&ldquo;Plant a clash&rdquo; checks a copy with one class pushed onto another. The real timetable is never changed.</p>
          <ErrorBox error={error} />

          {r && (
            <div className="pop mt-5 rounded-[12px] bg-white/[.06] p-5" aria-live="polite">
              <div className="flex items-baseline gap-4">
                <div className={`font-poster text-[64px] leading-none ${ok ? "text-[#5fd3a8]" : "text-[#ff6a4a]"}`}>{ok ? "0" : r.clashes.length || r.local_problems.length}</div>
                <div>
                  <div className={`font-poster text-[26px] uppercase leading-none ${ok ? "text-[#5fd3a8]" : "text-[#ff6a4a]"}`}>{ok ? "Clashes. Verified." : "Problems caught"}</div>
                  <div className="mt-1 text-[13px] text-[#f4efe6]/70">{r.week === "spectra" ? "Spectra week" : "Regular week"} · {r.tokens.toLocaleString()} busy hours · {r.ms} ms</div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5" aria-label={`${r.rounds_passed} of ${r.rounds} sample points agree`}>
                {Array.from({ length: r.rounds }, (_, i) => <span key={i} className={`h-3 w-3 rounded-full ${i < r.rounds_passed ? "bg-[#5fd3a8]" : "bg-[#ff6a4a]"}`} />)}
                <span className="ml-2 text-[13px] text-[#f4efe6]/75">{r.rounds_passed} of {r.rounds} sample points agree</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
                {([["Classes", r.counts.classes], ["Rooms", r.counts.rooms], ["Teachers", r.counts.teachers], ["Sections", r.counts.sections]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-[#f4efe6]/60">{k}</dt><dd className="font-poster text-[24px]">{v}</dd></div>
                ))}
              </dl>
              {ok && r.error_bound !== null && <p className="mt-3 text-[13px] text-[#f4efe6]/75">Chance that a week with a clash passes all {r.rounds} points: below {pow10(r.error_bound)}.</p>}
              {r.planted && <p className="mt-3 text-[13px] text-[#e8b34a]">Planted: {r.planted.moved} pushed onto {r.planted.onto}, {DAY_NAME[r.planted.day]} {fmtHour(periodHour(r.planted.start_period))} in {r.planted.room_id}.</p>}
              {r.clashes.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13px] text-[#ffb3a3]">
                  {r.clashes.slice(0, 6).map((c, i) => <li key={i}>✕ {c.kind === "room" ? "Room" : c.kind === "teacher" ? "Teacher" : "Section"} {c.who} is booked twice on {DAY_NAME[c.day]} at {fmtHour(periodHour(c.period))}</li>)}
                </ul>
              )}
              {r.local_problems.length > 0 && <ul className="mt-2 space-y-1 text-[13px] text-[#ffb3a3]">{r.local_problems.slice(0, 6).map((p, i) => <li key={i}>✕ {p.detail}</li>)}</ul>}
            </div>
          )}
        </div>

        <ol className="relative space-y-3" aria-label="How the verifier works">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-[12px] bg-white/[.05] p-3.5">
              <span className="font-poster grid h-9 w-9 shrink-0 place-items-center rounded-full text-[18px] text-[#0e1a1d]" style={{ background: ["#23788a", "#7cc4e4", "#e8b34a", "#5fd3a8", "#c0330f"][i] }}>{i + 1}</span>
              <div><div className="font-poster text-[18px] uppercase leading-tight">{t}</div><div className="mt-0.5 text-[13px] text-[#f4efe6]/75">{d}</div></div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
