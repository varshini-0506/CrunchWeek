export const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8000";

export async function engineGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ENGINE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Engine ${path} returned ${res.status}`);
  return (await res.json()) as T;
}
