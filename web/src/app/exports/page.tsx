"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, Spinner, PageHead } from "@/components/ui";
import { api } from "@/lib/api";

type Report = { hard_violation_count: number; hard_violations: { rule: string; where: string; detail: string }[]; soft_total: number; soft_penalties: Record<string, number>; bookings?: Record<string, unknown>; exam_soft_penalty?: number; stability?: Record<string, unknown>; warnings: string[] };

export default function Exports() {
  const { status, version } = useApp();
  const [val, setVal] = useState<{ schedule: Report; schedule_after?: Report } | null>(null);
  useEffect(() => { api<{ schedule: Report; schedule_after?: Report }>("/validate").then(setVal).catch(() => {}); }, [version]);
  const after = (status?.applied_changes ?? 0) > 0;
  const files = [
    { href: "/api/engine/export/schedule.json", name: "schedule.json", text: "Timetable, Spectra decisions and exams, as first generated", ok: true },
    { href: "/api/engine/export/schedule_after.json", name: "schedule_after.json", text: "After the approved changes", ok: after },
    { href: "/api/engine/export/disruption.json", name: "disruption.json", text: "The changes that were applied, in the official format", ok: after },
  ];
  return (
    <div className="space-y-4">
      <div>
        <PageHead title={<>The paperwork, for the judges.</>}>The plan in the official file format, checked by the organisers&apos; own checker on exactly these files.</PageHead>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {files.map((f) => (
          <div key={f.name} className="glass lift rounded-[16px] p-5">
            <div className="font-mono text-[14px] font-medium">{f.name}</div>
            <div className="mt-1 text-[13px] text-ink-2">{f.text}</div>
            {f.ok ? <a href={f.href} download={f.name} className="mt-4 inline-flex rounded-full bg-accent px-4 py-1.5 text-sm text-white transition hover:brightness-110">Download</a>
              : <div className="mt-3 text-xs text-ink-3">Available after an admin approves a change</div>}
          </div>
        ))}
      </div>
      {!val ? <Spinner label="Running the organisers\u2019 checker…" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportCard name="schedule.json" r={val.schedule} />
          {val.schedule_after && <ReportCard name="schedule_after.json" r={val.schedule_after} />}
        </div>
      )}
    </div>
  );
}

const SOFT_NAME: Record<string, string> = { S1: "Times teachers asked to avoid", S2: "Gaps in a section's day", S3: "Rooms much bigger than the class", S4: "Classes at 5 pm", S5: "Unusually long days", S6: "Same course twice in a day" };

function ReportCard({ name, r }: { name: string; r: Report }) {
  const b = r.bookings as { booking_score?: number; booking_score_max_if_all_approved?: number } | undefined;
  const st = r.stability as { sessions_moved?: number; time_changed?: number } | undefined;
  const rows: [string, React.ReactNode, boolean][] = [
    ["Double bookings", r.hard_violation_count === 0 ? "None" : r.hard_violation_count, r.hard_violation_count === 0],
    ...Object.entries(r.soft_penalties).map(([k, v]) => [SOFT_NAME[k] ?? k, v === 0 ? "Never" : v, v === 0] as [string, React.ReactNode, boolean]),
    ...(b?.booking_score !== undefined ? [["Spectra decisions score", `${b.booking_score} of ${b.booking_score_max_if_all_approved}`, true] as [string, React.ReactNode, boolean]] : []),
    ...(r.exam_soft_penalty !== undefined ? [["Sections with two midsems in a day", r.exam_soft_penalty === 0 ? "None" : r.exam_soft_penalty, r.exam_soft_penalty === 0] as [string, React.ReactNode, boolean]] : []),
    ...(st?.sessions_moved !== undefined ? [["Classes moved by changes", `${st.sessions_moved}${st.time_changed ? `, ${st.time_changed} at a new time` : ", none at a new time"}`, true] as [string, React.ReactNode, boolean]] : []),
  ];
  return (
    <Card note="Organisers' checker" title={<span className="font-mono text-[14px]">{name}</span>}>
      <ul className="divide-y divide-rule text-[14px]">
        {rows.map(([k, v, ok]) => (
          <li key={k} className="flex items-center gap-3 py-2">
            <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-ok" : "bg-warn"}`} />
            <span className="flex-1 text-ink-2">{k}</span><span className="font-medium tabular">{v}</span>
          </li>
        ))}
      </ul>
      {r.hard_violations.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-bad">{r.hard_violations.slice(0, 20).map((v, i) => <li key={i}>{v.detail}</li>)}</ul>}
      {r.warnings.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-warn">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </Card>
  );
}
