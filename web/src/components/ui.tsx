"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

/** A content card. The title leads; `note` is an optional caption under it (never an eyebrow above it). */
export function Card({ title, note, children, actions, className = "" }: { title?: React.ReactNode; note?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-[8px] p-5 sm:p-6 ${className}`}>
      {(title || actions || note) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && <h2 className="font-poster text-[24px] uppercase leading-[0.95] tracking-[0.005em]">{title}</h2>}
            {note && <p className="mt-1 text-[13px] leading-snug text-ink-3">{note}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* Each page opens on its own poster field, like a section of the Spectra poster. Colours from the landing page. */
const BAND: Record<string, string> = {
  "/": "band-lake", "/timetable": "band-brass", "/exams": "band-mint", "/spectra": "band-sky", "/request": "band-brass",
  "/changes": "band-lake", "/insights": "band-mint", "/proof": "band-sky", "/exports": "band-brass", "/audit": "band-lake",
};

/** Page header: a full-width poster field. The headline states the page's answer, a standfirst explains it, `meta` carries facts like the date. */
export function PageHead({ title, children, actions, meta }: { title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode }) {
  const band = BAND[usePathname()] ?? "band-lake";
  return (
    <header className={`band ${band} relative mx-[calc(50%-50vw)] -mt-8 mb-8 overflow-hidden lg:-mt-10`}>
      <svg aria-hidden viewBox="0 0 200 200" className="band-sun pointer-events-none absolute -bottom-24 right-[-40px] h-[300px] w-[300px] sm:right-[6vw]">
        <defs><clipPath id="sun-cut"><circle cx="100" cy="100" r="100" /></clipPath></defs>
        <g clipPath="url(#sun-cut)" fill="currentColor">
          <rect x="0" y="0" width="200" height="104" />
          {[116, 134, 152, 170, 188].map((y, i) => <rect key={y} x="0" y={y} width="200" height={10 - i * 1.4} />)}
        </g>
      </svg>
      <div className="relative mx-auto flex max-w-[1280px] flex-wrap items-end justify-between gap-6 px-4 pb-10 pt-10 sm:px-8 sm:pb-12 sm:pt-14">
        <div className="max-w-[880px]">
          <h1 className="poster-line font-poster text-[clamp(42px,6vw,92px)] uppercase leading-[0.9] tracking-[-0.005em] text-balance">{title}</h1>
          {children && <p className="poster-line mt-4 max-w-[68ch] text-[17px] font-medium leading-[1.5] [animation-delay:90ms]">{children}</p>}
          {meta && <p className="poster-line mt-3 text-[14px] text-ink-2 tabular [animation-delay:140ms]">{meta}</p>}
        </div>
        {actions && <div className="poster-line relative flex flex-wrap gap-2 [animation-delay:180ms]">{actions}</div>}
      </div>
    </header>
  );
}

/** A counted figure. App screens don't perform entrances, so it is shown as it is (kept as a component so callers don't change). */
export function CountUp({ to }: { to: number; ms?: number }) {
  return <span className="tabular">{to}</span>;
}

export function Button({ children, onClick, kind = "primary", disabled, type = "button", small }: { children: React.ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; type?: "button" | "submit"; small?: boolean }) {
  const k = {
    primary: "bg-accent text-white hover:brightness-[1.08] disabled:bg-fill disabled:text-ink-3 disabled:hover:brightness-100",
    secondary: "bg-fill text-ink hover:bg-fill/70 disabled:text-ink-3",
    danger: "bg-bad-soft text-bad hover:bg-bad hover:text-white disabled:hover:bg-bad-soft disabled:hover:text-bad",
    ghost: "text-link hover:underline disabled:text-ink-3",
  }[kind];
  const pad = kind === "ghost" ? (small ? "text-[13px]" : "text-[15px]") : small ? "px-3 py-1 text-[13px]" : "px-4 py-2 text-[14px]";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-[6px] font-semibold transition-[filter,background-color,transform] duration-150 active:scale-[.98] disabled:cursor-not-allowed disabled:active:scale-100 disabled:opacity-70 ${pad} ${k}`}>
      {children}{kind === "ghost" && <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>}
    </button>
  );
}

const STAMP: Record<string, string> = {
  approved: "text-ok", alternative_offered: "text-warn", rejected: "text-bad", pending: "text-lake",
  cancelled: "text-ink-3", turned_down: "text-bad", proposed: "text-lake", infeasible: "text-bad", applied: "text-ok",
};
const STAMP_TEXT: Record<string, string> = {
  approved: "Confirmed", alternative_offered: "Other slot", rejected: "Declined", pending: "Awaiting", cancelled: "Withdrawn",
  turned_down: "Declined", proposed: "For review", infeasible: "No fix", applied: "Published",
};

/** A status pill: a dot and a word, in the status colour. */
export function Badge({ s }: { s: string }) {
  return <span className={`stamp ${STAMP[s] ?? "text-ink-2"}`}>{STAMP_TEXT[s] ?? s.replaceAll("_", " ")}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const detail = (error as { detail?: { violations?: { rule: string; detail: string }[]; errors?: string[] } })?.detail;
  return (
    <div className="pop mb-5 rounded-[12px] bg-bad-soft p-4 text-[14px] text-bad">
      <div className="font-medium">{msg}</div>
      {detail?.violations?.map((v, i) => <div key={i}>{v.detail}</div>)}
      {detail?.errors?.map((v, i) => <div key={i}>{v}</div>)}
    </div>
  );
}

/** An empty state that says what will appear here and how it gets here. */
export function Empty({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) {
  return (
    <div className="rounded-[14px] bg-fill-2 px-6 py-8 text-center">
      {title && <div className="text-[15px] font-medium text-ink">{title}</div>}
      <div className={`mx-auto max-w-[52ch] text-[14px] leading-relaxed ${title ? "mt-1 text-ink-2" : "text-ink-3"}`}>{children}</div>
    </div>
  );
}

export function Spinner({ label = "Fetching from the engine…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-4 text-sm text-ink-3">
      <span className="relative h-4 w-4">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-ink-3/25 border-t-ink-3" />
      </span>
      <span>{label}</span>
    </div>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}
