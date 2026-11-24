// Payroll for The Art Spa Tulum: commission rules, daily calculation, tips, expenses.
// Rules come from Leon (Nov 2026). Change them here; every amount is in MXN.
import { getStore } from "@netlify/blobs";
import { bookingsOn } from "./simplybook.mjs";

export const pstore = () => getStore("payroll");
export const REBECA_WEEKLY_BASE = 2000;
export const FREELANCERS = ["Azar", "Liliana", "Rosi", "Leydi", "Hellen"];

const isRebeca = (n) => /rebec/i.test(n || "");
const minsBucket = (m) => (m >= 85 ? 90 : m >= 70 ? 75 : m >= 45 ? 60 : 30);

// Rebeca's commission by treatment family and length
const REBECA = [
  { re: /sauna/i, flat: 0, label: "Sauna (no commission)" },
  { re: /reset ritual/i, flat: 200, fl: 500 },
  { re: /glow ritual/i, flat: 200 },
  { re: /^\s*(the\s+)?couples? ritual\s*$/i, flat: 200, fl: 500, couple: true },   // two 60-min massages + free sauna
  { re: /couple/i, flat: 350, fl: 700, couple: true },                              // all other couples rituals
  { re: /cocoa embrace|clay wrap|rose ritual|pure hydration/i, flat: 350, fl: 700 },
  { re: /lymph/i, by: { 60: 300, 75: 350, 90: 400 } },
  { re: /honey|ayurved/i, flat: 250 },
  { re: /deep tissue|muscle recovery|hot stone|mayan clay|sobada/i, by: { 60: 250, 75: 300, 90: 350 } },
  { re: /facial|ear candl/i, by: { 30: 100, 60: 200, 75: 250, 90: 300 } },
  { re: /aroma|cacao|cocoa|candle|rose petal|relax/i, by: { 60: 200, 75: 250, 90: 300 } },
  { re: /ritual/i, flat: 350 },
];
// Freelancers: by length; 120-min rituals (incl. 30 min sauna) pay as 90
const FL_BY = { 60: 500, 75: 600, 90: 700 };

// Rituals include free sauna time that therapists are NOT paid for.
// Glow Ritual includes 15 min sauna; other rituals (and couples rituals) include 30 min.
export function treatmentMinutes(service, mins) {
  if (/sauna/i.test(service) && !/ritual/i.test(service)) return mins;          // Sauna & Pool: no therapist anyway
  if (/sauna\s*&\s*face mask/i.test(service)) return mins;                    // no commission anyway
  if (/glow ritual/i.test(service)) return Math.max(mins - 15, 0);
  if (/ritual/i.test(service)) return Math.max(mins - 30, 0);
  return mins;
}

function rule(name) { return REBECA.find((r) => r.re.test(name)) || null; }

function amountFor(therapist, service, bookedMins) {
  const mins = treatmentMinutes(service, bookedMins);
  const r = rule(service);
  if (r && r.flat === 0) return { amount: 0, note: "no commission" };
  if (isRebeca(therapist)) {
    if (!r) return { amount: 0, note: "⚠️ no rule for this treatment, please edit" };
    if (r.flat != null) return { amount: r.flat };
    const b = minsBucket(mins); return r.by[b] != null ? { amount: r.by[b] } : { amount: 0, note: `⚠️ no rate for ${b} min` };
  }
  if (r && r.fl != null) return { amount: r.fl };
  const b = minsBucket(mins);
  if (b === 30) return { amount: 0, note: "⚠️ no freelancer rate for 30 min, please edit" };
  const note = /facial/i.test(service) ? "⚠️ freelancer facial: check rate" : "";
  return { amount: FL_BY[b], note };
}

