import { cookies } from "next/headers";
import { COOKIE, makeToken, readToken } from "@/lib/session";
import { findUser } from "@/lib/users";

export async function GET() {
  const store = await cookies();
  const user = readToken(store.get(COOKIE)?.value);
  return Response.json({ user: user ?? null });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: string };
  const user = findUser(body.username);
  if (!user) return Response.json({ error: "Unknown demo account" }, { status: 400 });
  const store = await cookies();
  store.set(COOKIE, makeToken(user.username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return Response.json({ user });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(COOKIE);
  return Response.json({ ok: true });
}
