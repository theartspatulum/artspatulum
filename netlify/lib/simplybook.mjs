// Talks to SimplyBook's booking API (JSON-RPC) with the spa's API key.
const COMPANY = "theartspatulum";
const BASE = "https://user-api.simplybook.me";

async function rpc(url, method, params, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(`SimplyBook ${method}: ${data.error.message || JSON.stringify(data.error)}`);
  return data.result;
}

let cached = null;
export async function token() {
  if (cached && cached.until > Date.now()) return cached.t;
  const t = await rpc(BASE + "/login", "getToken", [COMPANY, process.env.SIMPLYBOOK_API_KEY]);
  cached = { t, until: Date.now() + 30 * 60 * 1000 };
  return t;
}

export async function call(method, params = []) {
  const t = await token();
  return rpc(BASE, method, params, { "X-Company-Login": COMPANY, "X-Token": t });
}

export const services = () => call("getEventList");
export const therapists = () => call("getUnitList");
// Free start times for a service on given dates: { "2026-11-14": ["10:00:00", ...] }
export const freeTimes = (from, to, serviceId, unitId = null, count = 1) =>
  call("getStartTimeMatrix", [from, to, serviceId, unitId, count]);
