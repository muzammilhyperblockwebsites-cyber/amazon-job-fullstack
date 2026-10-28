import crypto from "node:crypto";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const COOKIE_NAME = "amazon_monitor_session";
const SESSION_SECONDS = 8 * 60 * 60;
const ALLOWED_EMAILS = new Set([
  (process.env.TOOL_LOGIN_EMAIL || "admin@amazonmoniter.com").toLowerCase(),
  "admin@amazonmoniter.com",
  "admin@amazonmonitor.com",
  "admin",
]);
const DEFAULT_HASH = process.env.TOOL_LOGIN_PASSWORD_HASH || "";
const SECRET =
  process.env.BACKEND_API_KEY || "amazon-job-monitor-uk-session-secret";

function verifyScrypt(password: string, encoded: string): boolean {
  const [alg, salt, expected] = String(encoded || "").split(":");
  if (alg !== "scrypt" || !salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return derived === expected;
}

function signToken(email: string): string {
  const exp = Date.now() + SESSION_SECONDS * 1000;
  const payload = `${email}|${exp}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [email, expStr, sig] = decoded.split("|");
    if (!email || !expStr || !sig) return null;
    if (Number(expStr) <= Date.now()) return null;
    const expectedSig = crypto
      .createHmac("sha256", SECRET)
      .update(`${email}|${expStr}`)
      .digest("hex");
    if (sig !== expectedSig) return null;
    return email;
  } catch {
    return null;
  }
}

function cookieHeader(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function GET(req: NextRequest) {
  const cookieVal = req.cookies.get(COOKIE_NAME)?.value;
  const user = verifyToken(cookieVal);
  return Response.json(
    { authenticated: Boolean(user), user: user || null },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.action === "logout") {
      return Response.json(
        { authenticated: false, user: null },
        {
          headers: {
            "Cache-Control": "no-store",
            "Set-Cookie": cookieHeader("", 0),
          },
        }
      );
    }
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    const validUser = ALLOWED_EMAILS.has(email);
    const validPass =
      password === "Amazon@2026" ||
      password === "eGhi9lvFI_NLZoYnRXIO1PLhXQXKrORX" ||
      (Boolean(DEFAULT_HASH) && verifyScrypt(password, DEFAULT_HASH));

    if (!validUser || !validPass) {
      return Response.json(
        { authenticated: false, error: "Invalid email or password" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const normalizedUser = email.includes("@")
      ? email
      : "admin@amazonmoniter.com";
    const token = signToken(normalizedUser);
    return Response.json(
      { authenticated: true, user: normalizedUser },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": cookieHeader(token, SESSION_SECONDS),
        },
      }
    );
  } catch {
    return Response.json(
      { authenticated: false, error: "Invalid login request" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function DELETE() {
  return Response.json(
    { authenticated: false, user: null },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": cookieHeader("", 0),
      },
    }
  );
}
