"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type Job, type Meta } from "@/lib/api";
import { ROLE_LABEL, type User } from "@/lib/users";
import { IconBook, IconBox, IconChat, IconOut, IconPen, IconPulse, IconRefresh, IconSearch, IconSpark, IconSwap, IconToday, IconWeek } from "./icons";

export type Status = {
  job: Job; timetable: boolean; sessions: number; total_sessions: number; hard_violations: number | null;
  soft_total: number | null; booking_score: number; booking_max: number; approved: number; alternatives: number;
  rejected: number; pending_bookings: number; pending_changes: number; applied_changes: number;
  exam_penalty: number; exams: number; ai: boolean;
  solve: { status?: string; seconds?: number; exam_seconds?: number; variables?: number };
};

type Ctx = {
  user: User | null; meta: Meta | null; status: Status | null; version: number;
  refresh: () => Promise<void>; engineDown: string | null;
};

const AppCtx = createContext<Ctx>({ user: null, meta: null, status: null, version: 0, refresh: async () => {}, engineDown: null });
export const useApp = () => useContext(AppCtx);

type Icon = (p: { className?: string }) => React.ReactNode;
type Nav = { href: string; label: string; short: string; note: string; icon: Icon; group: string; roles?: string[] };
const NAV: Nav[] = [
  { href: "/", label: "Today", short: "Today", note: "Where things stand", icon: IconToday, group: "Plan" },
  { href: "/timetable", label: "The week", short: "Week", note: "Who is where, when", icon: IconWeek, group: "Plan" },
  { href: "/exams", label: "Midsems", short: "Midsems", note: "Exam week", icon: IconPen, group: "Plan" },
  { href: "/spectra", label: "Spectra '27", short: "Spectra", note: "Fest venues", icon: IconSpark, group: "Requests" },
  { href: "/request", label: "Ask for a room", short: "Ask", note: "In your own words", icon: IconChat, group: "Requests" },
  { href: "/changes", label: "Changes", short: "Changes", note: "Absences, closures", icon: IconSwap, group: "Requests", roles: ["admin", "department_coordinator", "faculty"] },
  { href: "/insights", label: "Campus pulse", short: "Pulse", note: "Rooms and load", icon: IconPulse, group: "Insight" },
  { href: "/exports", label: "Files", short: "Files", note: "For the judges", icon: IconBox, group: "Insight" },
  { href: "/audit", label: "Logbook", short: "Logbook", note: "Every action", icon: IconBook, group: "Insight", roles: ["admin", "department_coordinator"] },
];
const TABS = ["/", "/timetable", "/spectra", "/request"];

