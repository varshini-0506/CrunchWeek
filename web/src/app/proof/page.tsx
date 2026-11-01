"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, ErrorBox, Spinner, PageHead } from "@/components/ui";
import { api } from "@/lib/api";

type Reason = { facts: string[]; points?: number; points_lost?: number; course?: string; group?: string; request?: string };
type Item = {
  id: string; title: string; better: "lower" | "higher"; achieved: number | null; best_possible: number;
  max_if_all_approved?: number; optimal: boolean; solver_proved?: boolean; reasons: Reason[];
};
type Scen = { kind: string; what: string; must_move: number; room_only_fix?: number; quick_fix?: number; fully_fixed: boolean };
type Part = { scenarios: number; fully_fixed: number; fully_fixed_pct: number; avg_must_move: number; sessions_fixed_pct: number; worst: Scen[]; only_room_of_its_kind?: string[] };
type Proofs = {
  items: Item[]; all_optimal: boolean;
  quality: { eight_am_classes: number; building_changes: number };
  resilience: { available: boolean; scenarios: number; fully_fixed: number; fully_fixed_pct: number; room_closures: Part; faculty_absences: Part; method: string };
  solve: { status?: string; seconds?: number; stage1?: { status: string; soft: number; soft_lower_bound: number }; stage2?: { busiest_room_classes: number }; stage3?: { status: string } };
};

const fmt = (n: number | null) => (n === null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));

function Verdict({ ok }: { ok: boolean }) {
  return ok
    ? <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-[12px] font-medium text-ok">Best possible</span>
    : <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-[12px] font-medium text-warn">Room to improve</span>;
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[28px] font-semibold leading-none tracking-[-0.02em] tabular">{value}</div>
      <div className="mt-1.5 text-[13px] leading-snug text-ink-3">{label}</div>
    </div>
  );
}

export default function Proof() {
  const { version } = useApp();
  const [p, setP] = useState<Proofs | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api<Proofs>("/proofs").then(setP).catch(setErr); }, [version]);
  if (err) return <ErrorBox error={err} />;
  if (!p) return <Spinner label="Working out the proofs…" />;
  const r = p.resilience;
  return (
    <div className="space-y-4">
      <PageHead
        title={p.all_optimal ? <>No timetable can score better than this one.</> : <>Where this plan stands against the best possible.</>}
        meta={p.solve.stage1?.status === "OPTIMAL" ? "The solver also proved the soft penalty optimal on its own, so the two checks agree." : undefined}>
        For every score the judges&apos; validator gives, this page works out the best any plan could reach on this data, and shows why.
      </PageHead>

      <div className="grid gap-4 lg:grid-cols-2">
        {p.items.map((it) => (
          <Card key={it.id} title={it.title} actions={<Verdict ok={it.optimal} />}
            note={it.better === "lower" ? "Lower is better." : `Higher is better, out of ${fmt(it.max_if_all_approved ?? it.best_possible)} if every request could be approved.`}>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <Stat value={fmt(it.achieved)} label="This plan" />
              <Stat value={fmt(it.best_possible)} label={it.better === "lower" ? "Lowest any plan can reach" : "Highest any plan can reach"} />
            </div>
            {it.reasons.length > 0 && (
              <div className="space-y-3 border-t border-rule pt-3">
                {it.reasons.map((rs, i) => (
                  <ol key={i} className="list-decimal space-y-1 pl-5 text-[14px] leading-[1.5] text-ink-2 marker:text-ink-3">
                    {rs.facts.map((f, j) => <li key={j}>{f}</li>)}
                  </ol>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="A kinder week for students" note="The validator doesn't score these. After locking every official score, the planner improves them as well.">
          <div className="grid grid-cols-2 gap-4">
            <Stat value={p.quality.eight_am_classes} label="Classes starting at 8 am" />
            <Stat value={p.quality.building_changes} label="Times a section has to change building between back-to-back classes" />
          </div>
        </Card>
        {r.available && (
          <Card title="Ready for surprises" note={r.method}>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <Stat value={`${r.fully_fixed_pct}%`} label={`of ${r.scenarios} possible disruptions can be fixed without moving any other class`} />
              {p.solve.stage2 && <Stat value={p.solve.stage2.busiest_room_classes} label="The most classes that one room closure can force to move" />}
            </div>
            <ul className="space-y-1.5 border-t border-rule pt-3 text-[14px] text-ink-2">
              <li>Room closed all week: {r.room_closures.fully_fixed} of {r.room_closures.scenarios} can be fixed by changing only the room, with no class changing its time.</li>
              <li>Teacher away for a day: {r.faculty_absences.fully_fixed} of {r.faculty_absences.scenarios} can be fixed by moving only that teacher&apos;s classes.</li>
              {!!r.room_closures.only_room_of_its_kind?.length && (
                <li className="text-ink-3">These rooms are the only ones of their kind, so if one closes its classes have to change time: {r.room_closures.only_room_of_its_kind.join(", ")}.</li>
              )}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
