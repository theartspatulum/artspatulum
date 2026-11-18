// /book from Telegram: reads Leon's message, checks SimplyBook, asks for ✅, then books.
// step "prepare": understand + check availability + send summary with buttons
// step "confirm": create the booking in SimplyBook
import { send, esc, webhookSecret } from "../lib/telegram.mjs";
import { catalog, freeTimes, cstore } from "../lib/concierge.mjs";
import { call, therapists, adminBook } from "../lib/simplybook.mjs";
import { prepareManage, confirmManage } from "../lib/manage.mjs";
import { normPhone, hasPhone, validEmail, fullName, findGuest, createGuest } from "../lib/guests.mjs";

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
      system: `The spa owner wants to create a booking. Now in Tulum: ${tulumNow()} (today is ${today()}). Read the message (English or Spanish, loose wording) and pick the treatment from this list by id, matching name AND length (if no length is given, use the 60-minute version, or the only version):\n${list.map((s) => `${s.id}: ${s.name} (${s.minutes} min)`).join("\n")}\nDates as YYYY-MM-DD ("tomorrow", "Friday" = the next one). Times as 24h HH:MM ("3pm" = 15:00). Guest: "name" = full name exactly as written; "phone" = exactly as written, keep the + and country code if present, never add or guess a country code; "email" as written. Leave fields empty if not given; never invent a name, phone or email.\nReply with JSON only: {"service_id": number or null, "date": "YYYY-MM-DD" or "", "time": "HH:MM" or "", "name": "", "phone": "", "email": "", "therapist": "" (only if the owner asked for one), "people": number (default 1), "missing": "what is missing or unclear, a few words, or empty"}`,
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
  if (!b.name && !b.phone && !b.email) need.push("the guest (name, WhatsApp number with country code, email)");
  if (need.length) {
    await send(d.chat, `🤔 I still need ${need.join(", ")}.${b.missing ? " (" + esc(b.missing) + ")" : ""}\n\nExample: <b>/book Maria Lopez, maria@gmail.com, +52 984 123 4567, Reset Aroma 60, tomorrow 3pm</b>`);
    return;
  }
  // ---- Guest: returning (found in SimplyBook) or new (needs full details) ----
  if (b.phone && !normPhone(b.phone)) {
    await send(d.chat, `📱 Please send the WhatsApp number <b>with its country code</b>, e.g. <b>+1 305 433 3445</b> (US) or <b>+52 984 123 4567</b> (Mexico). I never assume +52.\n\nSend /book again with the full number.`);
    return;
  }
  const found = await findGuest(b);
  if (found.many) {
    const opts = found.many.slice(0, 5).map((c) => `• ${esc(c.name)} · ${esc(c.phone || "no phone")} · ${esc(c.email || "no email")}`).join("\n");
    await send(d.chat, `👥 I found more than one guest that could match:\n${opts}\n\nSend /book again with their <b>WhatsApp number</b> or <b>email</b> so I pick the right one.`);
    return;
  }
  let guest;
  if (found.match) {
    guest = { ...found.match, returning: true };
  } else {
    const name = fullName(b.name), phone = normPhone(b.phone), email = validEmail(b.email) ? b.email.trim().toLowerCase() : "";
    const miss = [];
    if (!name) miss.push(b.name ? "the guest's <b>last name</b>" : "the guest's <b>first and last name</b>");
    if (!email) miss.push(b.email ? "a <b>valid email</b> (name@example.com)" : "the guest's <b>email</b>");
    if (!phone) miss.push(hasPhone(b.phone) ? "the WhatsApp number <b>with country code</b>" : "the guest's <b>WhatsApp number with country code</b> (+1, +52, +44…)");
    if (miss.length) {
      await send(d.chat, `🆕 This is a <b>new guest</b> (not found in SimplyBook), so I need ${miss.join(", ")}.\n\nExample: <b>/book Maria Lopez, maria@gmail.com, +1 305 433 3445, Reset Aroma 60, tomorrow 3pm</b>`);
      return;
    }
    guest = { id: null, name, email, phone, returning: false };
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
  const req = { service_id: svc.id, service: svc.name, minutes: svc.minutes, price: svc.price_mxn, date: b.date, time, guest, unit, unitName, people: b.people || 1 };
  await cstore().setJSON("bkreq-" + id, req);
  const groupWarn = req.people >= 3 ? "\n⚠️ 3+ people: remember the group deposit." : req.people === 2 && !/couple/i.test(svc.name) ? "\n⚠️ You wrote 2 people but this isn't a couples treatment. I'll book 1 spot; send a second /book for the other guest." : "";
  await send(d.chat,
    `📅 <b>Ready to book</b>\n${esc(svc.name)} · ${svc.minutes} min${req.price ? " · " + money(req.price) : ""}\n🗓️ ${nice(b.date)} at ${time}\n${guest.returning ? "↩️ <b>Returning guest</b>\n" : "🆕 <b>New guest</b> (will be added to SimplyBook)\n"}👤 ${esc(guest.name)}\n📱 ${esc(guest.phone || "no phone on file")}\n✉️ ${esc(guest.email || "no email on file")}\n💆 ${esc(unitName)}${groupWarn}\n\nNothing is booked until you tap ✅.`,
    { reply_markup: { inline_keyboard: [[{ text: "✅ Confirm booking", callback_data: `bkok:${id}` }, { text: "❌ Cancel", callback_data: `bkno:${id}` }]] } });
}

