"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonSpinner } from "@/components/ui";
import { api, type Job, type Meta } from "@/lib/api";
import { ROLE_LABEL, type User } from "@/lib/users";
import { IconBook, IconBox, IconChat, IconOut, IconPen, IconPulse, IconRefresh, IconSearch, IconShield, IconSpark, IconSwap, IconToday, IconWeek } from "./icons";

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
  { href: "/proof", label: "Proof", short: "Proof", note: "Why no plan can score better", icon: IconShield, group: "Insight" },
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

  // After moving to another page, let go of focus so the menu that was used closes.
  useEffect(() => { (document.activeElement as HTMLElement | null)?.blur?.(); }, [pathname]);

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
  const here = links.find((l) => l.href === pathname);
  const initials = user.name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  const badge = (href: string) => (href === "/spectra" ? status?.pending_bookings : href === "/changes" ? status?.pending_changes : 0) || 0;

  return (
    <AppCtx.Provider value={{ user, meta, status, version, refresh, engineDown }}>
      <div className="flex min-h-screen flex-col overflow-x-clip">
        {/* Top bar: logo, status and account, with the page row underneath. */}
        <header className="material sticky top-0 z-30 border-b border-rule">
          <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-4 sm:px-8">
            <Link href="/" className="group/logo flex items-center gap-2.5">
              <span className="transition-transform duration-500 [transition-timing-function:var(--ease-spring)] group-hover/logo:rotate-[-8deg] group-hover/logo:scale-110"><AppIcon /></span>
              <span className="hidden items-baseline gap-3 leading-none sm:flex"><span className="font-poster text-[26px] uppercase tracking-[0.01em]">CrunchWeek</span><span className="hidden text-[13px] font-medium text-ink-3 xl:block">Chilika Institute of Technology</span></span>
            </Link>
            <span className="truncate text-[15px] font-semibold sm:hidden">{here?.label ?? ""}</span>
            <div className="ml-auto flex items-center gap-2">
              <Island status={status} engineDown={engineDown} />
              <button onClick={() => setSpot(true)} className="grid h-8 w-8 place-items-center rounded-full text-ink-2 transition hover:bg-fill lg:hidden" aria-label="Search"><IconSearch className="h-[18px] w-[18px]" /></button>
              <div className="relative">
                <button onClick={() => setMe(!me)} aria-label="Account" className="flex items-center gap-2 rounded-full transition hover:opacity-90 active:scale-95"><Avatar initials={initials} /></button>
                {me && <Account user={user} ai={!!status?.ai} onSignOut={signOut} onClose={() => setMe(false)} className="right-0 top-11" />}
              </div>
            </div>
          </div>
          <NavRow links={links} pathname={pathname} badge={badge} onSearch={() => setSpot(true)} />
        </header>

        <main key={pathname} className="rise mx-auto w-full max-w-[1280px] flex-1 px-4 pb-16 pt-8 sm:px-8 lg:pt-10">{NAV.some((n) => n.href === pathname && n.roles && !n.roles.includes(user.role)) ? (
          <div className="glass mx-auto mt-10 max-w-[560px] rounded-[8px] p-8 text-center">
            <h1 className="font-poster text-[32px] uppercase leading-none">Not for this desk</h1>
            <p className="mt-3 text-ink-2">Your desk can&apos;t use this page. Switch desk from the round badge at the top right if you need it.</p>
            <Link href="/" className="mt-5 inline-block rounded-[6px] bg-accent px-4 py-2 font-semibold text-white">Back to Today</Link>
          </div>
        ) : children}</main>

        {/* The poster's sign-off: the name, edge to edge. */}
        <footer className="overflow-hidden bg-[#0e1a1d] px-4 pb-24 pt-8 text-[#f7f9f8] sm:px-8 lg:pb-6">
          <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-x-8 gap-y-1 text-[14px]">
            <span className="font-semibold">Chilika Institute of Technology</span>
            <span className="opacity-75">Week 7 · planned with Google OR-Tools, checked by the organisers&apos; own validator</span>
          </div>
          <p aria-hidden className="font-poster mt-4 whitespace-nowrap text-center text-[18.6vw] uppercase leading-[0.8] text-[#c0330f]">CrunchWeek</p>
        </footer>

        {/* iOS tab bar */}
        <nav className="material fixed inset-x-0 bottom-0 z-40 border-t border-rule pb-[env(safe-area-inset-bottom)] lg:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {links.filter((l) => TABS.includes(l.href)).map((n) => {
              const on = pathname === n.href;
              const I = n.icon;
              return (
                <Link key={n.href} href={n.href} className={`flex h-[52px] flex-col items-center justify-center gap-0.5 text-[13px] font-medium ${on ? "text-accent" : "text-ink-3"}`}>
                  <span className="relative"><I className="h-6 w-6" />{badge(n.href) > 0 && <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[13px] text-white">{badge(n.href)}</span>}</span>
                  {n.short}
                </Link>
              );
            })}
            <button onClick={() => setMore(true)} className={`flex h-[52px] flex-col items-center justify-center gap-0.5 text-[13px] font-medium ${!TABS.includes(pathname) ? "text-accent" : "text-ink-3"}`}>
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
                      <I className="h-[22px] w-[22px] text-ink-3" />
                      <span className="flex-1"><span className="block text-[15px]">{n.label}</span><span className="block text-[13px] text-ink-3">{n.note}</span></span>
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

