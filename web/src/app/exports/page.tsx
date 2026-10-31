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
        <PageHead no="08" kicker="Files" title={<>The paperwork, <span className="gradient-text">for the judges.</span></>}>The plan in the official file format, plus the organisers&apos; own validator.py run on exactly these files.</PageHead>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {files.map((f) => (
          <div key={f.name} className="glass lift rounded-[18px] p-5">
            <div className="font-mono text-sm">{f.name}</div>
            <div className="mt-1 text-xs text-ink-3">{f.text}</div>
            {f.ok ? <a href={f.href} download={f.name} className="mt-4 inline-flex rounded-full bg-accent px-4 py-1.5 text-sm text-white transition hover:brightness-110">Download</a>
              : <div className="mt-3 text-xs text-ink-3">Available after an admin approves a change</div>}
          </div>
        ))}
      </div>
      {!val ? <Spinner label="Running the validator…" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportCard name="schedule.json" r={val.schedule} />
          {val.schedule_after && <ReportCard name="schedule_after.json (with --disruption and --baseline)" r={val.schedule_after} />}
        </div>
      )}
    </div>
  );
}

function ReportCard({ name, r }: { name: string; r: Report }) {
  return (
    <Card title={<span className="font-mono text-sm">{name}</span>}>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-[#1d1d1f] p-4 text-xs text-white/70">{[
        `Hard violations: ${r.hard_violation_count}`,
        ...r.hard_violations.slice(0, 20).map((v) => `  [${v.rule}] (${v.where}) ${v.detail}`),
        `Soft penalty: ${r.soft_total} ${JSON.stringify(r.soft_penalties)}`,
        r.bookings ? `Bookings: ${JSON.stringify(r.bookings, null, 0)}` : "",
        r.exam_soft_penalty !== undefined ? `Exam soft penalty: ${r.exam_soft_penalty}` : "",
        r.stability ? `Stability: ${JSON.stringify(r.stability)}` : "",
        ...r.warnings.map((w) => `  [warning] ${w}`),
      ].filter(Boolean).join("\n")}</pre>
    </Card>
  );
}