async function confirm(d) {
  if (process.env.BOOK_ENABLED !== "yes") { await send(d.chat, "⏸️ /book is paused. To switch it on, set BOOK_ENABLED = yes in Netlify and redeploy."); return; }
  const s = cstore();
  const r = await s.get("bkreq-" + d.id, { type: "json" });
  if (!r || !r.guest) { await send(d.chat, "That booking request expired or was already used. Send /book again."); return; }
  await s.delete("bkreq-" + d.id); // one tap = one booking, never twice
  // Check once more that the time is still free (someone may have booked online meanwhile)
  const free = (await freeTimes(r.service_id, r.date)) || {};
  if (!(free[r.date] || []).includes(r.time)) { await send(d.chat, `❌ Someone just took ${r.time} on ${nice(r.date)}. Send /book again for another time.`); return; }
  // Therapist: keep the one shown on the card if still free, otherwise the first free one
  let unit = r.unit, unitName = r.unitName;
  const avail = ((await call("getAvailableUnits", [r.service_id, `${r.date} ${r.time}:00`, 1])) || []).map(String);
  if (!unit || !avail.includes(String(unit))) {
    if (!avail.length) { await send(d.chat, `❌ No therapist is free at ${r.time} on ${nice(r.date)} anymore. Send /book again for another time.`); return; }
    unit = avail[0];
    const all = Object.values((await therapists()) || {});
    unitName = all.find((u) => String(u.id) === String(unit))?.name || unitName;
  }
  // Guest: use the existing SimplyBook record, or create the new guest now
  const g = r.guest;
  const clientId = g.id || (await createGuest({ name: g.name, email: g.email, phone: g.phone }));
  const res = await adminBook({ serviceId: r.service_id, unitId: unit, clientId, date: r.date, time: r.time, minutes: r.minutes });
  await send(d.chat, `✅ <b>Booked in SimplyBook</b>${res.code ? " · code " + esc(res.code) : ""}\n${esc(r.service)} · ${nice(r.date)} at ${r.time}\n👤 ${esc(g.name)}${g.returning ? " (returning guest)" : " (new guest added)"}\n💆 ${esc(unitName)}`);
}

export default async (req) => {
  const d = await req.json().catch(() => ({}));
  if (d.key !== webhookSecret()) return new Response("forbidden", { status: 403 });
  try {
    if (d.step === "confirm") await confirm(d);
    else if (d.step === "cancel" || d.step === "move") await prepareManage(d, d.step);
    else if (d.step === "manage-confirm") await confirmManage(d);
    else await prepare(d);
  } catch (e) {
    await send(d.chat, "⚠️ Booking problem: " + esc(String(e.message)).slice(0, 200) + (d.step === "confirm" || d.step === "prepare" || !d.step ? "\nNothing was booked." : "\nNothing was changed.") + " You can do it directly in SimplyBook.");
  }
  return new Response("ok");
};
