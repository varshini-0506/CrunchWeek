import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { ENGINE_TOKEN, ENGINE_URL } from "@/lib/engine";
import { COOKIE, readToken } from "@/lib/session";

// The browser never talks to the engine directly: this route adds who is signed in.
async function forward(request: NextRequest, path: string[]) {
  const store = await cookies();
  const user = readToken(store.get(COOKIE)?.value);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers["x-user"] = user.username;
  if (ENGINE_TOKEN) headers["x-engine-token"] = ENGINE_TOKEN;
  const url = `${ENGINE_URL}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  try {
    const res = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ detail: `The scheduling engine is not reachable at ${ENGINE_URL}` }, { status: 502 });
  }
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/engine/[...path]">) {
  return forward(request, (await ctx.params).path);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/engine/[...path]">) {
  return forward(request, (await ctx.params).path);
}
