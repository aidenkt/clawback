// ramp sandbox client. no creds = simulated mode
const BASE = process.env.RAMP_API_BASE ?? "https://demo-api.ramp.com";
const SCOPES = process.env.RAMP_SCOPES ?? "bills:read bills:write vendors:read vendors:write";

export const rampConfigured = () => Boolean(process.env.RAMP_CLIENT_ID && process.env.RAMP_CLIENT_SECRET);

let cached: { token: string; exp: number; scope: string } | null = null;

export async function rampToken(): Promise<{ token: string; scope: string }> {
  if (cached && cached.exp > Date.now() + 30_000) return cached;
  const basic = Buffer.from(`${process.env.RAMP_CLIENT_ID}:${process.env.RAMP_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/developer/v1/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Ramp token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, scope: j.scope ?? SCOPES };
  return cached;
}

export async function ramp<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await rampToken();
  const res = await fetch(`${BASE}/developer/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...init.headers },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ramp ${init.method ?? "GET"} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
