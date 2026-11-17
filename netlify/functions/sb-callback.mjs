// SimplyBook calls this address whenever a booking is created, changed or cancelled.
// We read the booking's details with the company keys we already have (no admin login needed)
// and keep a per-day list that the payroll robot uses.
import { createHash } from "node:crypto";
import { call } from "../lib/simplybook.mjs";
import { pstore } from "../lib/payroll.mjs";

export default async (req) => {
  let d = {};
  const txt = await req.text();
  try { d = JSON.parse(txt); } catch { d = Object.fromEntries(new URLSearchParams(txt)); }
  const id = d.booking_id || d.id, hash = d.booking_hash || d.hash, type = d.notification_type || d.type || "";
  if (!id || !hash) return new Response("ok");
  if (d.company && d.company !== "theartspatulum") return new Response("ok");
  const s = pstore();
  try {
    const sign = createHash("md5").update(String(id) + hash + process.env.SIMPLYBOOK_SECRET_KEY).digest("hex");
    const b = await call("getBookingDetails", [Number(id), sign]);
    const start = String(b.start_date_time || b.start_date || "");
    const end = String(b.end_date_time || b.end_date || "");
    const date = start.slice(0, 10);
    const rec = {
      id: String(id), start, end,
      event: b.event_name || b.event || "",
      unit: b.unit_name || b.unit || "",
      client: b.client_name || b.client || "",
      cancelled: /cancel/i.test(type) || String(b.is_confirmed) === "0" && /cancel/i.test(String(b.status || "")),
      updated: new Date().toISOString(),
    };
    // remove from any day it was on before (rescheduled bookings move days)
    const where = await s.get("bkday-" + id);
    if (where && where !== date) {
      const old = (await s.get("bk-" + where, { type: "json" })) || {};
      delete old[id]; await s.setJSON("bk-" + where, old);
    }
    const day = (await s.get("bk-" + date, { type: "json" })) || {};
    if (rec.cancelled) delete day[id]; else day[id] = rec;
    await s.setJSON("bk-" + date, day);
    await s.set("bkday-" + id, date);
    await s.setJSON("sb-last-callback", { at: new Date().toISOString(), type, event: rec.event, unit: rec.unit, date });
  } catch (e) {
    await s.setJSON("sb-last-callback", { at: new Date().toISOString(), type, error: String(e.message).slice(0, 200) });
  }
  return new Response("ok");
};
