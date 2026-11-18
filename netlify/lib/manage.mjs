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
      system: `The spa owner wants to ${mode === "move" ? "move (reschedule) an existing booking" : "cancel an existing booking"}. Now in Tulum: ${tulumNow()} (today is ${today()}). Read the message (English or Spanish, loose wording). Dates as YYYY-MM-DD ("tomorrow", "Friday" = the next one). Times as 24h HH:MM ("3pm" = 15:00).${mode === "move" ? ' The CURRENT booking time comes first, the NEW time usually after "to", "a", "para" or "→". If the owner wants a different therapist ("with Rosi", "con Rosi", "assign to Rosi", "change therapist to Rosi"), put that name in new_therapist; leave new_date/new_time empty if only the therapist changes.' : ""}\nReply with JSON only: {"name": "", "phone": "exactly as written", "email": "", "code": "booking code if given", "date": "current booking date or empty", "time": "current booking time or empty"${mode === "move" ? ', "new_date": "", "new_time": "", "new_therapist": ""' : ""}}. Leave fields empty if not given; never invent anything.`,
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

// SimplyBook isn't consistent about field names; read the start "YYYY-MM-DD HH:MM" from whatever is there
function startOf(b) {
  for (const v of [b.start_date_time, b.start_datetime, b.start_date, b.start]) {
    const x = String(v || "");
    if (x.length >= 16) return x.replace("T", " ").slice(0, 16);
  }
  const d = String(b.start_date || b.date || "").slice(0, 10), t = String(b.start_time || b.time || "").slice(0, 5);
  return d && t ? `${d} ${t}` : d;
}
const nameOf = (b) => String(b.client_name || b.client || b.client_full_name || "");

// Find the booking the owner means. Returns { one } | { many } | { none: reason }
async function findBooking(q) {
  const from = q.date || today(), to = q.date || addDays(today(), 90);
  const base = { date_from: from, date_to: to, booking_type: "non_cancelled", order: "start_date" };
  let guest = null;
  if (!q.code && (q.phone || q.email || q.name)) {
    const g = await findGuest(q);
    if (g.many) return { none: "several guests match that name. Use their WhatsApp number or email." };
    guest = g.match || null;
    if (!guest && !q.name) return { none: "I couldn't find that guest in SimplyBook." };
  }
  const wantName = String(guest?.name || q.name || "").toLowerCase().trim();
  // By client id first; if SimplyBook ignores/rejects that filter, fall back to the date range + name
  let list = [];
  if (guest) { try { list = asList(await admin("getBookings", [{ ...base, client_id: guest.id }])); } catch {} }
  if (!list.length) list = asList(await admin("getBookings", [base]));
  const all = list.length;
  const code = String(q.code || "").trim().toLowerCase();
  if (code) list = list.filter((b) => String(b.code || "").toLowerCase() === code);
  else if (wantName) list = list.filter((b) => (guest && String(b.client_id) === String(guest.id)) || nameOf(b).toLowerCase().includes(wantName));
  const forGuest = list.length;
  const t = String(q.time || "").slice(0, 5);
  const timesSeen = list.map((b) => startOf(b).slice(11, 16)).filter(Boolean);
  if (t) list = list.filter((b) => startOf(b).slice(11, 16) === t);
  if (!list.length) {
    const when = q.date ? `on ${nice(q.date)}` : "in the next 90 days";
    if (!all) return { none: `SimplyBook shows no active bookings ${when}.` };
    if (!forGuest) return { none: `I see ${all} booking(s) ${when}, but none for ${code ? "that code" : esc(guest?.name || q.name)}.` };
    return { none: `${esc(guest?.name || q.name)} has ${forGuest} booking(s) ${when}, but not at ${t} (times: ${timesSeen.join(", ") || "unknown"}).` };
  }
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
  if (mode === "move" && !q.new_therapist && (!q.new_date || !q.new_time)) {
    await send(d.chat, "What's the <b>new date and time</b> or the <b>new therapist</b>? Examples:\n<b>/move Vic Tore tomorrow 5pm to Friday 3pm</b>\n<b>/assign Vic Tore tomorrow 5pm to Rosi</b>");
    return;
  }
  const f = await findBooking(q);
  if (f.none) { await send(d.chat, `🔎 ${f.none}`); return; }
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

  // move / reassign: check the new slot, keep or change the therapist
  const nd = q.new_date || b.date, nt = (q.new_time || b.time).slice(0, 5);
  const sameSlot = nd === b.date && nt === b.time;
  const all = Object.values((await therapists()) || {});
  const name = (id) => all.find((u) => String(u.id) === String(id))?.name || `#${id}`;
  if (!sameSlot) {
    const free = ((await freeTimes(b.serviceId, nd)) || {})[nd] || [];
    if (!free.includes(nt)) {
      const alt = free.slice(0, 6).join(", ");
      await send(d.chat, `❌ ${esc(b.service)} isn't free on ${nice(nd)} at ${nt}.${alt ? `\nFree that day: <b>${alt}</b>` : ""}\n\nSend /move again with another time.`);
      return;
    }
  }
  const avail = ((await call("getAvailableUnits", [b.serviceId, `${nd} ${nt}:00`, 1])) || []).map(String);
  if (sameSlot) avail.push(String(b.unitId)); // the booking's own therapist is "busy" only with this booking
  let unitId = b.unitId, therapist = b.therapist, note = "";
  if (q.new_therapist) {
    const want = all.find((u) => String(u.name || "").toLowerCase().includes(q.new_therapist.toLowerCase().trim()));
    if (!want) { await send(d.chat, `🤔 I don't know a therapist called <b>${esc(q.new_therapist)}</b>. Therapists: ${all.map((u) => esc(u.name)).join(", ")}`); return; }
    if (!avail.includes(String(want.id))) {
      const others = [...new Set(avail)].filter((x) => String(x) !== String(b.unitId) || !sameSlot).map(name);
      await send(d.chat, `❌ <b>${esc(want.name)}</b> isn't free on ${nice(nd)} at ${nt}.${others.length ? `\nFree then: <b>${others.map(esc).join(", ")}</b>` : ""}`);
      return;
    }
    unitId = Number(want.id); therapist = want.name;
    if (sameSlot && String(unitId) === String(b.unitId)) { await send(d.chat, `👍 ${esc(therapist)} is already assigned to this booking. Nothing to change.`); return; }
  } else if (!avail.includes(String(unitId))) {
    if (!avail.length) { await send(d.chat, `❌ No therapist is free on ${nice(nd)} at ${nt}.`); return; }
    unitId = Number(avail[0]); therapist = name(unitId);
    note = `\n⚠️ ${esc(b.therapist)} isn't free then, so the therapist changes to <b>${esc(therapist)}</b>.`;
  }
  await cstore().setJSON("mgreq-" + id, { mode, booking: b, newDate: nd, newTime: nt, unitId, therapist });
  await send(d.chat, `🔁 <b>${sameSlot ? "Change the therapist?" : "Move this booking?"}</b>\nFrom: ${line(b)}\nTo: <b>${nice(nd)} ${nt}</b> · 💆 <b>${esc(therapist)}</b>${note}\n\nNothing changes until you tap ✅.`,
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
  await send(d.chat, `🔁 <b>Updated in SimplyBook</b>\n${esc(b.service)} · ${esc(b.client)}\n${nice(b.date)} ${b.time} → <b>${nice(r.newDate)} ${r.newTime}</b> · 💆 ${esc(r.therapist)}`);
}