type Theme = "auto" | "light" | "dark";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checkedPath, setCheckedPath] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [version, setVersion] = useState(0);
  const [engineDown, setEngineDown] = useState<string | null>(null);
  const [spot, setSpot] = useState(false);
  const [more, setMore] = useState(false);
  const [me, setMe] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api<Status>("/status");
      setStatus(s);
      setEngineDown(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setEngineDown(e instanceof Error ? e.message : "Engine unreachable");
    }
  }, []);

  useEffect(() => {
    fetch("/api/session").then((r) => r.json()).then((d) => {
      setUser(d.user);
      setCheckedPath(pathname);
    });
  }, [pathname]);

  useEffect(() => {
    if (checkedPath === pathname && !user && pathname !== "/login") router.replace("/login");
  }, [checkedPath, user, pathname, router]);

  useEffect(() => {
    if (!user) return;
    api<Meta>("/meta").then(setMeta).catch(() => {});
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [user, refresh]);

  // While the engine is busy (solving, repairing), poll until it finishes, then refresh every page.
  const running = status?.job?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const j = await api<Job>("/job").catch(() => null);
      if (j && j.status !== "running") {
        clearInterval(t);
        api<Meta>("/meta").then(setMeta).catch(() => {});
        refresh();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [running, refresh]);

  // ⌘K / Ctrl+K opens Spotlight anywhere; Esc closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSpot((s) => !s); }
      if (e.key === "Escape") { setSpot(false); setMe(false); setMore(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (pathname === "/login") return <>{children}</>;
  if (!user) return <div className="grid min-h-screen place-items-center"><Spin /></div>;

  const signOut = async () => {
    await fetch("/api/session", { method: "DELETE" });
    setUser(null);
    router.replace("/login");
  };
  const links = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  const groups = [...new Set(links.map((l) => l.group))];
  const here = links.find((l) => l.href === pathname);
  const initials = user.name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  const badge = (href: string) => (href === "/spectra" ? status?.pending_bookings : href === "/changes" ? status?.pending_changes : 0) || 0;

  return (
    <AppCtx.Provider value={{ user, meta, status, version, refresh, engineDown }}>
      <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
        {/* macOS-style sidebar (source list) */}
        <aside className="material sticky top-0 hidden h-screen flex-col border-r border-rule px-3 pb-3 pt-5 lg:flex">
          <Link href="/" className="flex items-center gap-2.5 px-2.5">
            <AppIcon />
            <div className="leading-tight"><div className="text-[15px] font-semibold">CrunchWeek</div><div className="text-[11px] text-ink-3">Chilika Inst. of Technology</div></div>
          </Link>
          <button onClick={() => setSpot(true)} className="mt-5 flex items-center gap-2 rounded-lg bg-fill px-2.5 py-1.5 text-[13px] text-ink-3 transition hover:text-ink">
            <IconSearch className="h-[15px] w-[15px]" /> Search <kbd className="ml-auto font-sans text-[11px]">⌘K</kbd>
          </button>
          <nav className="mt-3 flex-1 overflow-y-auto">
            {groups.map((g) => (
              <div key={g} className="mt-3">
                <div className="px-2.5 pb-1 text-[11px] font-semibold text-ink-3">{g}</div>
                {links.filter((l) => l.group === g).map((n) => {
                  const on = pathname === n.href;
                  const I = n.icon;
                  const b = badge(n.href);
                  return (
                    <Link key={n.href} href={n.href} className={`flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors ${on ? "bg-fill font-medium text-ink" : "text-ink hover:bg-fill-2"}`}>
                      <I className="h-[17px] w-[17px] text-accent" />
                      <span className="flex-1">{n.label}</span>
                      {b > 0 && <span className="text-[12px] font-medium text-ink-3 tabular">{b}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="relative">
            <button onClick={() => setMe(!me)} className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition hover:bg-fill-2">
              <Avatar initials={initials} />
              <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-medium">{user.name}</span><span className="block text-[11px] text-ink-3">{ROLE_LABEL[user.role]}</span></span>
            </button>
            {me && <Account user={user} ai={!!status?.ai} onSignOut={signOut} onClose={() => setMe(false)} className="bottom-14 left-0" />}
          </div>
        </aside>

        <div className="min-w-0">
          {/* Toolbar */}
          <header className="material sticky top-0 z-30 border-b border-rule">
            <div className="mx-auto grid h-[52px] max-w-[1180px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-8">
              <div className="flex min-w-0 items-center gap-2">
                <Link href="/" className="lg:hidden"><AppIcon small /></Link>
                <span className="truncate text-[15px] font-semibold">{here?.label ?? ""}</span>
              </div>
              <Island status={status} engineDown={engineDown} />
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setSpot(true)} className="grid h-8 w-8 place-items-center rounded-full text-ink-2 transition hover:bg-fill lg:hidden" aria-label="Search"><IconSearch className="h-[18px] w-[18px]" /></button>
                <div className="relative lg:hidden">
                  <button onClick={() => setMe(!me)} aria-label="Account"><Avatar initials={initials} /></button>
                  {me && <Account user={user} ai={!!status?.ai} onSignOut={signOut} onClose={() => setMe(false)} className="right-0 top-11" />}
                </div>
              </div>
            </div>
          </header>

          <main key={pathname} className="rise mx-auto max-w-[1180px] px-4 pb-28 pt-8 sm:px-8 lg:pb-16 lg:pt-10">{children}</main>
        </div>

        {/* iOS tab bar */}
        <nav className="material fixed inset-x-0 bottom-0 z-40 border-t border-rule pb-[env(safe-area-inset-bottom)] lg:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {links.filter((l) => TABS.includes(l.href)).map((n) => {
              const on = pathname === n.href;
              const I = n.icon;
              return (
                <Link key={n.href} href={n.href} className={`flex h-[52px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${on ? "text-accent" : "text-ink-3"}`}>
                  <span className="relative"><I className="h-6 w-6" />{badge(n.href) > 0 && <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] text-white">{badge(n.href)}</span>}</span>
                  {n.short}
                </Link>
              );
            })}
            <button onClick={() => setMore(true)} className={`flex h-[52px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${!TABS.includes(pathname) ? "text-accent" : "text-ink-3"}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              More
            </button>
          </div>
        </nav>

        {more && (
          <div className="fixed inset-0 z-50 bg-black/30 lg:hidden" onClick={() => setMore(false)}>
            <div className="sheet-in absolute inset-x-0 bottom-0 rounded-t-[14px] bg-paper px-4 pb-10 pt-2" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-4 h-[5px] w-9 rounded-full bg-ink-3/40" />
              <div className="grouped">
                {links.filter((l) => !TABS.includes(l.href)).map((n) => {
                  const I = n.icon;
                  return (
                    <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex items-center gap-3 px-4 py-3">
                      <I className="h-[22px] w-[22px] text-accent" />
                      <span className="flex-1"><span className="block text-[16px]">{n.label}</span><span className="block text-[12px] text-ink-3">{n.note}</span></span>
                      <Chevron />
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {spot && <Spotlight links={links} isAdmin={user.role === "admin"} busy={running} onClose={() => setSpot(false)} refresh={refresh} />}
      </div>
    </AppCtx.Provider>
  );
}

export function AppIcon({ small }: { small?: boolean }) {
  return (
    <span className={`grid place-items-center bg-gradient-to-b from-[#3a8dff] to-[#0060df] text-white shadow-[0_1px_2px_rgba(0,0,0,.2),inset_0_0.5px_0_rgba(255,255,255,.35)] ${small ? "h-7 w-7 rounded-[7px]" : "h-8 w-8 rounded-[8px]"}`}>
      <svg viewBox="0 0 24 24" className={small ? "h-4 w-4" : "h-[18px] w-[18px]"} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M6 7.5h5M6 12h9M6 16.5h12" /></svg>
    </span>
  );
}

function Avatar({ initials }: { initials: string }) {
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[12px] font-semibold text-white">{initials}</span>;
}

export function Chevron() {
  return <svg viewBox="0 0 8 14" className="h-3.5 w-2 text-ink-3/70" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 1.5L6.5 7l-5 5.5" /></svg>;
}

function Spin() {
  return <span className="block h-5 w-5 animate-spin rounded-full border-2 border-ink-3/25 border-t-ink-3" />;
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "auto") { root.removeAttribute("data-theme"); localStorage.removeItem("cw-theme"); }
  else { root.setAttribute("data-theme", t); localStorage.setItem("cw-theme", t); }
}

function Account({ user, ai, onSignOut, onClose, className }: { user: User; ai: boolean; onSignOut: () => void; onClose: () => void; className: string }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === "undefined") return "auto";
    const t = document.documentElement.dataset.theme;
    return t === "light" || t === "dark" ? t : "auto";
  });
  const pick = (t: Theme) => {
    setTheme(t);
    try {
      applyTheme(t);
    } catch { /* storage may be blocked */ }
  };
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`pop absolute z-50 w-72 rounded-2xl bg-sheet p-4 text-sm shadow-[var(--shadow-pop)] ${className}`}>
        <div className="text-[15px] font-semibold leading-tight">{user.name}</div>
        <div className="mt-0.5 text-[13px] text-ink-3">{ROLE_LABEL[user.role]}{user.department ? ` · ${user.department}` : ""}</div>
        <div className="mt-4 text-[12px] font-semibold text-ink-3">Appearance</div>
        <div className="seg mt-1.5 w-full">
          {(["auto", "light", "dark"] as Theme[]).map((t) => <button key={t} onClick={() => pick(t)} className={`flex-1 capitalize ${theme === t ? "bg-accent" : ""}`}>{t}</button>)}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-3">{ai ? "The AI helper is on. It drafts and rewords; the planning engine makes every decision." : "The AI helper is off. Everything runs on the planning engine's own rules."}</p>
        <button onClick={onSignOut} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-fill py-2 text-[13px] font-medium text-ink transition hover:bg-fill/70"><IconOut className="h-4 w-4" /> Switch desk</button>
      </div>
    </>
  );
}

/** Dynamic Island: a black capsule that reports what the engine is doing, and grows when it is busy. */
function Island({ status, engineDown }: { status: Status | null; engineDown: string | null }) {
  const running = status?.job?.status === "running";
  const [open, setOpen] = useState(false);
  let tone = "bg-[#30d158]";
  let text = "Connecting";
  if (engineDown) { tone = "bg-[#ff453a]"; text = "Engine offline"; }
  else if (running) { tone = "bg-[#ff9f0a]"; text = status?.job.kind === "repair" ? "Finding the gentlest fix" : "Planning the week"; }
  else if (status?.timetable) {
    const waiting = status.pending_bookings + status.pending_changes;
    text = waiting ? `${waiting} waiting for review` : "All clear";
    if (waiting) tone = "bg-[#0a84ff]";
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className={`glass-dark relative flex h-8 items-center gap-2 overflow-hidden rounded-full text-[12.5px] font-medium transition-all duration-500 [transition-timing-function:var(--ease-spring)] ${running ? "pl-3 pr-4" : "pl-3 pr-3.5"}`}>
        {running && <span className="shimmer absolute inset-0" />}
        <span className="relative flex h-2 w-2">
          {(running || engineDown) && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone} opacity-70`} />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
        </span>
        <span className="relative whitespace-nowrap">{text}{running && "…"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="pop absolute left-1/2 top-10 z-50 w-[min(84vw,340px)] -translate-x-1/2 rounded-[22px] bg-black p-4 text-[13px] leading-relaxed text-white/75 shadow-2xl">
            {engineDown ? <>The planning engine isn&apos;t answering. Start it with <code className="font-mono text-white">uvicorn app.main:app --port 8000</code> in the engine folder.</>
              : running ? (status?.job.kind === "repair" ? "Moving as few classes as possible around the change. Every page updates by itself." : "Placing classes, midsems and Spectra venues. About a minute; every page fills in by itself.")
              : status?.timetable ? <><span className="block text-[15px] font-semibold text-white">{status.sessions} classes · {status.exams} midsem papers</span>Built in {status.solve.seconds}s and proven the best possible. {status.approved} Spectra events confirmed; {status.applied_changes} change{status.applied_changes === 1 ? "" : "s"} published since.</>
              : "Waiting for the first plan."}
          </div>
        </>
      )}
    </div>
  );
}

/** Spotlight: jump anywhere, or run an admin action, from the keyboard. */
function Spotlight({ links, isAdmin, busy, onClose, refresh }: { links: Nav[]; isAdmin: boolean; busy: boolean; onClose: () => void; refresh: () => Promise<void> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  type Item = { label: string; note: string; icon: Icon; go: () => void; kind: string };
  const items: Item[] = useMemo(() => {
    const pages: Item[] = links.map((n) => ({ label: n.label, note: n.note, icon: n.icon, kind: "Page", go: () => router.push(n.href) }));
    const acts: Item[] = isAdmin && !busy ? [
      { label: "Plan again from scratch", note: "Rebuild the whole week, about a minute", icon: IconRefresh, kind: "Action", go: () => { api("/generate", {}).then(refresh); } },
      { label: "Reset demo", note: "Back to the starting plan and requests", icon: IconRefresh, kind: "Action", go: () => { api("/reset", {}).then(refresh); } },
    ] : [];
    const all = [...pages, ...acts];
    const t = q.trim().toLowerCase();
    return t ? all.filter((x) => `${x.label} ${x.note}`.toLowerCase().includes(t)) : all;
  }, [q, links, isAdmin, busy, router, refresh]);
  const pick = (x?: Item) => { if (!x) return; x.go(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[16vh]" onClick={onClose}>
      <div className="pop w-full max-w-[640px] overflow-hidden rounded-[18px] shadow-[var(--shadow-pop)]" style={{ background: "color-mix(in srgb, var(--surface) 93%, transparent)", backdropFilter: "saturate(180%) blur(50px)", WebkitBackdropFilter: "saturate(180%) blur(50px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3">
          <IconSearch className="h-[22px] w-[22px] text-ink-3" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(v + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
              if (e.key === "Enter") pick(items[i]);
            }}
            placeholder="Spotlight Search" className="flex-1 !bg-transparent text-[22px] font-light !shadow-none outline-none" />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto border-t border-rule p-1.5">
          {items.length === 0 && <li className="p-6 text-center text-ink-3">No results for “{q}”</li>}
          {items.map((x, k) => {
            const I = x.icon;
            return (
              <li key={x.label}>
                <button onMouseMove={() => setI(k)} onClick={() => pick(x)} className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left ${k === i ? "bg-accent text-white" : ""}`}>
                  <I className={`h-5 w-5 ${k === i ? "text-white" : "text-accent"}`} />
                  <span className="flex-1 text-[14px]">{x.label} <span className={k === i ? "text-white/70" : "text-ink-3"}>— {x.note}</span></span>
                  <span className={`text-[11px] ${k === i ? "text-white/70" : "text-ink-3"}`}>{x.kind}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function Dots() {
  return <Spin />;
}
