import { engineGet } from "@/lib/engine";

type Health = { status: string; solver: string; dataset_id: string };
type Summary = Record<string, string | number>;

export async function GET() {
  try {
    const [health, summary] = await Promise.all([
      engineGet<Health>("/health"),
      engineGet<Summary>("/dataset/summary"),
    ]);
    return Response.json({ ok: true, health, summary });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Engine unreachable" },
      { status: 503 },
    );
  }
}
