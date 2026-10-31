"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Button, Card, Empty, ErrorBox, Spinner, useBusy, PageHead } from "@/components/ui";
import { api, DAY_NAME, DAYS, fmtHour, periodHour, type Violation } from "@/lib/api";

type Slot = { day: string; start_period: number; room_id: string };
type Moved = { session_id: string; kind: "time" | "room"; from: Slot; to: Slot; course_id: string; groups: string[]; faculty_id: string };
type Change = {
  id: string; kind: string; by: string; at: string; note?: string; status: string; changes: Record<string, unknown>[];
  diff?: { moved: Moved[]; added: { session_id: string; to: Slot }[]; removed: { session_id: string }[]; sessions_moved: number; time_changed: number; room_only_changed: number };
  broken_before_fix?: Violation[]; conflicts?: string[]; errors?: string[]; soft_before?: number; soft_after?: number;
  solver?: { status: string; seconds: number }; approved_by?: string; exam_issues?: string[];
};
type ChangeDraft = { changes: { type: string; faculty_id: string; days: string[]; periods: number[]; reason: string }[]; follow_up: string[]; parser: string };

export default function ChangesPage() {
  const { user, meta, version, refresh, status } = useApp();
  const [list, setList] = useState<{ pending: Change[]; applied: Change[] } | null>(null);
  const [text, setText] = useState("");
  const [fid, setFid] = useState(user?.faculty_id ?? "F07");
  const [draft, setDraft] = useState<ChangeDraft | null>(null);
  const [json, setJson] = useState("");
  const { busy, error, run, setError } = useBusy();
  const isAdmin = user?.role === "admin";
  const running = status?.job.status === "running";

  useEffect(() => { api<{ pending: Change[]; applied: Change[] }>("/changes").then(setList).catch(() => {}); }, [version]);

  const parse = () => run(async () => setDraft(await api<ChangeDraft>("/changes/parse", { text, faculty_id: fid })));
  const preview = (changes: unknown[], note: string) => run(async () => { await api("/changes/preview", { changes, note }); await refresh(); });
  const previewJson = () => {
    try {
      const parsed = JSON.parse(json);
      preview(Array.isArray(parsed) ? parsed : parsed.changes ?? [], parsed.description ?? "Uploaded change file");
    } catch { setError(new Error("That is not valid JSON")); }
  };
  const loadSample = () => run(async () => setJson(JSON.stringify(await api("/samples/disruption"), null, 2)));
  const act = (path: string) => run(async () => { await api(path, {}); await refresh(); });

  return (
    <div className="space-y-4">
      <PageHead no="05" kicker="Changes" title={<>Plans change. <span className="gradient-text">The week bends, it doesn&apos;t break.</span></>}>
        When a teacher is away or a room closes, the planner moves as few classes as it can, swaps rooms before times, and shows you the before and after. Nothing is published until an admin signs off.
      </PageHead>
      <ErrorBox error={error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card kicker="An absence" title={user?.role === "faculty" ? "I can't teach…" : "A teacher can't make it"}>
          <div className="space-y-2 text-sm">
            {user?.role !== "faculty" && (
              <select value={fid} onChange={(e) => setFid(e.target.value)} className="w-full rounded-[10px] px-3 py-2">
                {meta?.faculty.map((f) => <option key={f.id} value={f.id}>{f.id} · {f.name}</option>)}
              </select>
            )}
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. I can't take Tuesday mornings next week / Monday poora din conference hai"
              className="w-full rounded-[10px] p-3" />
            <Button onClick={parse} disabled={busy || !text.trim()}>Read it</Button>
            {draft && (draft.changes.length === 0 ? <p className="text-lake">{draft.follow_up.join(" ")}</p> : draft.changes.map((c, i) => (
              <div key={i} className="rounded-[12px] bg-fill-2 p-3">
                <div className="mb-1 font-medium">{c.faculty_id} unavailable</div>
                <div className="flex flex-wrap gap-1">{DAYS.map((d) => <Toggle key={d} on={c.days.includes(d)} onClick={() => setDraft({ ...draft, changes: [{ ...c, days: c.days.includes(d) ? c.days.filter((x) => x !== d) : [...c.days, d] }] })}>{d}</Toggle>)}</div>
                <div className="mt-1 flex flex-wrap gap-1">{Array.from({ length: 9 }, (_, k) => k + 1).map((p) => <Toggle key={p} on={c.periods.includes(p)} onClick={() => setDraft({ ...draft, changes: [{ ...c, periods: c.periods.includes(p) ? c.periods.filter((x) => x !== p) : [...c.periods, p].sort((a, b) => a - b) }] })}>{fmtHour(periodHour(p))}</Toggle>)}</div>
                <div className="mt-2"><Button disabled={busy || running || !c.days.length || !c.periods.length} onClick={() => preview(draft.changes, text)}>See what would move</Button></div>
              </div>
            )))}
          </div>
        </Card>
        {(isAdmin || user?.role === "department_coordinator") && (
          <Card kicker="Official format" title="A change file" actions={<Button small kind="ghost" onClick={loadSample}>Use the sample</Button>}>
            <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={7} placeholder='{"changes": [{"type": "room_unavailable", ...}]}' className="w-full rounded-[10px] p-3 font-mono text-xs" />
            <div className="mt-2"><Button disabled={busy || running || !json.trim()} onClick={previewJson}>Find the gentlest fix</Button></div>
          </Card>
        )}
      </div>

      {running && status?.job.kind === "repair" && <Card><Spinner label="Re-solving with the fewest moves…" /></Card>}

      <h2 className="px-1 text-[13px] font-semibold text-ink-2">Waiting for sign-off</h2>
      {!list ? <Spinner /> : list.pending.length === 0 ? <Empty>Nothing waiting for sign-off.</Empty> : list.pending.map((c) => (
        <ChangeCard key={c.id} c={c} actions={isAdmin && (
          <>
            {c.status === "proposed" && <Button disabled={busy} onClick={() => act(`/changes/${c.id}/approve`)}>Sign off and publish</Button>}
            <Button kind="secondary" disabled={busy} onClick={() => act(`/changes/${c.id}/reject`)}>{c.status === "proposed" ? "Reject" : "Dismiss"}</Button>
          </>
        )} />
      ))}

      {list && list.applied.length > 0 && <>
        <h2 className="px-1 text-[13px] font-semibold text-ink-2">Published</h2>
        {[...list.applied].reverse().map((c) => <ChangeCard key={c.id} c={c} />)}
      </>}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1 text-xs font-medium transition ${on ? "bg-bad text-white" : "bg-fill text-ink"}`}>{children}</button>;
}

function slot(s: Slot) {
  return `${DAY_NAME[s.day]?.slice(0, 3)} ${fmtHour(periodHour(s.start_period))} ${s.room_id}`;
}

function ChangeCard({ c, actions }: { c: Change; actions?: React.ReactNode }) {
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-ink-3">{c.id}</span>{c.note ?? c.kind.replace("_", " ")} <Badge s={c.status} /></span>} actions={actions}>
      <div className="space-y-2 text-sm">
        <div className="text-xs text-ink-3">by {c.by} · {new Date(c.at).toLocaleString()}{c.approved_by && ` · approved by ${c.approved_by}`}{c.solver && ` · worked out in ${c.solver.seconds}s${c.solver.status === "OPTIMAL" ? " (proven fewest moves)" : ""}`}</div>
        {c.changes.length > 0 && <ul className="text-xs text-ink-2">{c.changes.map((ch, i) => <li key={i}>• {describe(ch)}</li>)}</ul>}
        {c.broken_before_fix && c.broken_before_fix.length > 0 && (
          <details className="text-xs"><summary className="cursor-pointer text-warn">{c.broken_before_fix.length} clashes this would cause if we did nothing</summary>
            <ul className="mt-1 text-ink-2">{c.broken_before_fix.slice(0, 12).map((v, i) => <li key={i}>[{v.rule}] {v.detail}</li>)}</ul>
          </details>
        )}
        {c.status === "infeasible" && (
          <div className="rounded-xl bg-bad-soft p-2 text-bad"><b>No valid timetable exists with this change.</b> Why:
            <ul className="list-disc pl-5">{c.conflicts?.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {c.errors && <div className="rounded-xl bg-bad-soft p-2 text-bad">{c.errors.map((e) => <div key={e}>{e}</div>)}</div>}
        {c.diff && (
          <>
            <div className="flex flex-wrap gap-3">
              <span className="font-medium">{c.diff.sessions_moved} classes move</span>
              <span className="text-ink-2">{c.diff.time_changed} change time · {c.diff.room_only_changed} only change room</span>
              {c.soft_before !== undefined && <span className="text-ink-2">compromises {c.soft_before} → {c.soft_after}</span>}
            </div>
            {c.diff.moved.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-ink-3"><tr><th className="py-1">Session</th><th>Who</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
                  <tbody>{c.diff.moved.map((m) => (
                    <tr key={m.session_id} className="border-t">
                      <td className="py-1 font-mono">{m.session_id}</td><td>{m.groups.join(", ")} · {m.faculty_id}</td>
                      <td className="text-bad line-through decoration-bad/40">{slot(m.from)}</td><td className="text-ok">{slot(m.to)}</td>
                      <td>{m.kind === "room" ? "room only" : "new time"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {c.diff.added.length > 0 && <div className="text-xs">Added: {c.diff.added.map((a) => `${a.session_id} at ${slot(a.to)}`).join(", ")}</div>}
            {c.diff.removed.length > 0 && <div className="text-xs">Removed: {c.diff.removed.map((a) => a.session_id).join(", ")}</div>}
          </>
        )}
        {c.exam_issues && c.exam_issues.length > 0 && <div className="text-xs text-warn">Exam issues: {c.exam_issues.join("; ")}</div>}
      </div>
    </Card>
  );
}

function describe(ch: Record<string, unknown>): string {
  const t = ch.type as string;
  const per = (ch.periods as number[] | undefined)?.join(",");
  const days = (ch.days as string[] | undefined)?.join(", ");
  if (t === "faculty_unavailable") return `${ch.faculty_id} unavailable ${days} P${per}${ch.reason ? ` (${ch.reason})` : ""}`;
  if (t === "room_unavailable") return `${ch.room_id} closed ${days} P${per}${ch.reason ? ` (${ch.reason})` : ""}`;
  if (t === "add_session") return `New session ${(ch.session as { id: string })?.id}`;
  if (t === "remove_session") return `Remove ${ch.session_id}`;
  if (t === "add_faculty") return `New faculty ${(ch.faculty as { id: string; name: string })?.name}`;
  return t;
}