/** Two rounded squares, the second offset: a booking that found its own slot. */
export function AppIcon({ small }: { small?: boolean }) {
  const box = small ? "h-[15px] w-[15px]" : "h-4 w-4";
  return (
    <span className={`relative block shrink-0 ${small ? "h-[22px] w-[22px]" : "h-6 w-6"}`} aria-hidden>
      <span className={`absolute left-0 top-0 rounded-[4px] border-[1.5px] border-ink ${box}`} />
      <span className={`absolute bottom-0 right-0 rounded-[4px] bg-accent ${box}`} />
    </span>
  );
}

function Avatar({ initials }: { initials: string }) {
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0e1a1d] text-[13px] font-semibold text-[#f7f9f8]">{initials}</span>;
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

function Account({ user, ai, onSignOut, onClose, className }: { user: User; ai: boolean; onSignOut: () => void | Promise<unknown>; onClose: () => void; className: string }) {
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
        <div className="mt-4 text-[13px] font-semibold text-ink-3">Appearance</div>
        <div className="seg mt-1.5 w-full">
          {(["auto", "light", "dark"] as Theme[]).map((t) => <button key={t} onClick={() => pick(t)} className={`flex-1 capitalize ${theme === t ? "bg-accent" : ""}`}>{t}</button>)}
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{ai ? "The AI helper is on. It drafts and rewords; the planning engine makes every decision." : "The AI helper is off. Everything runs on the planning engine's own rules."}</p>
        <Button kind="secondary" onClick={onSignOut} className="mt-4 w-full justify-center rounded-xl py-2 font-medium"><IconOut className="h-4 w-4" /> Switch desk</Button>
      </div>
    </>
  );
}

