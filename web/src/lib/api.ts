"use client";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : (detail as { message?: string })?.message ?? `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/engine${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.detail ?? data);
  return data as T;
}

export const DAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
export const DAY_NAME: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday",
};

export function periodHour(p: number): number {
  return p <= 5 ? 7 + p : 8 + p;
}

export function fmtHour(h: number): string {
  if (h === 12) return "12 pm";
  if (h === 24) return "12 am";
  return h > 12 ? `${h - 12} pm` : `${h} am`;
}

export function periodLabel(p: number): string {
  return `${fmtHour(periodHour(p))}`;
}

export function slotText(day: string, start: number, end?: number): string {
  const e = end ?? start;
  return `${DAY_NAME[day] ?? day} ${fmtHour(periodHour(start))} to ${fmtHour(periodHour(e) + 1)}`;
}

export type Violation = { rule: string; detail: string; sessions?: string[] };

export type SessionRow = {
  session_id: string; course_id: string; title?: string; kind: string; groups: string[];
  faculty_id: string; faculty_name: string; size: number; duration: number; day: string;
  start_period: number; room_id: string; basket_slot: string | null; fixed: boolean;
  override_by?: string | null; recently_moved?: boolean;
};

export type Decision = {
  request_id: string; status: "approved" | "alternative_offered" | "rejected";
  day?: string; start_period?: number; end_period?: number; room_id?: string; reason: string;
};

export type BookingRequest = {
  id: string; submitted_at: string; requester: string; role: string; department: string | null;
  requested_category: string; title: string; attendance: number; duration_periods: number;
  windows: { day: string; from_period: number; to_period: number }[]; room_types: string[]; needs: string[];
  requested_room: string | null; mandatory_for_groups: string[]; raw_text?: string;
};

export type BookingRow = {
  request: BookingRequest; decision: Decision | null; state: "decided" | "pending" | "cancelled" | "turned_down";
  effective_category: string; category_label: string; mine: boolean; confirmed: boolean;
  can_approve: boolean; can_cancel: boolean; when?: string;
  explain: { rank?: number; notes?: string[]; blocked_by?: string[]; moved_sessions?: string[] };
};

export type Meta = {
  dataset: Record<string, number | string>;
  calendar: { days: string[]; exam_week: { days: string[]; sessions: { id: string; start: string; end: string }[] } };
  priority_order: string[]; category_label: Record<string, string>;
  rooms: { id: string; name: string; type: string; capacity: number; features: string[]; accessible: boolean; building: string }[];
  faculty: { id: string; name: string; department: string }[];
  groups: { id: string; name: string; size: number }[];
  courses: { id: string; title: string }[];
  rules: Record<string, string>; ai: boolean;
};

export type Job = { kind?: string; status: "idle" | "running" | "done" | "failed"; seconds?: number; error?: string;
  result?: Record<string, unknown> };
