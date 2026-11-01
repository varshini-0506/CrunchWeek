"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Button, Card, ErrorBox, PageHead, useBusy } from "@/components/ui";
import { IconArrow } from "@/components/icons";
import { plain, roomNames } from "@/lib/plain";
import { api, DAYS, fmtHour, periodHour, type Decision } from "@/lib/api";

type Draft = {
  title: string; attendance: number | null; duration_periods: number | null;
  windows: { day: string; from_period: number; to_period: number }[];
  room_types: string[]; needs: string[]; requested_room: string | null; mandatory_for_groups: string[];
  requested_category: string; raw_text?: string;
};
type Parsed = Draft & { assumptions: string[]; follow_up: string[]; flags: string[]; parser: string };
type Preview = { ok: boolean; errors?: string[]; decision?: Decision; when?: string; category_label?: string; explain?: { notes?: string[]; blocked_by?: string[] } };

const EXAMPLES = [
  "kal shaam 6 se 8 baje robotics demo, 120 log, projector chahiye",
  "Guest lecture on chip design this Thursday 3 to 5 pm for about 150 students, need projector and mic",
  "Need LH-5 for a CSE second year quiz on Wednesday after lunch, 2 hours, compulsory for CSE-2",
  "Dance practice on Friday night 8 to 10, 60 people, open area is fine",
];
const NEEDS = ["projector", "pa_system", "stage", "computers", "ac", "whiteboard"];
const PERIODS = Array.from({ length: 13 }, (_, i) => i + 1);

