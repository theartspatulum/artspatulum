// Guest Concierge: answers guests (WhatsApp later, Telegram test mode now),
// checks SimplyBook for free times, offers an upgrade, and books.
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { call, services as sbServices } from "./simplybook.mjs";
import { send, esc } from "./telegram.mjs";

const MODEL = "claude-sonnet-5-5";
export const cstore = () => getStore("concierge");

const tulumToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Cancun" });
const tulumNow = () => new Date().toLocaleString("en-US", { timeZone: "America/Cancun", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ---------- SimplyBook helpers ----------
let catalogCache = null;
async function catalog() {
  if (catalogCache && catalogCache.until > Date.now()) return catalogCache.list;
  const ev = Object.values((await sbServices()) || {}).filter((e) => e.is_public !== "0" && e.is_active !== "0");
  const list = ev.map((e) => ({
    id: Number(e.id),
    name: e.name,
    minutes: Number(e.duration),
    price_mxn: Number(e.price) || null,
    about: String(e.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220),
  }));
  catalogCache = { list, until: Date.now() + 10 * 60 * 1000 };
  return list;
}

async function freeTimes(serviceId, from, to) {
  const m = (await call("getStartTimeMatrix", [from, to || from, Number(serviceId), null, 1])) || {};
  const out = {};
  for (const [d, times] of Object.entries(m)) out[d] = (times || []).map((t) => t.slice(0, 5));
  return out;
}

async function bookReal({ service_id, date, time, name, phone, email }) {
  const t = time.length === 5 ? time + ":00" : time;
  let unit = null;
  try {
    const units = await call("getAvailableUnits", [Number(service_id), `${date} ${t}`, 1]);
    if (Array.isArray(units) && units.length) unit = units[0];
  } catch {}
  const client = { name, phone: phone || "", email: email || "whatsapp.guest@theartspatulum.mx" };
  const res = await call("book", [Number(service_id), unit, date, t, client, {}, 1]);
  const b = res?.bookings?.[0];
  if (res?.require_confirm && b) {
    const sign = createHash("md5").update(String(b.id) + b.hash + process.env.SIMPLYBOOK_SECRET_KEY).digest("hex");
    await call("confirmBooking", [b.id, sign]);
  }
  return { booking_id: b?.id, code: b?.code };
}

// ---------- Rules (the robot's "training") ----------
function systemPrompt(test) {
  return `You are the WhatsApp concierge of The Art Spa Tulum, a gallery-inspired day spa in La Veleta, Tulum, Mexico (address: Supermanzana 15, Manzana 69, La Veleta, 77760 Tulum). Original art on the walls, private hot sauna, cold hydropool, tea area, massage rooms. Website: https://www.theartspatulum.mx. Now in Tulum: ${tulumNow()}.

STYLE
- Reply in the guest's language (Spanish, English, French, Italian…). Warm, calm, short WhatsApp messages (1-4 short lines). At most one emoji. No markdown, no bullet lists unless listing times.
- Never invent prices, times or treatments. Use the tools: get_services for treatments/prices/lengths, check_availability for free times. Prices are in MXN.
- Massages come in different lengths (60, 75, 90 min). If a guest doesn't say the length, ask, or suggest 60 and mention 75/90.

BOOKING FLOW
1. Find out: treatment, length, date, start time, number of people, guest's name.
2. Check availability with the tool. Offer up to 3 nearby free times if the requested one is taken.
3. When the guest agrees to a booking, pause and offer ONE upgrade before booking (only once per conversation):
   - longer session: 60 → 75 or 90 minutes, or
   - Relaxing/aroma massage → Deep Tissue, or
   - add Cacao Butter to their massage. Cacao Butter is a good upsell for most massages, EXCEPT: Cacao Butter massage itself, Honey massage, Mayan Clay, and Signature Body Rituals (don't offer it for those).
   Keep it light and optional ("Would you like to make it 90 minutes for X MXN more, or keep it as is?"). Check availability again if the length changes.
4. Repeat the final details (treatment, length, date, time, name, price) and ask "Shall I confirm?". Only after a clear yes, call create_booking.
5. After booking: confirm warmly, give the address, ask them to arrive 10 minutes early.

PAYMENT & POLICIES
- Bookings made by us on WhatsApp: no deposit needed (pay at the spa). Online bookings on the website require online payment.
- Groups of 3 or more people: do NOT book. Tell the guest a team member will help them personally (a deposit applies to groups), and call notify_owner with kind "handoff".
- Cancellation & changes policy (explain only what's relevant, briefly):
  * 48+ hours before: free cancellation or change.
  * Less than 48 hours: free reschedule.
  * 24 hours or less: cancellations are non-refundable, but the payment becomes a spa credit valid for 3 months.
  * Tone when explaining: kind and understanding ("we understand plans change and we'll do our best to accommodate you"), while asking guests to respect the policy.
  * Last-minute (same-day) cancellations or changes: 500 MXN fee.

WHEN TO INVOLVE THE OWNER (call notify_owner)
- kind "handoff": complaints or upset guests, groups of 3+, events/private bookings, discounts or price negotiation, medical questions (pregnancy, injuries), or anything you're not sure about. Tell the guest a team member will reply shortly, then stop selling.
- kind "change_request": when the requested time is taken but could work by moving another booking (e.g. a 12:00 booking moved to 12:30 to fit a new guest at 11:30), or when a guest wants to change or cancel an existing booking. Never promise the change; say you're checking with the team. The owner approves in Telegram.
${test ? "\nTEST MODE: this is the owner testing you. Bookings are simulated, nothing is created in SimplyBook." : ""}`;
}

const TOOLS = [
  { name: "get_services", description: "List all treatments with id, name, length in minutes, price in MXN and a short description.", input_schema: { type: "object", properties: {} } },
  {
    name: "check_availability",
    description: "Free start times for a treatment between two dates (YYYY-MM-DD). The time already accounts for the full treatment length.",
    input_schema: { type: "object", properties: { service_id: { type: "integer" }, date_from: { type: "string" }, date_to: { type: "string" } }, required: ["service_id", "date_from"] },
  },
  {
    name: "create_booking",
    description: "Create the booking in SimplyBook. Only after the guest clearly confirmed the final details.",
    input_schema: { type: "object", properties: { service_id: { type: "integer" }, date: { type: "string" }, time: { type: "string", description: "HH:MM" }, name: { type: "string" }, email: { type: "string" }, summary: { type: "string", description: "one line: treatment, length, date, time, price" } }, required: ["service_id", "date", "time", "name", "summary"] },
  },
  {
    name: "notify_owner",
    description: "Message the owner in Telegram. kind 'handoff' pauses you so the team takes over; kind 'change_request' asks the owner to approve a schedule change.",
    input_schema: { type: "object", properties: { kind: { type: "string", enum: ["handoff", "change_request"] }, summary: { type: "string" } }, required: ["kind", "summary"] },
  },
];

async function claude(system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, system, tools: TOOLS, messages }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---------- One guest message in, one reply out ----------
// conv: conversation id; guest: { phone, name }; owner: Telegram chat to notify; test: simulate bookings
export async function handleGuestMessage({ conv, text, guest = {}, owner, test = false }) {
  const s = cstore();
  const state = (await s.get("conv-" + conv, { type: "json" })) || { history: [], upsold: false };
  if (state.pausedUntil && Date.now() < state.pausedUntil) return null; // team has taken over

  const history = [...state.history.slice(-16), { role: "user", content: text }];
  const messages = history.map((m) => ({ role: m.role, content: m.content }));
  const notes = [];
  let reply = "";

  for (let step = 0; step < 6; step++) {
    const out = await claude(systemPrompt(test), messages);
    const uses = (out.content || []).filter((c) => c.type === "tool_use");
    reply = (out.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    if (!uses.length) break;
    messages.push({ role: "assistant", content: out.content });
    const results = [];
    for (const u of uses) {
      let result;
      try {
        if (u.name === "get_services") result = await catalog();
        else if (u.name === "check_availability") result = await freeTimes(u.input.service_id, u.input.date_from, u.input.date_to);
        else if (u.name === "create_booking") {
          if (test) result = { ok: true, simulated: true, booking_id: "TEST" };
          else result = { ok: true, ...(await bookReal({ ...u.input, phone: guest.phone })) };
          notes.push(`${test ? "🧪 <b>Test booking (not created)</b>" : "✅ <b>New WhatsApp booking</b>"}\n${esc(u.input.name)} · ${esc(u.input.summary)}${guest.phone ? "\n📱 " + esc(guest.phone) : ""}`);
        } else if (u.name === "notify_owner") {
          if (u.input.kind === "handoff") state.pausedUntil = test ? 0 : Date.now() + 12 * 3600 * 1000;
          const body = `${u.input.kind === "handoff" ? "🙋 <b>Guest needs you</b>" : "🗓️ <b>Approval needed: schedule change</b>"}\n${esc(u.input.summary)}${guest.phone ? "\n📱 " + esc(guest.phone) : ""}${u.input.kind === "handoff" && !test ? "\n<i>I'll stay quiet in this chat for 12 hours.</i>" : ""}`;
          if (u.input.kind === "change_request") {
            const pid = Date.now().toString(36);
            await s.setJSON("pending-" + pid, { conv, summary: u.input.summary, guest, test });
            notes.push({ text: body + "\n\nMake the change in SimplyBook first, then tap ✅. Or tap ❌ to say no.", reply_markup: { inline_keyboard: [[{ text: "✅ Approved / done", callback_data: `cxok:${pid}` }, { text: "❌ Not possible", callback_data: `cxno:${pid}` }]] } });
          } else notes.push(body);
          result = { ok: true, owner_notified: true };
        }
      } catch (e) {
        result = { error: String(e.message || e).slice(0, 200) };
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(result).slice(0, 6000) });
    }
    messages.push({ role: "user", content: results });
  }

  state.history = [...history, { role: "assistant", content: reply || "…" }].slice(-18);
  await s.setJSON("conv-" + conv, state);
  if (owner) for (const n of notes) typeof n === "string" ? await send(owner, n) : await send(owner, n.text, { reply_markup: n.reply_markup });
  return reply;
}

export async function resetConversation(conv) {
  await cstore().delete("conv-" + conv);
}
