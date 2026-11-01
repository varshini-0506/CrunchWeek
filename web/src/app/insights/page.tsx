"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Card, ErrorBox, Spinner, PageHead } from "@/components/ui";
import { api, DAY_NAME, fmtHour, periodHour } from "@/lib/api";

type Util = {
  rooms: { room_id: string; name: string; type: string; capacity: number; hours_used: number; utilisation: number; avg_fill: number | null }[];
  by_day: Record<string, number>; by_period: Record<string, number>;
  faculty_load: { faculty_id: string; name: string; hours: number }[]; soft: Record<string, number>;
};
const SOFT: Record<string, string> = { S1: "A teacher teaching at a time they asked to avoid", S2: "Empty gaps in a section's day", S3: "A section's day running over 6 hours", S4: "The same course lectured twice in one day", S5: "A room less than 40% full", S6: "A class running at 5 pm" };

export default function Insights() {
  const { version, meta } = useApp();
  const [u, setU] = useState<Util | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api<Util>("/utilisation").then(setU).catch(setErr); }, [version]);
  if (err) return <ErrorBox error={err} />;
  if (!u) return <Spinner />;
  const maxDay = Math.max(...Object.values(u.by_day));
  const maxP = Math.max(...Object.values(u.by_period));
  const maxF = Math.max(...u.faculty_load.map((f) => f.hours));
  const top = u.rooms.reduce((a, r) => (r.utilisation > a.utilisation ? r : a), u.rooms[0]);
  const peakDay = Object.entries(u.by_day).find(([, n]) => n === maxDay)?.[0];
  const peakP = Object.entries(u.by_period).find(([, n]) => n === maxP)?.[0];
  const finding = top && peakDay && peakP ? `${top.name} is the busiest room, booked ${top.hours_used} of 45 hours. ${DAY_NAME[peakDay]} carries the most teaching, and ${fmtHour(periodHour(+peakP))} is the busiest hour, with ${maxP} classes at once.` : undefined;
  return (
    <div className="space-y-4">
      <PageHead title={<>How hard the campus is working.</>} meta={finding}>Which rooms carry the week, when the corridors are busiest, and how teaching is spread across faculty.</PageHead>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="How much each room is used" note="Hours booked out of 45 teaching hours, and how full the room is when used.">
          <div className="space-y-1.5">
            {u.rooms.map((r) => (
              <div key={r.room_id} className="group grid grid-cols-[140px_1fr_90px] items-center gap-3 rounded-md text-[13px] transition-colors hover:bg-fill-2">
                <span className="truncate" title={r.room_id}>{r.name}</span>
                <div className="h-2 rounded-full bg-fill"><div className={`h-2 rounded-full transition-[width] duration-700 ${r.room_id === top.room_id ? "bg-lake" : "bg-ink-3/55 group-hover:bg-ink-3"}`} style={{ width: `${Math.round(r.utilisation * 100)}%` }} /></div>
                <span className="text-right text-ink-2 tabular">{r.hours_used} h{r.avg_fill !== null && ` · ${Math.round(r.avg_fill * 100)}% full`}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Where the week bends a little" note="Soft rules the planner tries to keep, and how often it couldn't.">
            <ul className="space-y-1 text-sm">{Object.entries(u.soft).map(([k, v]) => <li key={k} className="flex justify-between"><span>{SOFT[k] ?? k}</span><span className={`tabular ${v ? "font-semibold text-warn" : "text-ink-3"}`}>{v === 0 ? "never" : v}</span></li>)}</ul>
          </Card>
          <Card title="Teaching hours by day">
            <div className="flex h-32 items-end gap-2">
              {Object.entries(u.by_day).map(([d, n]) => (
                <div key={d} className="flex flex-1 flex-col items-center gap-1 text-[13px]">
                  <span className="tabular text-ink-2">{n}</span><div className={`w-full max-w-[44px] rounded-t-[4px] transition-colors ${n === maxDay ? "bg-lake" : "bg-ink-3/45 hover:bg-ink-3/70"}`} style={{ height: `${(n / maxDay) * 90}px` }} /><span className="text-ink-3">{DAY_NAME[d].slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Classes running in each hour">
            <div className="flex h-32 items-end gap-1">
              {Object.entries(u.by_period).map(([p, n]) => (
                <div key={p} className="flex flex-1 flex-col items-center gap-1 text-[13px]">
                  <span className="tabular text-ink-2">{n}</span><div className={`w-full max-w-[32px] rounded-t-[4px] transition-colors ${n === maxP ? "bg-lake" : "bg-ink-3/45 hover:bg-ink-3/70"}`} style={{ height: `${Math.max(2, (n / maxP) * 90)}px` }} /><span className="text-ink-3">{fmtHour(periodHour(+p))}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <Card title="Who teaches how much" note="Teaching hours a week, per faculty member.">
        <div className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          {u.faculty_load.map((f) => (
            <div key={f.faculty_id} className="grid grid-cols-[1fr_90px_36px] items-center gap-2">
              <span className="truncate">{f.name}</span>
              <div className="h-1.5 rounded-full bg-fill"><div className={`h-1.5 rounded-full ${f.hours === maxF ? "bg-lake" : "bg-ink-3/55"}`} style={{ width: `${Math.min(100, (f.hours / 16) * 100)}%` }} /></div>
              <span className="text-right tabular text-ink-2">{f.hours} h</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-ink-3">{meta?.faculty.length} faculty in the dataset.</p>
      </Card>
    </div>
  );
}
