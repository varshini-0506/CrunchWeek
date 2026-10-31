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
const SOFT: Record<string, string> = { S1: "A teacher teaching at a time they asked to avoid", S2: "Empty gaps in a section's day", S3: "A class in a room far too big for it", S4: "A class running at 5 pm", S5: "An unusually long day", S6: "The same course twice in one day" };

export default function Insights() {
  const { version, meta } = useApp();
  const [u, setU] = useState<Util | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api<Util>("/utilisation").then(setU).catch(setErr); }, [version]);
  if (err) return <ErrorBox error={err} />;
  if (!u) return <Spinner />;
  const maxDay = Math.max(...Object.values(u.by_day));
  const maxP = Math.max(...Object.values(u.by_period));
  return (
    <div className="space-y-4">
      <PageHead no="07" kicker="Campus pulse" title={<>How hard the campus <span className="gradient-text">is working.</span></>}>Which rooms carry the week, when the corridors are busiest, and how teaching is spread across faculty.</PageHead>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card kicker="Out of 45 teaching hours" title="How much each room is used">
          <div className="space-y-1.5">
            {u.rooms.map((r) => (
              <div key={r.room_id} className="grid grid-cols-[90px_1fr_80px] items-center gap-2 text-xs">
                <span className="font-mono" title={r.name}>{r.room_id}</span>
                <div className="h-2.5 rounded-full bg-fill"><div className="h-2.5 rounded-full bg-accent" style={{ width: `${Math.round(r.utilisation * 100)}%` }} /></div>
                <span className="text-right text-ink-2">{r.hours_used} h{r.avg_fill !== null && ` · ${Math.round(r.avg_fill * 100)}% full`}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card kicker="Small compromises" title="Where the week bends a little">
            <ul className="space-y-1 text-sm">{Object.entries(u.soft).map(([k, v]) => <li key={k} className="flex justify-between"><span>{SOFT[k] ?? k}</span><span className={v ? "font-display font-semibold text-lg text-warn" : "text-ok"}>{v === 0 ? "never" : v}</span></li>)}</ul>
          </Card>
          <Card title="Teaching hours by day">
            <div className="flex h-32 items-end gap-2">
              {Object.entries(u.by_day).map(([d, n]) => (
                <div key={d} className="flex flex-1 flex-col items-center gap-1 text-xs">
                  <span>{n}</span><div className="w-full rounded-xl bg-lake" style={{ height: `${(n / maxDay) * 90}px` }} /><span>{DAY_NAME[d].slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Classes running in each hour">
            <div className="flex h-32 items-end gap-1">
              {Object.entries(u.by_period).map(([p, n]) => (
                <div key={p} className="flex flex-1 flex-col items-center gap-1 text-[10px]">
                  <span>{n}</span><div className="w-full rounded-xl bg-ok" style={{ height: `${(n / maxP) * 90}px` }} /><span>{fmtHour(periodHour(+p))}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <Card kicker="Hours a week" title="Who teaches how much">
        <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {u.faculty_load.map((f) => (
            <div key={f.faculty_id} className="grid grid-cols-[1fr_100px_30px] items-center gap-2">
              <span className="truncate">{f.faculty_id} · {f.name}</span>
              <div className="h-2 rounded bg-paper-2"><div className="h-2 rounded bg-plum" style={{ width: `${Math.min(100, (f.hours / 16) * 100)}%` }} /></div>
              <span className="text-right">{f.hours}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-3">{meta?.faculty.length} faculty in the dataset.</p>
      </Card>
    </div>
  );
}
