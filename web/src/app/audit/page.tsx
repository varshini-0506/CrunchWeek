"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Empty, Spinner, PageHead } from "@/components/ui";
import { api } from "@/lib/api";

type Entry = { at: string; actor: string; action: string; detail: string };

export default function Audit() {
  const { version } = useApp();
  const [rows, setRows] = useState<Entry[] | null>(null);
  useEffect(() => { api<Entry[]>("/audit?limit=200").then(setRows).catch(() => setRows([])); }, [version]);
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHead no="09" kicker="Logbook" title={<>Who did what, <span className="gradient-text">and when.</span></>}>Every plan, request, approval and change, newest first.</PageHead>
      {rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <div className="glass overflow-x-auto rounded-[18px] p-2">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3"><tr><th className="p-2">When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-t align-top">
                <td className="whitespace-nowrap p-2 text-xs text-ink-3">{new Date(r.at).toLocaleString()}</td>
                <td className="pr-2 font-mono text-xs">{r.actor}</td>
                <td className="pr-2">{r.action.replaceAll("_", " ")}</td>
                <td className="pr-2 text-ink-2">{r.detail}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
