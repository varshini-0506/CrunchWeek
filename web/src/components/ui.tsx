"use client";

import { useEffect, useRef, useState } from "react";

/** A floating pane of liquid glass. */
export function Card({ title, kicker, children, actions, className = "" }: { title?: React.ReactNode; kicker?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-[18px] p-5 sm:p-6 ${className}`}>
      {(title || actions || kicker) && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            {kicker && <div className="text-[12px] font-semibold text-ink-3">{kicker}</div>}
            {title && <h2 className="font-display text-[19px] font-semibold leading-tight tracking-[-0.012em]">{title}</h2>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Page hero: an eyebrow, a large tight headline and a soft standfirst. */
export function PageHead({ kicker, title, children, actions }: { no?: string; kicker: string; title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div className="max-w-3xl">
        <div className="text-[14px] font-semibold text-ink-3">{kicker}</div>
        <h1 className="mt-1 font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.018em] sm:text-[44px]">{title}</h1>
        {children && <p className="mt-3 max-w-2xl text-[17px] leading-[1.47] text-ink-2">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Counts up to a number once, with an ease-out. */
export function CountUp({ to, ms = 1100 }: { to: number; ms?: number }) {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, ms]);
  return <span className="tabular">{v}</span>;
}

const RING: Record<string, [string, string]> = {
  accent: ["#fa114f", "#ff4f7b"], ok: ["#92e82a", "#b6ff3a"], warn: ["#ffc24a", "#ff8a00"],
  bad: ["#ff7a7a", "#ff2d55"], lake: ["#1eeaef", "#5ff7ff"], plum: ["#e08cff", "#bf5af2"],
};

/** An activity ring, Apple Watch style. */
export function Ring({ value, max, size = 76, stroke = 9, tone = "accent", children }: { value: number; max: number; size?: number; stroke?: number; tone?: keyof typeof RING; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  const id = `g${tone}${size}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={RING[tone][0]} /><stop offset="1" stopColor={RING[tone][1]} /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING[tone][1]} strokeOpacity={0.14} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - frac)} className="ring-arc" style={{ ["--len" as string]: len }} />
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  );
}

/** A big number with a plain-language line under it. */
export function Stat({ label, value, hint, tone = "ink" }: { label: string; value: React.ReactNode; hint?: string; tone?: "ok" | "warn" | "bad" | "ink" | "accent" | "slate" | "green" | "amber" | "red" | "indigo" }) {
  const t: Record<string, string> = { ok: "text-ok", green: "text-ok", warn: "text-warn", amber: "text-warn", bad: "text-bad", red: "text-bad", ink: "text-ink", slate: "text-ink", accent: "text-accent", indigo: "text-accent" };
  return (
    <div className="glass rounded-[18px] px-5 py-4">
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className={`mt-1 font-display text-[34px] font-semibold leading-none tracking-[-0.02em] tabular ${t[tone]}`}>{value}</div>
      {hint && <div className="mt-2 text-xs leading-snug text-ink-2">{hint}</div>}
    </div>
  );
}

export function Button({ children, onClick, kind = "primary", disabled, type = "button", small }: { children: React.ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; type?: "button" | "submit"; small?: boolean }) {
  const k = {
    primary: "bg-accent text-white hover:brightness-[1.08]",
    secondary: "bg-fill text-accent hover:bg-fill/80",
    danger: "bg-bad-soft text-bad hover:bg-bad hover:text-white",
    ghost: "text-link hover:underline",
  }[kind];
  const pad = kind === "ghost" ? (small ? "text-[13px]" : "text-[15px]") : small ? "px-3 py-[3px] text-[13px]" : "px-[18px] py-[7px] text-[15px]";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-full font-normal transition-[filter,background-color,transform] duration-200 active:scale-[.97] disabled:opacity-35 disabled:active:scale-100 ${pad} ${k}`}>
      {children}{kind === "ghost" && <span aria-hidden className="text-[0.9em]">›</span>}
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

/** A status pill with a glowing dot. */
export function Badge({ s }: { s: string }) {
  return <span className={`stamp ${STAMP[s] ?? "text-ink-2"}`}>{STAMP_TEXT[s] ?? s.replaceAll("_", " ")}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const detail = (error as { detail?: { violations?: { rule: string; detail: string }[]; errors?: string[] } })?.detail;
  return (
    <div className="pop rounded-[14px] bg-bad-soft p-4 text-[14px] text-bad">
      <div className="font-medium">{msg}</div>
      {detail?.violations?.map((v, i) => <div key={i}>{v.detail}</div>)}
      {detail?.errors?.map((v, i) => <div key={i}>{v}</div>)}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[14px] bg-fill-2 p-8 text-center text-[15px] text-ink-3">{children}</div>;
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
