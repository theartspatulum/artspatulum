// /book from Telegram: reads Leon's message, checks SimplyBook, asks for ✅, then books.
// step "prepare": understand + check availability + send summary with buttons
// step "confirm": create the booking in SimplyBook
import { send, esc, webhookSecret } from "../lib/telegram.mjs";
import { catalog, freeTimes, bookReal, cstore } from "../lib/concierge.mjs";
import { call, therapists } from "../lib/simplybook.mjs";

const tulumNow = () => new Date().toLocaleString("en-US", { timeZone: "America/Cancun", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Cancun" });
const addDays = (d, n) => new Date(new Date(d + "T12:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const nice = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const money = (n) => (n ? "$" + Number(n).toLocaleString("en-US") + " MXN" : "");

async function understand(text, list) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 500,
      system: `The spa owner wants to create a booking. Now in Tulum: ${tulumNow()} (today is ${today()}). Read the message (English or Spanish, loose wording) and pick the treatment from this list by id, matching name AND length (if no length is given, use the 60-minute version, or the only version):\n${list.map((s) => `${s.id}: ${s.name} (${s.minutes} min)`).join("\n")}\nDates as YYYY-MM-DD ("tomorrow", "Friday" = the next one). Times as 24h HH:MM ("3pm" = 15:00). Leave fields empty if not given; never invent a phone or email.\nReply with JSON only: {"service_id": number or null, "date": "YYYY-MM-DD" or "", "time": "HH:MM" or "", "name": "", "phone": "", "email": "", "therapist": "" (only if the owner asked for one), "people": number (default 1), "missing": "what is missing or unclear, a few words, or empty"}`,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const out = await res.json();
  const raw = (out.content || []).map((c) => c.text || "").join("");
  try { return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { return { missing: "I couldn't read that" }; }
}

async function prepare(d) {
  const list = await catalog();
  const b = await understand(d.text, list);
  const svc = list.find((s) => s.id === Number(b.service_id));
  const need = [];
  if (!svc) need.push("which treatment");
  if (!b.date) need.push("the date");
  if (!b.time) need.push("the time");
  if (!b.name) need.push("the guest's name");
  if (need.length) {
    await send(d.chat, `🤔 I still need ${need.join(", ")}.${b.missing ? " (" + esc(b.missing) + ")" : ""}\n\nExample: <b>/book Maria, Deep Tissue 90, tomorrow 3pm, +52 984 123 4567</b>`);
    return;
  }
  const time = b.time.slice(0, 5);
  const free = (await freeTimes(svc.id, b.date)) || {};
  const times = free[b.date] || [];

  if (!times.includes(time)) {
    // Suggest the 3 nearest free times that day, or look at the next days
    const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    let alt = [...times].sort((a, b2) => Math.abs(mins(a) - mins(time)) - Math.abs(mins(b2) - mins(time))).slice(0, 3).sort();
    let altTxt = alt.length ? `Free that day: <b>${alt.join(", ")}</b>` : "";
    if (!alt.length) {
      const next = await freeTimes(svc.id, addDays(b.date, 1), addDays(b.date, 3));
      altTxt = Object.entries(next || {}).filter(([, t]) => t.length).slice(0, 2).map(([day, t]) => `${nice(day)}: <b>${t.slice(0, 4).join(", ")}</b>`).join("\n") || "Nothing free in the next 3 days.";
    }
    await send(d.chat, `❌ <b>${esc(svc.name)}</b> isn't free on ${nice(b.date)} at ${time}.\n${altTxt}\n\nSend /book again with another time.`);
    return;
  }

  // Therapist: honour a request if that person is free, otherwise SimplyBook picks
  let unit = null, unitName = "first free therapist";
  try {
    const avail = (await call("getAvailableUnits", [svc.id, `${b.date} ${time}:00`, b.people || 1])) || [];
    const all = Object.values((await therapists()) || {});
    const nameOf = (id) => all.find((u) => String(u.id) === String(id))?.name || `#${id}`;
    if (b.therapist) {
      const want = all.find((u) => u.name.toLowerCase().includes(b.therapist.toLowerCase()));
      if (want && avail.map(String).includes(String(want.id))) { unit = want.id; unitName = want.name; }
      else unitName = `${esc(b.therapist)} isn't free then, so: ${avail.length ? nameOf(avail[0]) : "first free therapist"}`;
    }
    if (!unit && avail.length) { unit = avail[0]; if (!b.therapist) unitName = nameOf(unit); }
  } catch {}

  const id = Date.now().toString(36);
  const req = { service_id: svc.id, service: svc.name, minutes: svc.minutes, price: svc.price_mxn, date: b.date, time, name: b.name, phone: b.phone || "", email: b.email || "", unit, unitName, people: b.people || 1 };
  await cstore().setJSON("bkreq-" + id, req);
  const groupWarn = req.people >= 3 ? "\n⚠️ 3+ people: remember the group deposit." : req.people === 2 && !/couple/i.test(svc.name) ? "\n⚠️ You wrote 2 people but this isn't a couples treatment. I'll book 1 spot; send a second /book for the other guest." : "";
  await send(d.chat,
    `📅 <b>Ready to book</b>\n${esc(svc.name)} · ${svc.minutes} min${req.price ? " · " + money(req.price) : ""}\n🗓️ ${nice(b.date)} at ${time}\n👤 ${esc(b.name)}${req.phone ? " · 📱 " + esc(req.phone) : ""}${req.email ? " · " + esc(req.email) : ""}\n💆 ${esc(unitName)}${groupWarn}\n\nNothing is booked until you tap ✅.`,
    { reply_markup: { inline_keyboard: [[{ text: "✅ Confirm booking", callback_data: `bkok:${id}` }, { text: "❌ Cancel", callback_data: `bkno:${id}` }]] } });
}

async function confirm(d) {
  if (process.env.BOOK_ENABLED !== "yes") { await send(d.chat, "⏸️ /book is paused: SimplyBook auto-cancels unpaid bookings made from outside. I'll switch it back on once the admin connection works."); return; }
  const s = cstore();
  const r = await s.get("bkreq-" + d.id, { type: "json" });
  if (!r) { await send(d.chat, "That booking request expired or was already used. Send /book again."); return; }
  await s.delete("bkreq-" + d.id); // one tap = one booking, never twice
  // Check once more that the time is still free (someone may have booked online meanwhile)
  const free = (await freeTimes(r.service_id, r.date)) || {};
  if (!(free[r.date] || []).includes(r.time)) { await send(d.chat, `❌ Someone just took ${r.time} on ${nice(r.date)}. Send /book again for another time.`); return; }
  const res = await bookReal({ service_id: r.service_id, date: r.date, time: r.time, name: r.name, phone: r.phone, email: r.email || "booking@theartspatulum.mx", unit: r.unit });
  await send(d.chat, `✅ <b>Booked in SimplyBook</b>${res.code ? " · code " + esc(res.code) : ""}\n${esc(r.service)} · ${nice(r.date)} at ${r.time}\n👤 ${esc(r.name)} · 💆 ${esc(r.unitName)}${res.pay_later === "ok" ? "" : "\n⚠️ SimplyBook may ask for online payment and auto-cancel this booking. Check it in SimplyBook."}`);
}

export default async (req) => {
  const d = await req.json().catch(() => ({}));
  if (d.key !== webhookSecret()) return new Response("forbidden", { status: 403 });
  try {
    if (d.step === "confirm") await confirm(d);
    else await prepare(d);
  } catch (e) {
    await send(d.chat, "⚠️ Booking problem: " + esc(String(e.message)).slice(0, 200) + "\nNothing was booked. You can book directly in SimplyBook.");
  }
  return new Response("ok");
};
