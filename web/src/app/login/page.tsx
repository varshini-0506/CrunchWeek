"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, DAY_NAME } from "@/lib/api";
import { ROLE_LABEL, USERS } from "@/lib/users";

/* Landing page, dressed as a fest poster (taste-skill direction "Dressed as something else").
   On this page, Week 7's clash of classes, midsems and Spectra becomes a gig poster whose venues the planner books.
   Poster hero on a vermilion field -> the live venue board -> one real request through four colour fields
   -> the Spectra line-up -> sign-in as an "Admit one" ticket -> the name, edge to edge. */

type Period = { id: number; start: string; end: string };
type Room = { id: string; name: string; capacity: number };
type Session = { session_id: string; course_id: string; title: string; kind: string; groups: string[]; faculty_name: string; day: string; start_period: number; duration: number; room_id: string };
type Event = { request_id: string; status: string; day: string; start_period: number; end_period: number; room_id: string; reason: string; title: string; requester: string; category: string };
type Row = { request: { id: string; title: string; requester: string; attendance: number; requested_room: string | null; windows: { day: string; from_period: number; to_period: number }[] }; decision: { status: string; reason: string; room_id?: string; day?: string; start_period?: number; end_period?: number } | null; state: string; category_label: string; when?: string; explain?: { rank?: number } };
type Status = { sessions: number; total_sessions: number; hard_violations: number | null; approved: number; alternatives: number; rejected: number; exams: number; solve: { seconds?: number; exam_seconds?: number } };

type Data = { periods: Period[]; rooms: Record<string, Room>; sessions: Session[]; events: Event[]; rows: Row[]; status: Status };

const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const SHORT: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri" };
const VENUES = ["AUD", "SH-1", "SH-2", "OAT", "CS-LAB-1", "CS-LAB-2"];

/** Engine reasons carry internal codes like "(P4-P5)", "BR-16" and "OAT". Turn them into plain sentences,
    and drop the "X free Mon 11 am to 1 pm" sentence, since the venue and time are shown next to it. */
