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

// ---------- Admin API (needs a SimplyBook user login; sees all bookings and hidden therapists) ----------
let adminCached = null;
export async function adminToken() {
  if (adminCached && adminCached.until > Date.now()) return adminCached.t;
  const t = await rpc(BASE + "/login", "getUserToken", [COMPANY, process.env.SIMPLYBOOK_ADMIN_LOGIN, process.env.SIMPLYBOOK_ADMIN_PASSWORD]);
  adminCached = { t, until: Date.now() + 30 * 60 * 1000 };
  return t;
}
export async function admin(method, params = []) {
  const t = await adminToken();
  return rpc(BASE + "/admin/", method, params, { "X-Company-Login": COMPANY, "X-User-Token": t });
}
// Non-cancelled bookings for one date (YYYY-MM-DD)
export async function bookingsOn(date) {
  const r = await admin("getBookings", [{ date_from: date, date_to: date, booking_type: "non_cancelled", order: "start_date" }]);
  return Array.isArray(r) ? r : Object.values(r || {});
}

// Book as the spa (admin), attached to an existing client id.
// Admin bookings are staff bookings, so SimplyBook doesn't treat them as unpaid online orders.
export async function adminBook({ serviceId, unitId, clientId, date, time, minutes, additional = {}, count = 1 }) {
  const t = time.length === 5 ? time + ":00" : time;
  const end = new Date(new Date(`${date}T${t}Z`).getTime() + Number(minutes) * 60000).toISOString();
  const res = await admin("book", [Number(serviceId), Number(unitId), Number(clientId), date, t, end.slice(0, 10), end.slice(11, 19), 0, additional, count]);
  const b = res?.bookings?.[0];
  if (!b?.id) throw new Error("SimplyBook didn't confirm the booking: " + JSON.stringify(res).slice(0, 150));
  if (res.require_confirm) { try { await admin("pluginApproveBookingApprove", [Number(b.id)]); } catch {} }
  return { booking_id: b.id, code: b.code };
}

// ---------- REST Admin API (v2): needed for payments and add-ons ----------
const REST = "https://user-api-v2.simplybook.me/admin";
let restCached = null;
export async function restToken() {
  if (restCached && restCached.until > Date.now()) return restCached.t;
  const res = await fetch(REST + "/auth", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ company: COMPANY, login: process.env.SIMPLYBOOK_ADMIN_LOGIN, password: process.env.SIMPLYBOOK_ADMIN_PASSWORD }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(`SimplyBook REST login ${res.status}: ${data.message || JSON.stringify(data).slice(0, 120)}`);
  restCached = { t: data.token, until: Date.now() + 30 * 60 * 1000 };
  return data.token;
}
// Returns { status, data } and never throws on HTTP errors, so callers can explain what happened.
export async function rest(method, path, body) {
  const t = await restToken();
  const res = await fetch(REST + path, {
    method, headers: { "content-type": "application/json", "X-Company-Login": COMPANY, "X-Token": t },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