export default function RequestPage() {
  const { user, meta, refresh } = useApp();
  const [text, setText] = useState("");
  const [today, setToday] = useState("TUE");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ id: string; proposal: Decision } | null>(null);
  const { busy, error, run } = useBusy();
  const roomTypes = useMemo(() => [...new Set(meta?.rooms.map((r) => r.type) ?? [])], [meta]);

  const read = () => run(async () => {
    const p = await api<Parsed>("/bookings/parse", { text, today });
    setParsed(p);
    setDone(null);
    setDraft({ ...p, requested_category: defaultCategory(user?.role, p.requested_category) });
  });

  const startBlank = () => {
    setParsed(null); setDone(null);
    setDraft({ title: "", attendance: 50, duration_periods: 2, windows: [{ day: "WED", from_period: 10, to_period: 11 }], room_types: [], needs: [], requested_room: null, mandatory_for_groups: [], requested_category: defaultCategory(user?.role) });
  };

  // Live preview: what the arbiter would decide right now if this were submitted.
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      if (!draft.attendance || !draft.duration_periods) { setPreview({ ok: false, errors: ["Add attendance and duration"] }); return; }
      api<Preview>("/bookings/preview", { ...draft, raw_text: text }).then(setPreview).catch((e) => setPreview({ ok: false, errors: [String(e.message)] }));
    }, 400);
    return () => clearTimeout(t);
  }, [draft, text]);

  const submit = () => run(async () => {
    const r = await api<{ id: string; proposal: Decision }>("/bookings", { ...draft, raw_text: text });
    setDone(r);
    await refresh();
  });

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="space-y-4">
      <PageHead title={<>Say it like you&apos;d text a friend.</>}>
        English or Hinglish both work. We turn it into a proper request, show you exactly what would happen, and only then send it to an approver.
      </PageHead>
      <Card title="Your message">
        <textarea aria-label="Your message" value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. kal shaam 6 se 8 baje robotics demo, 120 log, projector chahiye"
          className="w-full !rounded-[12px] !border-0 !bg-fill-2 p-4 text-[17px] leading-relaxed placeholder:text-ink-3/70" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={read} disabled={busy || !text.trim()}>Read it<IconArrow className="h-4 w-4" /></Button>
          <Button kind="secondary" onClick={startBlank}>Use a form instead</Button>
          <label className="ml-auto text-[13px] text-ink-3">Counting “kal” from
            <select value={today} onChange={(e) => setToday(e.target.value)} className="ml-1 rounded-[10px] px-1 py-0.5">{DAYS.map((d) => <option key={d}>{d}</option>)}</select>
          </label>
        </div>
        <div className="mt-4 border-t border-rule pt-3">
          <div className="mb-2 text-[13px] font-medium text-ink-3">Or start from one of these</div>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => <button key={e} onClick={() => setText(e)} className={`rounded-full px-3.5 py-1.5 text-left text-[13px] transition-colors duration-150 ${text === e ? "bg-accent-soft text-ink outline outline-1 -outline-offset-1 outline-accent" : "bg-fill text-ink-2 hover:bg-fill/60 hover:text-ink"}`}>{e}</button>)}
          </div>
        </div>
      </Card>
      <ErrorBox error={error} />

      {parsed && (parsed.assumptions.length > 0 || parsed.follow_up.length > 0 || parsed.flags.length > 0) && (
        <Card title="Here's how I read it" note={parsed.parser === "claude" ? "Read by the AI helper, checked by the planner" : "Read by the planner"}>
          <ul className="space-y-1.5 text-sm">
            {parsed.assumptions.map((a) => <li key={a} className="text-ink-2"><span className="font-medium text-ink">Assumed:</span> {a}</li>)}
            {parsed.follow_up.map((a) => <li key={a} className="text-ink-2"><span className="font-medium text-lake">Worth checking:</span> {a}</li>)}
            {parsed.flags.map((a) => <li key={a} className="text-ink-2"><span className="font-medium text-warn">Heads-up:</span> {a}</li>)}
          </ul>
        </Card>
      )}

      {draft && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card title="The request" note="Change anything that I read wrong.">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <label className="sm:col-span-2">Title<input value={draft.title} onChange={(e) => set({ title: e.target.value })} className="mt-1 w-full rounded-[10px] px-2 py-1.5" /></label>
              <label>Attendance<input type="number" min={1} value={draft.attendance ?? ""} onChange={(e) => set({ attendance: e.target.value ? +e.target.value : null })} className="mt-1 w-full rounded-[10px] px-2 py-1.5" /></label>
              <label>Duration (hours)<input type="number" min={1} max={13} value={draft.duration_periods ?? ""} onChange={(e) => set({ duration_periods: e.target.value ? +e.target.value : null })} className="mt-1 w-full rounded-[10px] px-2 py-1.5" /></label>
              <div className="sm:col-span-2">
                <div>When could it happen?</div>
                {draft.windows.map((w, i) => (
                  <div key={i} className="mt-1 flex flex-wrap items-center gap-1">
                    <select value={w.day} onChange={(e) => set({ windows: draft.windows.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)) })} className="rounded-[10px] px-1 py-1">{DAYS.map((d) => <option key={d}>{d}</option>)}</select>
                    from<select value={w.from_period} onChange={(e) => set({ windows: draft.windows.map((x, j) => (j === i ? { ...x, from_period: +e.target.value } : x)) })} className="rounded-[10px] px-1 py-1">{PERIODS.map((p) => <option key={p} value={p}>{fmtHour(periodHour(p))}</option>)}</select>
                    until<select value={w.to_period} onChange={(e) => set({ windows: draft.windows.map((x, j) => (j === i ? { ...x, to_period: +e.target.value } : x)) })} className="rounded-[10px] px-1 py-1">{PERIODS.map((p) => <option key={p} value={p}>{fmtHour(periodHour(p) + 1)}</option>)}</select>
                    <button onClick={() => set({ windows: draft.windows.filter((_, j) => j !== i) })} className="text-[13px] text-bad">remove</button>
                  </div>
                ))}
                <button onClick={() => set({ windows: [...draft.windows, { day: "THU", from_period: 10, to_period: 12 }] })} className="mt-1 text-[13px] text-accent">+ add another option</button>
              </div>
              <div className="sm:col-span-2">Venue types
                <div className="mt-1 flex flex-wrap gap-1">{roomTypes.map((t) => <Chip key={t} on={draft.room_types.includes(t)} onClick={() => set({ room_types: toggle(draft.room_types, t) })}>{t.replaceAll("_", " ")}</Chip>)}</div>
              </div>
              <div className="sm:col-span-2">Needs
                <div className="mt-1 flex flex-wrap gap-1">{NEEDS.map((t) => <Chip key={t} on={draft.needs.includes(t)} onClick={() => set({ needs: toggle(draft.needs, t) })}>{t.replace("pa_system", "sound / mic")}</Chip>)}</div>
              </div>
              <label>Preferred room (optional)
                <select value={draft.requested_room ?? ""} onChange={(e) => set({ requested_room: e.target.value || null })} className="mt-1 w-full rounded-[10px] px-2 py-1.5">
                  <option value="">Any suitable room</option>
                  {meta?.rooms.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name} ({r.capacity})</option>)}
                </select>
              </label>
              <label>Category
                <select value={draft.requested_category} onChange={(e) => set({ requested_category: e.target.value })} className="mt-1 w-full rounded-[10px] px-2 py-1.5">
                  {meta?.priority_order.filter((c) => c !== "exam" && c !== "regular_session").map((c) => <option key={c} value={c}>{meta.category_label[c]}</option>)}
                </select>
              </label>
              <div className="sm:col-span-2">Compulsory for (students must attend)
                <div className="mt-1 flex flex-wrap gap-1">{meta?.groups.map((g) => <Chip key={g.id} on={draft.mandatory_for_groups.includes(g.id)} onClick={() => set({ mandatory_for_groups: toggle(draft.mandatory_for_groups, g.id) })}>{g.id}</Chip>)}</div>
              </div>
            </div>
          </Card>
          <Card title="If you sent it now" note="What the arbiter would decide right now. Nothing is booked yet." className="lg:sticky lg:top-24 lg:self-start">
            {!preview ? <p className="text-sm text-ink-3">Checking…</p> : !preview.ok ? (
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-bad">{preview.errors?.map((e) => <li key={e}>{e}</li>)}</ul>
            ) : (
              <div className="space-y-2 text-sm">
                <span className={`stamp ${preview.decision!.status === "approved" ? "text-ok" : preview.decision!.status === "rejected" ? "text-bad" : "text-warn"}`}>{preview.decision!.status === "approved" ? "You would get it" : preview.decision!.status === "rejected" ? "Can't be hosted" : "A nearby slot"}</span>
                {preview.when && <div className="font-medium">{preview.when}, {preview.decision!.room_id}</div>}
                <p className="text-ink-2">{plain(preview.decision!.reason, roomNames(meta?.rooms), false)}</p>
                <p className="text-[13px] text-ink-3">Handled as a {preview.category_label?.toLowerCase()}. Rooms already promised to others stay promised; you get the best of what is left.</p>
                {preview.explain?.notes?.map((n) => <p key={n} className="text-[13px] text-warn">{n}</p>)}
              </div>
            )}
            <div className="mt-4">
              {done ? (
                <div className="rounded-xl bg-ok-soft p-3 text-sm text-ok">
                  Sent as <b>{done.id}</b>. A {user?.role === "club" || user?.role === "faculty" ? "department coordinator or admin" : "different admin"} confirms it next. <Link href="/spectra" className="underline">Track it</Link>
                </div>
              ) : <Button onClick={submit} disabled={busy || !preview?.ok}>Send it to an approver</Button>}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-full px-3 py-1 text-[13px] font-medium transition ${on ? "bg-accent text-white" : "bg-fill text-ink hover:bg-fill/70"}`}>{children}</button>;
}

function defaultCategory(role?: string, parsed?: string): string {
  if (parsed && parsed !== "club_event") return parsed;
  return { admin: "institute_event", department_coordinator: "department_event", faculty: "guest_lecture", club: "club_event" }[role ?? "club"] ?? "club_event";
}