/** Dynamic Island: a black capsule that reports what the engine is doing, and grows when it is busy. */
function Island({ status, engineDown }: { status: Status | null; engineDown: string | null }) {
  const running = status?.job?.status === "running";
  const [open, setOpen] = useState(false);
  let tone = "bg-jade";
  let text = "Connecting";
  if (engineDown) { tone = "bg-bad"; text = "Engine offline"; }
  else if (running) { tone = "bg-brass"; text = status?.job.kind === "repair" ? "Finding the gentlest fix" : "Planning the week"; }
  else if (status?.timetable) {
    const waiting = status.pending_bookings + status.pending_changes;
    text = waiting ? `${waiting} waiting for review` : "All clear";
    if (waiting) tone = "bg-accent";
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className={`relative flex h-8 items-center gap-2 overflow-hidden rounded-full border border-[var(--edge)] bg-sheet text-[13px] font-medium text-ink-2 transition-[padding,color] duration-300 hover:text-ink ${running ? "pl-3 pr-4" : "pl-3 pr-3.5"}`}>
        {running && <span className="shimmer absolute inset-0" />}
        <span className="relative flex h-2 w-2">
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
        </span>
        <span className="relative whitespace-nowrap">{text}{running && "…"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="pop absolute right-0 top-10 z-50 w-[min(84vw,340px)] rounded-[14px] bg-sheet p-4 text-[13px] leading-relaxed text-ink-2 shadow-[var(--shadow-pop)]">
            {engineDown ? <>The planning engine isn&apos;t answering. Start it with <code className="font-mono text-ink">uvicorn app.main:app --port 8000</code> in the engine folder.</>
              : running ? (status?.job.kind === "repair" ? "Moving as few classes as possible around the change. Every page updates by itself." : "Placing classes, midsems and Spectra venues. About a minute; every page fills in by itself.")
              : status?.timetable ? <><span className="block text-[15px] font-semibold text-ink">{status.sessions} classes · {status.exams} midsem papers</span>Planned in {Math.round(status.solve.seconds ?? 0)} seconds, the best plan possible under the rules. {status.approved} Spectra events confirmed; {status.applied_changes} change{status.applied_changes === 1 ? "" : "s"} published since.</>
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
  const [working, setWorking] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  type Item = { label: string; note: string; icon: Icon; go: () => void | Promise<unknown>; kind: string };
  const items: Item[] = useMemo(() => {
    const pages: Item[] = links.map((n) => ({ label: n.label, note: n.note, icon: n.icon, kind: "Page", go: () => router.push(n.href) }));
    const acts: Item[] = isAdmin && !busy ? [
      { label: "Plan again from scratch", note: "Rebuild the whole week, about a minute", icon: IconRefresh, kind: "Action", go: () => api("/generate", {}).then(refresh) },
      { label: "Reset demo", note: "Back to the starting plan and requests", icon: IconRefresh, kind: "Action", go: () => api("/reset", {}).then(refresh) },
    ] : [];
    const all = [...pages, ...acts];
    const t = q.trim().toLowerCase();
    return t ? all.filter((x) => `${x.label} ${x.note}`.toLowerCase().includes(t)) : all;
  }, [q, links, isAdmin, busy, router, refresh]);
  const pick = async (x?: Item) => {
    if (!x || working) return;
    const result = x.go();
    try {
      if (result && typeof (result as Promise<unknown>).then === "function") {
        setWorking(x.label);
        await result;
      }
      onClose();
    } catch { /* leave search open if the action failed */ }
    finally { setWorking(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[16vh]" onClick={onClose}>
      <div className="pop w-full max-w-[640px] overflow-hidden rounded-[18px] shadow-[var(--shadow-pop)]" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3">
          <IconSearch className="h-[22px] w-[22px] text-ink-3" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(v + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
              if (e.key === "Enter") pick(items[i]);
            }}
            placeholder="Search pages and actions" className="flex-1 !bg-transparent text-[17px] !shadow-none outline-none" />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto border-t border-rule p-1.5">
          {items.length === 0 && <li className="p-6 text-center text-ink-3">No results for “{q}”</li>}
          {items.map((x, k) => {
            const I = x.icon;
            return (
              <li key={x.label}>
                <button disabled={!!working} onMouseMove={() => setI(k)} onClick={() => pick(x)} className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left disabled:cursor-wait ${k === i ? "bg-fill" : ""}`}>
                  <I className={`h-5 w-5 ${k === i ? "text-ink" : "text-ink-3"}`} />
                  <span className="flex-1 text-[14px]">{x.label} <span className="text-ink-3">· {x.note}</span></span>
                  {working === x.label ? <ButtonSpinner /> : <span className="text-[13px] text-ink-3">{x.kind}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Every page in one row. Under the cursor the items swell like a magnifying glass passing over them:
    the one you point at grows most, its neighbours a little, and the rest stay put. */
const ANIM: Record<string, string> = {
  "/": "spin", "/timetable": "flip", "/exams": "wiggle", "/spectra": "twinkle", "/request": "bob",
  "/changes": "swap", "/insights": "beat", "/exports": "lift", "/audit": "tilt", "/proof": "beat",
};

/** The page row: the sidebar's groups laid out in one line. A soft pill glides to whatever
 *  you point at and settles back on the current page; each icon has its own small gesture. */
function NavRow({ links, pathname, badge, onSearch }: { links: Nav[]; pathname: string; badge: (href: string) => number; onSearch: () => void }) {
  const row = useRef<HTMLDivElement>(null);
  const items = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [pill, setPill] = useState<{ x: number; w: number; on: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const groups = [...new Set(links.map((l) => l.group))];

  const zoom = useRef<Record<string, number>>({});
  const hoverRef = useRef<string | null>(null);
  useEffect(() => { hoverRef.current = hover; }, [hover]);
  const raf = useRef(0);

  // Pill geometry comes from layout boxes (offsetLeft/Width), scaled by the item's current
  // magnification, so it tracks the lens without waiting for transitions.
  const measure = useCallback((href: string | null) => {
    const el = href ? items.current[href] : null;
    if (!el) { setPill(null); return; }
    const z = zoom.current[href!] ?? 1;
    const w = el.offsetWidth * z;
    setPill({ x: el.offsetLeft - (w - el.offsetWidth) / 2, w, on: href === pathname });
  }, [pathname]);

  // Dock-style lens: every link swells by how close the pointer is, with soft smoothstep edges,
  // and neighbours part to make room.
  const lens = useCallback((x: number | null) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const reach = 130, grow = 0.32;
      for (const [href, el] of Object.entries(items.current)) {
        if (!el) continue;
        let k = 0;
        if (x !== null) {
          const r = el.getBoundingClientRect();
          k = Math.max(0, 1 - Math.abs(x - (r.left + r.width / 2)) / reach);
          k = k * k * (3 - 2 * k);
        }
        const z = 1 + grow * k;
        zoom.current[href] = z;
        el.style.setProperty("--z", z.toFixed(3));
        el.style.setProperty("--spread", `${((z - 1) * el.offsetWidth * 0.5).toFixed(1)}px`);
      }
      measure(hoverRef.current ?? pathname);
    });
  }, [measure, pathname]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useEffect(() => {
    const t = setTimeout(() => measure(hover ?? pathname), 0);
    const onResize = () => measure(hover ?? pathname);
    window.addEventListener("resize", onResize);
    return () => { clearTimeout(t); window.removeEventListener("resize", onResize); };
  }, [hover, pathname, measure]);

  return (
    <div className="mx-auto hidden max-w-[1280px] px-4 pb-1 sm:px-8 lg:block">
      <div ref={row} onPointerMove={(e) => lens(e.clientX)} onPointerLeave={() => { setHover(null); lens(null); }} className="navrow relative flex items-center gap-1 pb-1.5 pt-1">
        {pill && (
          <span aria-hidden className={`navpill absolute top-1 h-9 rounded-[10px] ${pill.on && !hover ? "bg-fill" : "bg-fill-2"}`}
            style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />
        )}
        <button onClick={onSearch} onPointerEnter={() => setHover(null)} onTransitionEnd={() => measure(hover ?? pathname)} className="navsearch group relative z-[1] mr-2 flex h-9 items-center gap-2 rounded-[10px] bg-fill px-3 text-[13px] text-ink-3 transition-colors hover:text-ink">
          <IconSearch className="h-[15px] w-[15px] transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110" />
          <span>Search</span>
          <kbd className="navkbd overflow-hidden whitespace-nowrap rounded border border-[var(--edge)] bg-sheet px-1.5 font-sans text-[12px] text-ink-3">Ctrl K</kbd>
        </button>
        {groups.map((g, gi) => (
          <div key={g} className="flex items-center gap-1">
            {gi > 0 && <span aria-hidden className="mx-1.5 h-5 w-px bg-rule" />}
            {links.filter((l) => l.group === g).map((n) => {
              const on = pathname === n.href;
              const I = n.icon;
              const b = badge(n.href);
              return (
                <Link key={n.href} href={n.href} ref={(el) => { items.current[n.href] = el; }}
                  onPointerEnter={() => setHover(n.href)} onFocus={(e) => { setHover(n.href); const r = e.currentTarget.getBoundingClientRect(); lens(r.left + r.width / 2); }} onBlur={() => { setHover(null); lens(null); }}
                  aria-current={on ? "page" : undefined} data-anim={ANIM[n.href]}
                  className={`navitem group relative flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-[14px] ${on ? "font-semibold text-ink" : "text-ink-2 hover:text-ink"}`}>
                  <span className={`navicon ${on ? "text-accent" : "text-ink-3 group-hover:text-ink"}`}><I className="h-[17px] w-[17px]" /></span>
                  <span className="whitespace-nowrap"><span className="2xl:hidden">{n.short}</span><span className="hidden 2xl:inline">{n.label}</span></span>
                  {b > 0 && <span key={b} className="navbadge grid h-[18px] min-w-[18px] place-items-center rounded-full bg-bad px-1 text-[12px] font-semibold text-white">{b}</span>}
                  <span aria-hidden className={`navdot absolute -bottom-[5px] left-1/2 h-[3px] -translate-x-1/2 rounded-full bg-accent ${on ? "w-4 opacity-100" : "w-0 opacity-0"}`} />
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dots() {
  return <Spin />;
}
