// /cancel and /move from Telegram: find an existing SimplyBook booking, show it, act only after ✅.
import { send, esc } from "./telegram.mjs";
import { cstore, freeTimes } from "./concierge.mjs";
import { admin, call, therapists } from "./simplybook.mjs";
import { findGuest } from "./guests.mjs";

const tulumNow = () => new Date().toLocaleString("en-US", { timeZone: "America/Cancun", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Cancun" });
const addDays = (d, n) => new Date(new Date(d + "T12:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const asList = (r) => (Array.isArray(r) ? r : Object.values(r || {}));

// Read the owner's message: who, which booking, and (for /move) the new time.
async function understand(text, mode) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 300,
      system: `The spa owner wants to ${mode === "move" ? "move (reschedule) an existing booking" : "cancel an existing booking"}. Now in Tulum: ${tulumNow()} (today is ${today()}). Read the message (English or Spanish, loose wording). Dates as YYYY-MM-DD ("tomorrow", "Friday" = the next one). Times as 24h HH:MM ("3pm" = 15:00).${mode === "move" ? ' The CURRENT booking time comes first, the NEW time usually after "to", "a", "para" or "→".' : ""}\nReply with JSON only: {"name": "", "phone": "exactly as written", "email": "", "code": "booking code if given", "date": "current booking date or empty", "time": "current booking time or empty"${mode === "move" ? ', "new_date": "", "new_time": ""' : ""}}. Leave fields empty if not given; never invent anything.`,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const raw = ((await res.json()).content || []).map((c) => c.text || "").join("");
  try { return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { return {}; }
}

// Full details for one booking, in one shape we can rely on
async function details(id) {
  const b = await admin("getBookingDetails", [Number(id)]);
  const start = String(b.start_date_time || b.start_date || "");
  const end = String(b.end_date_time || b.end_date || "");
  return {
    id: Number(b.id || id), code: b.code || "",
    serviceId: Number(b.event_id), service: b.event_name || "",
    unitId: Number(b.unit_id), therapist: b.unit_name || "",
    clientId: Number(b.client_id), client: b.client_name || "",
    date: start.slice(0, 10), time: start.slice(11, 16),
    minutes: Math.round((new Date(end.replace(" ", "T") + "Z") - new Date(start.replace(" ", "T") + "Z")) / 60000) || 60,
  };
}

const line = (b) => `${nice(b.date)} ${b.time} · ${esc(b.service)} · ${esc(b.client)} · 💆 ${esc(b.therapist)}${b.code ? " · code " + esc(b.code) : ""}`;

// Find the booking the owner means. Returns { one } | { many } | { none: reason }
async function findBooking(q) {
  const from = q.date || today(), to = q.date || addDays(today(), 90);
  const filter = { date_from: from, date_to: to, booking_type: "non_cancelled", order: "start_date" };
  let clientName = "";
  if (!q.code && (q.phone || q.email || q.name)) {
    const g = await findGuest(q);
    if (g.many) return { none: "several guests match that name. Use their WhatsApp number or email." };
    if (g.match) filter.client_id = g.match.id;
    else clientName = String(q.name || "").toLowerCase();
    if (!g.match && !clientName) return { none: "I couldn't find that guest in SimplyBook." };
  }
  let list = asList(await admin("getBookings", [filter]));
  const code = String(q.code || "").trim().toLowerCase();
  if (code) list = list.filter((b) => String(b.code || "").toLowerCase() === code);
  if (clientName) list = list.filter((b) => String(b.client_name || b.client || "").toLowerCase().includes(clientName));
  const t = String(q.time || "").slice(0, 5);
  if (t) list = list.filter((b) => String(b.start_date || b.start_date_time || b.start || "").slice(11, 16) === t);
  if (!list.length) return { none: "I couldn't find a matching booking." };
  const full = await Promise.all(list.slice(0, 6).map((b) => details(b.id)));
  return full.length === 1 ? { one: full[0] } : { many: full };
}

export async function prepareManage(d, mode) {
  const q = await understand(d.text, mode);
  if (!q.code && !q.name && !q.phone && !q.email) {
    await send(d.chat, mode === "move"
      ? "Which booking? Example: <b>/move Vic Tore tomorrow 5pm to Friday 3pm</b>"
      : "Which booking? Example: <b>/cancel Vic Tore tomorrow 5pm</b> (or the booking code)");
    return;
  }
  if (mode === "move" && (!q.new_date || !q.new_time)) {
    await send(d.chat, "What's the <b>new date and time</b>? Example: <b>/move Vic Tore tomorrow 5pm to Friday 3pm</b>");
    return;
  }
  const f = await findBooking(q);
  if (f.none) { await send(d.chat, `🔎 ${esc(f.none)}`); return; }
  if (f.many) {
    await send(d.chat, `👥 I found ${f.many.length} bookings:\n${f.many.map((b) => "• " + line(b)).join("\n")}\n\nSend it again with the <b>date and time</b> (or the code) so I pick the right one.`);
    return;
  }
  const b = f.one;
  const id = Date.now().toString(36);

  if (mode === "cancel") {
    await cstore().setJSON("mgreq-" + id, { mode, booking: b });
    await send(d.chat, `🗑️ <b>Cancel this booking?</b>\n${line(b)}\n\nNothing changes until you tap ✅.`,
      { reply_markup: { inline_keyboard: [[{ text: "✅ Yes, cancel it", callback_data: `mgok:${id}` }, { text: "↩️ Keep it", callback_data: `mgno:${id}` }]] } });
    return;
  }

  // move: check the new time is free for this service, keep the same therapist if possible
  const nt = q.new_time.slice(0, 5), nd = q.new_date;
  const free = ((await freeTimes(b.serviceId, nd)) || {})[nd] || [];
  const avail = ((await call("getAvailableUnits", [b.serviceId, `${nd} ${nt}:00`, 1])) || []).map(String);
  if (!free.includes(nt) || !avail.length) {
    const alt = free.slice(0, 6).join(", ");
    await send(d.chat, `❌ ${esc(b.service)} isn't free on ${nice(nd)} at ${nt}.${alt ? `\nFree that day: <b>${alt}</b>` : ""}\n\nSend /move again with another time.`);
    return;
  }
  let unitId = b.unitId, therapist = b.therapist, note = "";
  if (!avail.includes(String(unitId))) {
    unitId = Number(avail[0]);
    therapist = Object.values((await therapists()) || {}).find((u) => String(u.id) === String(unitId))?.name || `#${unitId}`;
    note = `\n⚠️ ${esc(b.therapist)} isn't free then, so the therapist changes to <b>${esc(therapist)}</b>.`;
  }
  await cstore().setJSON("mgreq-" + id, { mode, booking: b, newDate: nd, newTime: nt, unitId, therapist });
  await send(d.chat, `🔁 <b>Move this booking?</b>\nFrom: ${line(b)}\nTo: <b>${nice(nd)} ${nt}</b> · 💆 ${esc(therapist)}${note}\n\nNothing changes until you tap ✅.`,
    { reply_markup: { inline_keyboard: [[{ text: "✅ Yes, move it", callback_data: `mgok:${id}` }, { text: "↩️ Keep as is", callback_data: `mgno:${id}` }]] } });
}

export async function confirmManage(d) {
  const s = cstore();
  const r = await s.get("mgreq-" + d.id, { type: "json" });
  if (!r) { await send(d.chat, "That request expired or was already used. Send it again."); return; }
  await s.delete("mgreq-" + d.id); // one tap = one action
  const b = r.booking;
  if (r.mode === "cancel") {
    await admin("cancelBooking", [b.id]);
    await send(d.chat, `🗑️ <b>Cancelled in SimplyBook</b>\n${line(b)}`);
    return;
  }
  const end = new Date(new Date(`${r.newDate}T${r.newTime}:00Z`).getTime() + b.minutes * 60000).toISOString();
  const res = await admin("editBook", [b.id, b.serviceId, r.unitId, b.clientId, r.newDate, r.newTime + ":00", end.slice(0, 10), end.slice(11, 19), 0, {}]);
  if (!res) throw new Error("SimplyBook didn't accept the new time");
  await send(d.chat, `🔁 <b>Moved in SimplyBook</b>\n${esc(b.service)} · ${esc(b.client)}\n${nice(b.date)} ${b.time} → <b>${nice(r.newDate)} ${r.newTime}</b> · 💆 ${esc(r.therapist)}`);
}
