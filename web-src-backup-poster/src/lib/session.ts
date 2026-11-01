import { createHmac, timingSafeEqual } from "node:crypto";
import { findUser, type User } from "./users";

export const COOKIE = "cw_session";
const SECRET = process.env.SESSION_SECRET ?? "dev-only-secret-change-me";

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

export function makeToken(username: string): string {
  return `${username}.${sign(username)}`;
}

export function readToken(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const i = token.lastIndexOf(".");
  if (i < 1) return undefined;
  const name = token.slice(0, i);
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(sign(name));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return findUser(name);
}
