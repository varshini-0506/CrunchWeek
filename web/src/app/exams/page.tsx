"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, ErrorBox, Spinner, PageHead } from "@/components/ui";
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
      <PageHead title={<>{data.placements.length} papers, {data.violations.length === 0 && data.penalty === 0 ? "and no one sits two in a day." : "scheduled."}</>}
        actions={<select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded-xl px-3 py-2 text-sm">
          <option value="all">Every section</option>
          {meta?.groups.map((g) => <option key={g.id} value={g.id}>{g.id}</option>)}
        </select>}>
        Each paper gets one sitting and enough rooms for alternate seating (half of every room). No section sits two papers at once, and two on the same day are avoided.
      </PageHead>
      <ul className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-ink-2">
        <li className="flex items-baseline gap-2"><b className="text-[20px] font-semibold text-ink tabular">{data.placements.length}</b>papers placed</li>
        <li className="flex items-baseline gap-2"><b className={`text-[20px] font-semibold tabular ${data.violations.length ? "text-bad" : "text-ok"}`}>{data.violations.length}</b>sections double-booked</li>
        <li className="flex items-baseline gap-2"><b className={`text-[20px] font-semibold tabular ${data.penalty ? "text-warn" : "text-ok"}`}>{data.penalty / 5}</b>sections with two papers on one day</li>
        <li className="flex items-baseline gap-2"><b className="text-[20px] font-semibold text-ink tabular">{rooms}</b>halls used, each at half capacity</li>
      </ul>
      <div className="glass overflow-x-auto rounded-[16px] p-2">
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <thead><tr className="text-left text-[13px]"><th className="w-[84px] p-2 font-medium text-ink-3">Sitting</th>{data.calendar.days.map((d) => <th key={d} className="p-2 font-medium">{DAY_NAME[d]}</th>)}</tr></thead>
          <tbody>
            {data.calendar.sessions.map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="p-2 font-medium">{s.id === "AM" ? "Morning" : s.id === "PM" ? "Afternoon" : s.id}<div className="text-xs font-normal text-ink-3 tabular">{s.start} to {s.end}</div></td>
                {data.calendar.days.map((d) => (
                  <td key={d} className="space-y-1 p-2">
                    {shown.filter((p) => p.day === d && p.session === s.id).map((p) => (
                      <div key={p.exam_id} className="blk blk-lab rounded-[8px] p-2 text-xs">
                        <div className="font-semibold">{p.course_ids.join(", ")}</div>
                        <div className="text-ink-2">{p.groups.join(", ")} · {p.size} students</div>
                        <div className="text-ink-3">{p.rooms.join(", ")} · {p.seats} seats</div>
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.violations.length > 0 && <Card title="Needs attention"><ul className="text-sm text-bad">{data.violations.map((v, i) => <li key={i}>{v.detail}</li>)}</ul></Card>}
    </div>
  );
}
