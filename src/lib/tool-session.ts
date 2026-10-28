import crypto from "node:crypto";
import type { NextRequest } from "next/server";

export function authenticatedToolUser(req: NextRequest): string | null {
  try {
    const token = req.cookies.get("amazon_monitor_session")?.value;
    if (!token) return null;
    const [email, expiry, signature] = Buffer.from(token, "base64url").toString("utf8").split("|");
    if (!email || !expiry || !signature || !Number.isFinite(Number(expiry)) || Number(expiry) <= Date.now()) return null;
    const secret = process.env.SESSION_SECRET || process.env.BACKEND_API_KEY || "amazon-job-monitor-uk-session-secret";
    const expected = crypto.createHmac("sha256", secret).update(`${email}|${expiry}`).digest();
    const actual = Buffer.from(signature, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? email : null;
  } catch { return null; }
}
