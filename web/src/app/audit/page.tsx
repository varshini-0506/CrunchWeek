"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Empty, Spinner, PageHead } from "@/components/ui";
import { api } from "@/lib/api";
import { USERS } from "@/lib/users";

const ACTION: Record<string, string> = { generate: "Planned the week", reset: "Reset the demo" };
const who = (a: string) => (a === "system" ? "CrunchWeek" : USERS.find((u) => u.username === a)?.name ?? a);
const what = (a: string) => ACTION[a] ?? a.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const detail = (d: string) => d
  .replace(/Timetable OPTIMAL in (\d+)s/, "Timetable planned in $1 seconds, the best possible")
  .replace(/Timetable FEASIBLE in (\d+)s/, "Timetable planned in $1 seconds")
  .replace(/exams OPTIMAL/, "midsems planned, the best possible").replace(/exams FEASIBLE/, "midsems planned")
  .replace(/; /g, ". ").replace(/\.?$/, ".");

type Entry = { at: string; actor: string; action: string; detail: string };

export default function Audit() {
  const { version } = useApp();
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => { api<Entry[]>("/audit?limit=200").then(setRows).catch(() => setRows([])); }, [version]);
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHead title={<>Who did what, and when.</>}>Every plan, request, approval and change, newest first.</PageHead>
      {rows.length === 0 ? <Empty title="No activity yet">Plans, requests, approvals and published changes are logged here as they happen.</Empty> : (
        <div className="glass overflow-x-auto rounded-[16px] p-2">
          <table className="w-full text-sm">
            <thead className="text-left text-[13px] text-ink-3"><tr><th className="px-3 py-2 font-medium">When</th><th className="font-medium">Who</th><th className="font-medium">What</th><th className="font-medium">Detail</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-t border-rule align-baseline transition-colors hover:bg-fill-2">
                <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-ink-3 tabular">{new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                <td className="pr-3 font-medium">{who(r.actor)}</td>
                <td className="pr-3">{what(r.action)}</td>
                <td className="pr-3 text-ink-2">{detail(r.detail)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
