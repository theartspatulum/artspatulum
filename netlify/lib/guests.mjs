// Guest records for bookings made by the robot.
// Rules (from Leon): first + last name, a real email, and the guest's WhatsApp
// number WITH its country code (+1, +52, +44...). Never assume +52.
// Returning guests are found in SimplyBook first, so we never create duplicates.
import { admin } from "./simplybook.mjs";

// "+1 (305) 433-3445" -> "+13054333445". Returns null if there is no country code.
export function normPhone(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  s = s.replace(/[\s().\-\/]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!/^\+\d{8,15}$/.test(s)) return null;
  return s;
}
export const hasPhone = (raw) => /\d{6,}/.test(String(raw || "").replace(/\D/g, ""));
const digits = (s) => String(s || "").replace(/\D/g, "");

export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || "").trim());

// "maria  LOPEZ garcia" -> "Maria Lopez Garcia"; null if not at least first + last name
export function fullName(raw) {
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((p) => p.charAt(0).toLocaleUpperCase() + p.slice(1).toLocaleLowerCase()).join(" ");
}

const asList = (r) => (Array.isArray(r) ? r : Object.values(r || {}));
const clean = (c) => ({ id: Number(c.id), name: String(c.name || "").trim(), email: String(c.email || "").trim(), phone: String(c.phone || "").trim() });

async function search(q) {
  if (!q) return [];
  try { return asList(await admin("getClientList", [q, 20])).map(clean).filter((c) => c.id); } catch { return []; }
}

// Same phone if all digits match, or the last 10 digits match (SimplyBook sometimes stores
// numbers with or without the country code / Mexico's old "1").
function samePhone(a, b) {
  const x = digits(a), y = digits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

// Look for an existing guest. Phone first, then email, then exact full name.
// Returns { match } (one guest), { many: [...] } (need to pick), or {} (new guest).
export async function findGuest({ phone, email, name }) {
  const p = normPhone(phone);
  if (p) {
    const hits = (await search(digits(p).slice(-10))).filter((c) => samePhone(c.phone, p));
    if (hits.length === 1) return { match: hits[0] };
    if (hits.length > 1) return { many: hits };
  }
  if (validEmail(email)) {
    const e = email.trim().toLowerCase();
    const hits = (await search(e)).filter((c) => c.email.toLowerCase() === e);
    if (hits.length === 1) return { match: hits[0] };
    if (hits.length > 1) return { many: hits };
  }
  const n = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (n.includes(" ")) {
    const hits = (await search(n)).filter((c) => c.name.toLowerCase().replace(/\s+/g, " ") === n);
    if (hits.length === 1) return { match: hits[0] };
    if (hits.length > 1) return { many: hits };
  }
  return {};
}

// Create the guest in SimplyBook (if SimplyBook already has this exact record it returns that id).
export async function createGuest({ name, email, phone }) {
  const id = await admin("addClient", [{ name, email, phone }]);
  if (!id) throw new Error("SimplyBook didn't return a client id");
  return Number(id);
}
