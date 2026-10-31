"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, ErrorBox, Spinner, Stat, PageHead } from "@/components/ui";
import { api, DAY_NAME } from "@/lib/api";

type Placement = { exam_id: string; day: string; session: string; rooms: string[]; size: number; groups: string[]; course_ids: string[]; seats: number; duration_hours: number };
type Exams = { placements: Placement[]; violations: { rule: string; detail: string }[]; penalty: number; calendar: { days: string[]; sessions: { id: string; start: string; end: string }[] } };

export default function ExamsPage() {
  const { meta, version } = useApp();
  const [data, setData] = useState<Exams | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [group, setGroup] = useState("all");
  useEffect(() => { api<Exams>("/exams").then(setData).catch(setErr); }, [version]);
  if (err) return <ErrorBox error={err} />;
  if (!data) return <Spinner />;
  const shown = data.placements.filter((p) => group === "all" || p.groups.includes(group));
  const rooms = new Set(data.placements.flatMap((p) => p.rooms)).size;
  return (
    <div className="space-y-4">
      <PageHead no="06" kicker="Midsems" title={<>{data.placements.length} papers, <span className="gradient-text">{data.violations.length === 0 && data.penalty === 0 ? "and no one sits two in a day." : "scheduled."}</span></>}
        actions={<select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded-xl px-3 py-2 text-sm">
          <option value="all">Every section</option>
          {meta?.groups.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}
        </select>}>
        Each paper gets one sitting and enough rooms for alternate seating (half of every room). No section sits two papers at once, and two on the same day are avoided.
      </PageHead>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Papers" value={data.placements.length} hint="every midsem placed" />
        <Stat label="Clashes" value={data.violations.length === 0 ? "None" : data.violations.length} tone={data.violations.length ? "red" : "green"} hint="no section double-booked" />
        <Stat label="Two in one day" value={data.penalty === 0 ? "None" : data.penalty / 5} tone={data.penalty ? "amber" : "green"} hint="sections with two papers on a day" />
        <Stat label="Halls used" value={rooms} hint="at half capacity" />
      </div>
      <div className="glass overflow-x-auto rounded-[18px] p-2">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left"><th className="p-2">Session</th>{data.calendar.days.map((d) => <th key={d} className="p-2">{DAY_NAME[d]}</th>)}</tr></thead>
          <tbody>
            {data.calendar.sessions.map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="p-2 font-medium">{s.id}<div className="text-xs font-normal text-ink-3">{s.start}–{s.end}</div></td>
                {data.calendar.days.map((d) => (
                  <td key={d} className="space-y-1 p-2">
                    {shown.filter((p) => p.day === d && p.session === s.id).map((p) => (
                      <div key={p.exam_id} className="rounded-xl border-l-[3px] border-l-accent bg-riso-lecture p-2 text-xs">
                        <div className="font-semibold">{p.course_ids.join(", ")}</div>
                        <div>{p.groups.join(", ")} · {p.size} students</div>
                        <div className="text-ink-2">{p.rooms.join(", ")} ({p.seats} seats)</div>
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.violations.length > 0 && <Card title="Needs attention"><ul className="text-sm text-bad">{data.violations.map((v, i) => <li key={i}>[{v.rule}] {v.detail}</li>)}</ul></Card>}
    </div>
  );
}