const NAMES: { rooms: Record<string, string>; ends: Record<number, string> } = { rooms: {}, ends: {} };
function plain(reason: string) {
  const out = reason
    .replace(/\s*\((?:P\d+(?:-P\d+)?|BR-[\w]+)\)/g, "")
    .replace(/\bP(\d+)\b/g, (m, n: string) => NAMES.ends[+n] ? hm(NAMES.ends[+n]) : m)
    .replace(/\b(?:Room )?([A-Z]{2,}(?:-[A-Z0-9]+)*(?:-\d+)?)\b/g, (m, c: string) => NAMES.rooms[c] ?? m)
    .replace(/priority rank (\d+)/g, "number $1 in the priority order")
    .replace(/who has priority or asked first/g, "who comes earlier in the priority order")
    .replace(/(\b[\w ]+?) meets every need/g, "so it got $1 instead, which has everything it needs")
    .replace(/;\s*(\w)/g, (_, c: string) => `. ${c.toUpperCase()}`)
    .split(/(?<=\.)\s+/)
    .filter((x) => !/ free (Mon|Tue|Wed|Thu|Fri|Sat) /.test(x))
    .join(" ");
  return out.replace(/\.?$/, ".");
}
const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`; };

const isSpectra = (e: Event) => e.category === "institute_event";


export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ calendar: { periods: (Period & { id: number })[] }; rooms: Room[] }>("/meta"),
      api<{ sessions: Session[]; events: Event[] }>("/timetable?week=spectra"),
      api<{ rows: Row[] }>("/bookings"),
      api<Status>("/status"),
    ]).then(([m, t, b, s]) => {
      NAMES.rooms = Object.fromEntries(m.rooms.map((r) => [r.id, r.name]));
      NAMES.ends = Object.fromEntries(m.calendar.periods.map((p) => [p.id, p.end]));
      setData({
        periods: m.calendar.periods.filter((p) => p.id <= 13),
        rooms: Object.fromEntries(m.rooms.map((r) => [r.id, r])),
        sessions: t.sessions, events: t.events, rows: b.rows, status: s,
      });
    }).catch(() => setDown(true));
  }, []);

  useReveal();

  const signIn = async (username: string) => {
    setBusy(username);
    await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
    router.replace("/");
  };

  return (
    <div className="poster min-h-screen overflow-x-clip bg-paper">
      <Hero />
      <main>
        <section id="board" aria-labelledby="board-h" className="scroll-mt-4 bg-lake px-5 py-24 text-white sm:px-10 lg:py-32">
          <div className="mx-auto max-w-[1280px]">
            <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
              <h2 id="board-h" data-reveal className="font-poster text-[clamp(56px,8vw,120px)] uppercase leading-[0.86]">The board,<br />live</h2>
              <p data-reveal className="max-w-[40ch] text-[18px] leading-relaxed">Spectra week as the planner sees it right now. Pick a day, then any block, to see who got the room and why.</p>
            </div>
            <div data-reveal><VenueBoard data={data} down={down} /></div>
          </div>
        </section>
        <HowItDecides data={data} />
        <LineUp data={data} />
        <Desks busy={busy} onPick={signIn} />
      </main>
      <Footer />
    </div>
  );
}

/** Section parts rise into place as they reach the screen (heading, then text, then the fragment).
    Without script, or with reduced motion, everything is simply visible. */
function useReveal() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    root.classList.add("reveal-on");
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { (e.target as HTMLElement).dataset.shown = ""; io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    els.forEach((el) => { const sib = [...(el.closest("section, footer, article")?.querySelectorAll("[data-reveal]") ?? [])]; el.style.setProperty("--d", `${Math.min(sib.indexOf(el), 5) * 75}ms`); io.observe(el); });
    return () => { io.disconnect(); root.classList.remove("reveal-on"); };
  }, []);
}

/* ───────────────────────────── Hero: the poster ───────────────────────────── */

function Hero() {
  const [flip, setFlip] = useState(0);
  const dark = useSyncExternalStore(
    (cb) => { const m = matchMedia("(prefers-color-scheme: dark)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => { void flip; const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; },
    () => false,
  );
  const toggle = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("cw-theme", next ? "dark" : "light"); } catch {}
    setFlip((x) => x + 1);
  };
  return (
    <header className="relative grid min-h-[720px] grid-rows-[1fr_auto] overflow-hidden [height:100svh] max-h-[1000px]">
      <div className="relative bg-[#c0330f] text-[#f7f9f8]">
        <nav aria-label="Page" className="relative z-20 flex h-[72px] items-center gap-6 px-5 text-[15px] font-semibold sm:px-10">
          <span className="font-poster mr-auto text-[26px] uppercase tracking-[0.01em]">CrunchWeek</span>
          <a href="#board" className="hidden underline-offset-4 hover:underline md:block">The board</a>
          <a href="#how" className="hidden underline-offset-4 hover:underline md:block">How it decides</a>
          <a href="#lineup" className="hidden underline-offset-4 hover:underline md:block">Line-up</a>
          <button onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/15">
            {dark
              ? <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="3.5" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" /></svg>
              : <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9Z" /></svg>}
          </button>
        </nav>
        <h1 className="font-poster relative z-10 px-5 pt-[9vh] text-[19vw] uppercase leading-[0.84] tracking-[-0.01em] sm:px-10 md:text-[min(12.5vw,190px)]">
          <span className="poster-line block">Week 7.</span>
          <span className="poster-line block [animation-delay:90ms]">No clashes.</span>
        </h1>
        <ArchScene />
      </div>
      <div className="relative z-10 flex flex-col gap-5 bg-[#0e1a1d] px-5 py-7 text-[#f7f9f8] sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <p className="max-w-[46ch] text-[18px] leading-[1.5] sm:text-[20px]">CrunchWeek plans CIT&apos;s classes, midsems and every Spectra venue as one week. If a room is taken, you get the reason and the next free slot.</p>
        <a href="#desks" className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#f7f9f8] px-7 py-4 text-[17px] font-semibold text-[#c0330f] transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0">Pick your desk <span aria-hidden>→</span></a>
      </div>
    </header>
  );
}

/** Chilika at first light, drawn flat in the palette's own colours (no photograph of the lake could be fetched for this build).
    Cut into an arch and stuck on the poster at an angle, straddling the seam. */
function ArchScene() {
  return (
    <figure aria-label="Drawing: sunrise over Chilika lake, with a fishing boat" className="arch-shutter pointer-events-none absolute bottom-[-56px] right-[-18vw] z-0 w-[62vw] rotate-[5deg] sm:right-[4vw] sm:w-[27vw] md:bottom-[-64px]">
      <div className="aspect-[3/4] overflow-hidden rounded-t-[999px]">
        <svg viewBox="0 0 300 400" className="arch-img h-full w-full" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden>
          <rect width="300" height="400" fill="#f1b25a" />
          <rect y="0" width="300" height="70" fill="#f7c873" />
          <circle cx="150" cy="205" r="62" fill="#fbe6b4" />
          <rect y="205" width="300" height="195" fill="#23788a" />
          <rect y="232" width="300" height="10" fill="#6cc7d1" opacity=".55" />
          <rect y="258" width="300" height="7" fill="#6cc7d1" opacity=".45" />
          <rect y="282" width="300" height="5" fill="#6cc7d1" opacity=".35" />
          <rect x="88" y="214" width="124" height="5" fill="#fbe6b4" opacity=".8" />
          <rect x="106" y="226" width="88" height="4" fill="#fbe6b4" opacity=".6" />
          <path d="M0 205 L40 188 L78 199 L120 186 L150 196 L190 184 L236 198 L270 190 L300 197 L300 205 Z" fill="#146547" />
          <g fill="#0e1a1d">
            <path d="M60 318 h120 l-14 18 h-92 z" />
            <rect x="118" y="262" width="3" height="58" />
            <path d="M121 266 L156 312 L121 312 z" />
            <path d="M206 300 q14 -14 28 0 q-14 6 -28 0z" opacity=".85" />
          </g>
          <path d="M0 352 q75 -10 150 0 t150 0 V400 H0z" fill="#0e3c46" />
        </svg>
      </div>
    </figure>
  );
}

/* ───────────────────────────── How it decides: one real request, four fields ───────────────────────────── */

function HowItDecides({ data }: { data: Data | null }) {
  // The most telling real request: one that was moved to a free venue, else the first confirmed one.
  const rows = (data?.rows ?? []).filter((r) => r.state === "decided");
  const r = rows.find((x) => x.decision?.status === "alternative_offered") ?? rows.find((x) => /went to/.test(x.decision?.reason ?? "")) ?? rows[0];
  const room = (id?: string | null) => (id ? data?.rooms[id]?.name ?? id : null);
  const w = r?.request.windows[0];
  const asked = w ? `${SHORT[w.day] ?? w.day} ${hm(NAMES.ends[w.from_period - 1] ?? "8:00")}` : "";
  const why = r?.decision ? plain(r.decision.reason) : "";
  const fields = [
    { bg: "bg-[#23788a] text-white", clause: "First the request lands.", body: r && <><p>{r.request.requester} · {r.request.attendance} people</p><p className="mt-1">Asked for {room(r.request.requested_room) ?? "any big hall"}{asked ? `, ${asked}` : ""}</p></> },
    { bg: "bg-[#e8b54d] text-[#0e1a1d]", clause: "Then it takes its place in line.", body: r && <><p>{r.category_label}</p><p className="mt-2"><span className="rounded-full bg-[#f6e3b5] px-2.5 py-0.5 text-[13px] font-semibold text-[#74500a]">{r.explain?.rank ? `Number ${r.explain.rank} in the priority order` : "Checked against the priority order"}</span></p></> },
    { bg: "bg-[#6cc7d1] text-[#0e1a1d]", clause: "Then the planner finds a room.", body: r && <><p>{why.split(". ").slice(0, 2).join(". ")}</p><p className="mt-2 font-semibold">{room(r.decision?.room_id) ?? "No room fits"}</p></> },
    { bg: "bg-[#5fd3a8] text-[#0e1a1d]", clause: "Last, everyone hears why.", body: r && <><p className="font-semibold">{room(r.decision?.room_id) ?? "Declined"}{r.when ? ` · ${r.when.replace(/\s*\(P\d+(?:-P\d+)?\)/, "")}` : ""}</p><p className="mt-2"><span className="rounded-full bg-[#d4f2e6] px-2.5 py-0.5 text-[13px] font-semibold text-[#146547]">{r.decision?.status === "rejected" ? "Declined, with the reason" : "Confirmed, with the reason"}</span></p></> },
  ];
  return (
    <section id="how" aria-labelledby="how-h" className="grid scroll-mt-4 md:grid-cols-2 xl:grid-cols-4">
      {fields.map((f, i) => (
        <article key={f.clause} className={`group relative flex min-h-[520px] flex-col justify-between gap-8 p-6 xl:min-h-[78svh] ${f.bg}`}>
          <div>{i === 0 ? <h2 id="how-h" data-reveal className="font-poster text-[clamp(52px,5.4vw,84px)] uppercase leading-[0.86]">How it<br />decides</h2> : <span className="hidden h-[clamp(90px,9.3vw,145px)] xl:block" />}</div>
          <div data-ui data-reveal className="mx-auto min-h-[200px] w-full max-w-[320px] rounded-[8px] bg-[#f7f9f8] p-5 text-[15px] leading-snug text-[#0e1a1d] transition-transform duration-150 group-hover:-translate-y-1.5">
            <div className="text-[16px] font-semibold">{r?.request.title ?? "Loading a real request…"}</div>
            <div className="mt-1.5 text-[#3f4b4c]">{f.body}</div>
          </div>
          <p data-reveal className="font-poster text-[clamp(28px,2.5vw,38px)] uppercase leading-[0.95]">{f.clause}</p>
        </article>
      ))}
    </section>
  );
}

/* ───────────────────────────── The Spectra line-up ───────────────────────────── */

function LineUp({ data }: { data: Data | null }) {
  const [all, setAll] = useState(false);
  const rows = (data?.rows ?? []).filter((r) => r.state !== "cancelled");
  const order = (r: Row) => (r.decision?.day ? DAYS.indexOf(r.decision.day) * 100 + (r.decision.start_period ?? 0) : 999);
  const sorted = [...rows].sort((a, b) => order(a) - order(b));
  const shown = all ? sorted : sorted.slice(0, 10);
  const groupOf = (r: Row) => (r.decision?.day ? SHORT[r.decision.day] : "No venue");
  const tone = (st?: string) => (st === "approved" ? "text-ok" : st === "rejected" ? "text-bad" : "text-warn");
  const word = (st?: string) => (st === "approved" ? "Confirmed" : st === "rejected" ? "Declined, with the reason" : "Moved to a free venue");
  const n = (st: string) => rows.filter((r) => r.decision?.status === st).length;
  return (
    <section id="lineup" aria-labelledby="lineup-h" className="scroll-mt-4 px-5 py-28 sm:px-10 lg:py-40">
      <div className="mx-auto max-w-[1280px]">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <h2 id="lineup-h" data-reveal className="font-poster text-[clamp(64px,10vw,150px)] uppercase leading-[0.86] text-accent">The Spectra<span className="block pl-[16%]">line-up</span></h2>
          <p data-reveal className="max-w-[34ch] text-[18px] leading-relaxed text-ink">{data ? `${rows.length} requests: ${n("approved")} confirmed, ${n("alternative_offered")} moved to a free venue, ${n("rejected")} declined with the reason.` : "Every request and where it landed."}</p>
        </div>
        <table data-ui data-reveal className="mt-16 w-full border-collapse text-[16px] sm:text-[17px]">
          <caption className="sr-only">Every Spectra venue request, by day</caption>
          <thead className="sr-only"><tr><th>Day</th><th>Event</th><th>Venue and time</th><th>Decision</th></tr></thead>
          <tbody>
            {!data ? <tr><td className="py-6 text-ink-2">Loading the line-up…</td></tr> : shown.map((r, i) => {
              const g = groupOf(r);
              const first = i === 0 || groupOf(shown[i - 1]) !== g;
              return (
                <Fragment key={r.request.id}>
                {first && i > 0 && <tr aria-hidden className="h-8"><td colSpan={4} /></tr>}
                <tr className={`align-baseline ${i % 2 ? "" : "bg-[color-mix(in_srgb,var(--label)_6%,transparent)]"}`}>
                  <td className="font-poster w-[90px] py-3.5 pl-3 text-[24px] uppercase leading-none sm:w-[120px] sm:text-[28px]">{first ? g : ""}</td>
                  <td className="py-3.5 pr-4"><span className="font-semibold">{r.request.title}</span><span className="block text-[14px] text-ink-2">{r.request.requester} · {r.category_label}</span></td>
                  <td className="hidden py-3.5 pr-4 text-ink-2 md:table-cell">{r.decision?.room_id ? `${data.rooms[r.decision.room_id]?.name ?? r.decision.room_id} · ${(r.when ?? "").replace(/\s*\(P\d+(?:-P\d+)?\)/, "").replace(/^\w+ /, "")}` : "No venue fits"}</td>
                  <td className={`py-3.5 pr-3 text-right font-semibold ${tone(r.decision?.status)}`}>{word(r.decision?.status)}</td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {data && sorted.length > 10 && (
          <button onClick={() => setAll(!all)} className="mt-6 bg-ink px-6 py-3.5 text-[16px] font-semibold text-paper transition-transform duration-150 hover:-translate-y-0.5">
            {all ? "Show fewer" : `Show all ${sorted.length}`}
          </button>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────── Sign in: the admit-one ticket ───────────────────────────── */

function Desks({ busy, onPick }: { busy: string | null; onPick: (u: string) => void }) {
  return (
    <section id="desks" aria-labelledby="desks-h" className="scroll-mt-4 bg-[#23788a] px-5 py-24 sm:px-10 lg:py-36">
      <div className="mx-auto grid max-w-[1280px] items-center gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="desks-h" data-reveal className="font-poster text-[clamp(64px,9vw,128px)] uppercase leading-[0.86] text-[#e8b54d]">Pick your<br />desk</h2>
          <p data-reveal className="mt-8 max-w-[30ch] text-[20px] leading-relaxed text-white">Five demo accounts, no password. Each one sees Week 7 the way that person would.</p>
        </div>
        <div data-ui data-reveal className="ticket mx-auto w-full min-w-0 max-w-[620px] rotate-[-1.5deg] bg-[#f7f9f8] px-6 py-12 text-[#0e1a1d] sm:px-14 lg:col-span-7 lg:col-start-7">
          <p className="font-poster text-center text-[clamp(44px,5vw,64px)] uppercase leading-none">Admit one</p>
          <p className="mt-2 text-center text-[15px] text-[#3f4b4c]">CrunchWeek · Spectra &apos;27 · Week 7</p>
          <ul className="mt-8 space-y-1">
            {USERS.map((u, i) => (
              <li key={u.username}>
                <button onClick={() => onPick(u.username)} disabled={busy !== null}
                  className="group flex w-full items-center gap-4 rounded-[6px] px-3 py-3 text-left transition-colors duration-150 hover:bg-[#ece7da] disabled:opacity-60">
                  <Avatar name={u.name} i={i} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-semibold">{u.name}</span><span className="block truncate text-[14px] text-[#3f4b4c]">{u.blurb}</span></span>
                  {busy === u.username
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0e1a1d]/30 border-t-[#c0330f]" />
                    : <span className="shrink-0 text-[15px] font-semibold text-[#c0330f] transition-transform duration-150 group-hover:translate-x-1">{ROLE_LABEL[u.role]} →</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────── Footer: the name, edge to edge ───────────────────────────── */

function Footer() {
  return (
    <footer className="grid min-h-[80svh] grid-rows-[auto_1fr_auto] bg-[#0e1a1d] px-5 pb-6 pt-12 text-[#f7f9f8] sm:px-10">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-2 gap-8 text-[16px] md:grid-cols-4">
        <div><p className="font-semibold">Chilika Institute of Technology</p><p className="opacity-70">Odisha · about 1,000 students, five branches</p></div>
        <div><p className="font-semibold">On this page</p><a href="#board" className="block opacity-70 hover:opacity-100">The board</a><a href="#how" className="block opacity-70 hover:opacity-100">How it decides</a><a href="#lineup" className="block opacity-70 hover:opacity-100">Line-up</a></div>
        <div><p className="font-semibold">How it is planned</p><p className="opacity-70">Google OR-Tools, checked by the organisers&apos; own validator</p></div>
        <div><p className="font-semibold">Picture</p><p className="opacity-70">Chilika at first light, drawn for this page</p></div>
      </div>
      <span />
      <div>
        <p aria-hidden className="font-poster whitespace-nowrap text-center text-[18.6vw] uppercase leading-[0.8] text-[#c0330f]">CrunchWeek</p>
        <p className="mt-4 text-[13px] opacity-60">CrunchWeek for Spectra &apos;27. A demo build: sign in from any desk above.</p>
      </div>
    </footer>
  );
}

const AVATAR = ["bg-[#fbe1d8] text-[#a32b0c]", "bg-[#f6e3b5] text-[#74500a]", "bg-[#d4f2e6] text-[#146547]", "bg-[#d5eef1] text-[#1d6676]", "bg-[#e3e7e6] text-[#0e1a1d]"];
function Avatar({ name, i }: { name: string; i: number }) {
  const ini = name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold ${AVATAR[i % 5]}`}>{ini}</span>;
}

