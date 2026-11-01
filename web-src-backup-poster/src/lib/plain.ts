// Engine reasons carry internal codes like "(P4-P5)", "BR-16" and "OAT". These turn them into plain sentences.

const ENDS: Record<number, string> = { 1: "09:00", 2: "10:00", 3: "11:00", 4: "12:00", 5: "13:00", 6: "15:00", 7: "16:00", 8: "17:00", 9: "18:00", 10: "19:00", 11: "20:00", 12: "21:00", 13: "22:00", 14: "23:00" };

export function hm(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** Room id -> name, from meta.rooms. */
export type RoomNames = Record<string, string>;
export const roomNames = (rooms?: { id: string; name: string }[]): RoomNames => Object.fromEntries((rooms ?? []).map((r) => [r.id, r.name]));

/** A reason in words. With `dropWhen`, the "X free Mon 11 am to 1 pm" sentence goes, for places that show venue and time already. */
export function plain(reason: string, rooms: RoomNames = {}, dropWhen = true) {
  const out = reason
    .replace(/\s*\((?:P\d+(?:-P\d+)?|BR-[\w]+)\)/g, "")
    .replace(/\bP(\d+)\b/g, (m, n: string) => (ENDS[+n] ? hm(ENDS[+n]) : m))
    .replace(/\b(?:Room )?([A-Z]{2,}(?:-[A-Z0-9]+)*(?:-\d+)?)\b/g, (m, c: string) => rooms[c] ?? m)
    .replace(/priority rank (\d+)/g, "number $1 in the priority order")
    .replace(/who has priority or asked first/g, "who comes earlier in the priority order")
    .replace(/(\b[\w ]+?) meets every need/g, "so it got $1 instead, which has everything it needs")
    .replace(/;\s*(\w)/g, (_, c: string) => `. ${c.toUpperCase()}`)
    .split(/(?<=\.)\s+/)
    .filter((x) => !dropWhen || !/ free (Mon|Tue|Wed|Thu|Fri|Sat) /.test(x))
    .join(" ");
  return out.replace(/\.?$/, ".");
}

/** "Mon 11 am to 1 pm (P4-P5)" -> "Mon 11 am to 1 pm". */
export const when = (w?: string) => (w ?? "").replace(/\s*\(P\d+(?:-P\d+)?\)/, "");

/** Turns an id like "P4" into a clock time. */
export const periodStart = (p: number) => hm(`${p <= 5 ? 7 + p : 8 + p}:00`);