// Build the day's lines from SimplyBook bookings
export async function computeDay(date) {
  // Bookings collected from SimplyBook's notifications (no admin login needed);
  // falls back to the admin login if one works.
  let raw = Object.values((await pstore().get("bk-" + date, { type: "json" })) || {});
  if (!raw.length && process.env.SIMPLYBOOK_ADMIN_LOGIN) { try { raw = await bookingsOn(date); } catch {} }
  const lines = [];
  for (const bk of raw) {
    const service = bk.event || bk.event_name || bk.service || "";
    const therapist = bk.unit || bk.unit_name || bk.provider || "Unassigned";
    const start = String(bk.start || bk.start_date || ""), end = String(bk.end || bk.end_date || "");
    const mins = Math.round((new Date(end.replace(" ", "T")) - new Date(start.replace(" ", "T"))) / 60000) || 60;
    const time = start.slice(11, 16);
    const client = (bk.client || bk.client_name || "").toString().split(" ")[0];
    const a = amountFor(therapist, service, mins);
    // Rebeca works Mon–Thu 10–19 and Fri 10–16; outside that it should be a freelancer
    const wd = new Date(date + "T12:00:00").getDay(); // 0 Sun … 6 Sat
    const offShift = isRebeca(therapist) && (wd === 0 || wd === 6 || (wd === 5 && time >= "16:00") || time >= "19:00");
    const note = [a.note, offShift ? "⚠️ Rebeca isn't on shift then: should this be a freelancer?" : ""].filter(Boolean).join(" · ");
    const paidMins = treatmentMinutes(service, mins);
    const note2 = [note, paidMins !== mins ? `paid ${paidMins} min (sauna not paid)` : ""].filter(Boolean).join(" · ");
    lines.push({ booking: bk.id, time, service, mins, therapist, client, amount: a.amount, note: note2 });
    if (rule(service)?.couple) {
      const fl = amountFor("FL", service, mins);
      lines.push({ booking: bk.id, time, service, mins, therapist: "FL", client, amount: fl.amount, note: "second therapist (couples, freelancer)" });
    }
  }
  return lines;
}

export function summarize(lines) {
  const by = {};
  for (const l of lines) by[l.therapist] = (by[l.therapist] || 0) + l.amount;
  return by;
}
const money = (n) => "$" + Number(n).toLocaleString("en-US");
export function dayText(date, lines, tips = []) {
  if (!lines.length) return `🧾 <b>Payroll ${date}</b>\nNo bookings found for this day.`;
  const rows = lines.map((l, i) => `${i + 1}. ${l.time} · ${esc(l.therapist)} · ${esc(l.service)} (${l.mins} min) → <b>${money(l.amount)}</b>${l.note ? " <i>" + esc(l.note) + "</i>" : ""}`).join("\n");
  const tot = summarize(lines);
  for (const t of tips) tot[t.name] = (tot[t.name] || 0) + t.amount;
  const totals = Object.entries(tot).map(([k, v]) => `• ${esc(k)}: <b>${money(v)}</b>`).join("\n");
  const tipsTxt = tips.length ? "\n\n💵 Tips: " + tips.map((t) => `${esc(t.name)} ${money(t.amount)}`).join(", ") : "";
  return `🧾 <b>Payroll ${date}</b>\n\n${rows}${tipsTxt}\n\n<b>Totals (commission + tips)</b>\n${totals}`;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const tulumDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Cancun" });
export const dayKeyboard = (date) => ({ inline_keyboard: [[{ text: "✅ Approve", callback_data: `pyok:${date}` }, { text: "✏️ Edit", callback_data: `pyed:${date}` }]] });

// Totals owed since a date (approved days + tips), optionally for one person
export async function owed(fromDate, toDate, filter = () => true) {
  const s = pstore(); const out = {};
  for (let d = new Date(fromDate + "T12:00:00"); d <= new Date(toDate + "T12:00:00"); d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    const day = await s.get("day-" + key, { type: "json" });
    if (!day || day.status !== "approved") continue;
    for (const l of day.lines) if (filter(l.therapist)) out[l.therapist] = (out[l.therapist] || 0) + l.amount;
    for (const t of day.tips || []) if (filter(t.name)) out[t.name] = (out[t.name] || 0) + t.amount;
  }
  return out;
}
export { isRebeca, money, amountFor };