/* ───────────────────────────── Venue board ───────────────────────────── */

type Block = { key: string; kind: "class" | "spectra" | "event"; title: string; sub: string; start: number; span: number; room: string; day: string; moved: boolean; reason?: string; who?: string };

function VenueBoard({ data, down }: { data: Data | null; down: boolean }) {
  const [day, setDay] = useState("FRI");
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<Block | null>(null);

  const blocks = useMemo<Block[]>(() => {
    if (!data) return [];
    const ev: Block[] = data.events.map((e) => ({
      key: e.request_id, kind: isSpectra(e) ? "spectra" : "event", title: e.title, sub: e.requester, start: e.start_period,
      span: e.end_period - e.start_period + 1, room: e.room_id, day: e.day, reason: plain(e.reason), who: e.requester,
      moved: e.status === "alternative_offered" || /went to|does not exist|Nearest free/.test(e.reason),
    }));
    const cl: Block[] = data.sessions.map((s) => ({
      key: s.session_id, kind: "class", title: s.course_id, sub: `${s.title} · ${s.groups.join(", ")}`, start: s.start_period,
      span: s.duration, room: s.room_id, day: s.day, moved: false, who: s.faculty_name,
    }));
    return [...ev, ...cl];
  }, [data]);

  const rooms = useMemo(() => {
    if (!data) return VENUES;
    const extra = [...new Set(data.events.map((e) => e.room_id))].filter((r) => !VENUES.includes(r)).sort();
    return [...VENUES, ...extra];
  }, [data]);

  const today = blocks.filter((b) => b.day === day && rooms.includes(b.room));
  const counts = Object.fromEntries(DAYS.map((d) => [d, blocks.filter((b) => b.day === d && b.kind !== "class").length]));
  // Default to the most telling example on the day: an event that was moved, else the first event.
  const fallback = today.find((b) => b.moved) ?? today.find((b) => b.kind !== "class") ?? today[0];
  const picked = today.find((b) => b.key === sel) ?? fallback;
  const n = data?.periods.length ?? 13;
  const s = data?.status;
  const live = (data?.rows ?? []).filter((r) => r.state !== "cancelled");

  return (
    <section data-ui aria-label="Week 7 venue board" className="overflow-hidden rounded-[6px] bg-sheet text-ink">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Week 7 venue board</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-3">
            <span className={`h-1.5 w-1.5 rounded-full ${down ? "bg-bad" : "bg-jade"}`} />
            {down ? "The planner isn't running right now" : "Live from the planner · Spectra week"}
          </p>
        </div>
        <Legend />
      </div>

      {/* Headline numbers. */}
      <dl className="mt-5 grid grid-cols-2 border-y border-rule sm:grid-cols-4">
        <Stat label="Classes placed" value={s ? s.sessions : null} of={s?.total_sessions} />
        <Stat label="Double bookings" value={s ? s.hard_violations ?? 0 : null} good={s?.hard_violations === 0} />
        <Stat label="Fest requests given a venue" value={data ? live.filter((r) => r.decision?.status !== "rejected").length : null} of={data ? live.length : undefined} />
        <Stat label="Midsems scheduled" value={s ? s.exams : null} />
      </dl>

      {/* Day picker. */}
      <div className="flex items-center gap-1 overflow-x-auto px-5 pt-4" role="tablist" aria-label="Day">
        {DAYS.map((d) => (
          <button key={d} role="tab" aria-selected={d === day} onClick={() => { setDay(d); setSel(null); }}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${d === day ? "bg-ink text-paper" : "text-ink-2 hover:bg-fill"}`}>
            {SHORT[d]}
            {data && <span className={`tabular rounded-full px-1.5 text-[13px] ${d === day ? "bg-paper/20" : "bg-fill"}`}>{counts[d]}</span>}
          </button>
        ))}
        <span className="ml-auto hidden whitespace-nowrap pl-3 text-[13px] text-ink-3 sm:block">Room size shown next to each venue · count = fest events that day</span>
      </div>

      {/* The grid: venues down, hours across. */}
      <div className="mt-3 overflow-x-auto px-5 pb-1">
        <div className="min-w-[760px]" onPointerLeave={() => setHover(null)}>
          <div className="grid" style={{ gridTemplateColumns: `150px repeat(${n}, minmax(0, 1fr))` }}>
            <span />
            {(data?.periods ?? Array.from({ length: 13 }, (_, i) => ({ id: i + 1, start: `${i < 5 ? 8 + i : 9 + i}:00` }))).map((p) => (
              <span key={p.id} className={`pb-1.5 pl-1 text-[13px] tabular transition-colors ${hover && p.id >= hover.start && p.id < hover.start + hover.span ? "font-semibold text-ink" : "text-ink-3"}`}>{hm(p.start)}</span>
            ))}
          </div>
          {rooms.map((r) => {
            const inRow = today.filter((b) => b.room === r);
            const lit = hover?.room === r;
            return (
              <div key={r} className="grid border-t border-rule" style={{ gridTemplateColumns: `150px repeat(${n}, minmax(0, 1fr))` }}>
                <div className={`flex min-w-0 items-baseline gap-1.5 self-center pr-2 transition-colors ${lit ? "text-accent" : ""}`}>
                  <span className="truncate text-[13px] font-medium">{data?.rooms[r]?.name.replace("Classroom ", "Room ") ?? r}</span>
                  <span className="shrink-0 text-[13px] tabular text-ink-3">{data?.rooms[r]?.capacity ?? ""}</span>
                </div>
                <div className="relative col-span-full col-start-2 grid min-h-[42px] py-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                  {/* Hour guides, and the hovered block's time band. */}
                  {Array.from({ length: n }, (_, i) => (
                    <span key={i} className={`row-start-1 h-full border-l border-dashed border-rule transition-colors ${hover && i + 1 >= hover.start && i + 1 < hover.start + hover.span ? "bg-accent/[0.06]" : ""}`} style={{ gridColumn: i + 1 }} />
                  ))}
                  {inRow.map((b) => (
                    <Cell key={b.key} b={b} on={picked?.key === b.key} onPick={() => setSel(b.key)} onHover={setHover} />
                  ))}
                  {!data && !down && <span className="row-start-1 my-0.5 h-9 rounded-md bg-fill" style={{ gridColumn: `${2 + (r.length % 5)} / span 3` }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* What the selected block is, and why it is there. */}
      <div className="border-t border-rule bg-fill-2 px-5 py-4">
        {picked && data ? <Detail b={picked} data={data} /> : (
          <p className="text-[14px] text-ink-3">{down ? "Start the engine (uvicorn app.main:app) to see the live plan." : "Loading the plan…"}</p>
        )}
      </div>
    </section>
  );
}

function Cell({ b, on, onPick, onHover }: { b: Block; on: boolean; onPick: () => void; onHover: (b: Block | null) => void }) {
  const tone = b.kind === "class" ? "blk blk-lecture text-ink-2" : b.kind === "spectra" ? "blk blk-event text-ink" : "blk blk-club text-ink";
  return (
    <button onClick={onPick} onPointerEnter={() => onHover(b)} onFocus={() => onHover(b)} onBlur={() => onHover(null)}
      aria-label={`${b.title}, ${b.sub}`}
      className={`relative z-10 row-start-1 mx-[2px] my-0.5 flex min-w-0 flex-col justify-center overflow-hidden rounded-[6px] px-1.5 py-1 text-left transition-[filter,transform] duration-150 hover:-translate-y-px hover:brightness-[0.97] ${tone} ${on ? "outline outline-2 outline-accent" : ""}`}
      style={{ gridColumn: `${b.start} / span ${b.span}` }}>
      <span className="truncate text-[13px] font-semibold leading-tight">{b.title}</span>
      {b.span > 1 && <span className="truncate text-[13px] leading-tight text-ink-3">{b.kind === "class" ? b.sub.split(" · ")[0] : b.sub}</span>}
      {b.moved && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brass" />}
    </button>
  );
}

function Detail({ b, data }: { b: Block; data: Data }) {
  const p = data.periods;
  const from = p.find((x) => x.id === b.start), to = p.find((x) => x.id === b.start + b.span - 1);
  const when = `${DAY_NAME[b.day]}, ${from ? hm(from.start) : ""} to ${to ? hm(to.end) : ""}`;
  const room = data.rooms[b.room]?.name ?? b.room;
  return (
    <div key={b.key} className="pop flex flex-wrap items-start gap-x-6 gap-y-2">
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{b.kind === "class" ? `${b.title} · ${b.sub.split(" · ")[0]}` : b.title}</span>
          <Tag kind={b.kind} moved={b.moved} />
        </div>
        <div className="mt-0.5 text-[13px] text-ink-2">{room} · {when} · {b.kind === "class" ? `${b.who}, ${b.sub.split(" · ")[1]}` : b.who}</div>
      </div>
      <p className="max-w-[440px] text-[13px] leading-relaxed text-ink-2">
        {b.kind === "class" ? "A regular class. The planner kept it here so no student, teacher or room is double-booked, even with Spectra running." : b.reason}
      </p>
    </div>
  );
}

function Tag({ kind, moved }: { kind: Block["kind"]; moved: boolean }) {
  if (moved) return <span className="rounded-full bg-brass/15 px-2 py-0.5 text-[13px] font-medium text-brass">Moved to a free venue</span>;
  if (kind === "class") return <span className="rounded-full bg-fill px-2 py-0.5 text-[13px] font-medium text-ink-2">Class</span>;
  return <span className="rounded-full bg-jade/15 px-2 py-0.5 text-[13px] font-medium text-jade">Confirmed</span>;
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
      <li className="flex items-center gap-1.5"><i className="blk blk-lecture h-2.5 w-2.5 rounded-[3px]" />Class</li>
      <li className="flex items-center gap-1.5"><i className="blk blk-event h-2.5 w-2.5 rounded-[3px]" />Spectra</li>
      <li className="flex items-center gap-1.5"><i className="blk blk-club h-2.5 w-2.5 rounded-[3px]" />Club or department</li>
      <li className="flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-brass" />Moved</li>
    </ul>
  );
}

function Stat({ label, value, of }: { label: string; value: number | null; of?: number; good?: boolean }) {
  return (
    <div className="border-rule px-5 py-4 [&:nth-child(n+2)]:border-l max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="mt-1 text-[28px] font-normal leading-none tracking-[-0.02em] tabular">
        {value === null ? <span className="inline-block h-6 w-12 rounded bg-fill align-middle" /> : <Count to={value} />}
        {of !== undefined && value !== null && <span className="text-[15px] font-medium text-ink-3"> / {of}</span>}
      </dd>
    </div>
  );
}

function Count({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 700); setV(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v}</>;
}

/* ───────────────────────────── How it works ───────────────────────────── */
