// Receives messages and button taps from Telegram.
import { send, tg, esc, webhookSecret, hasTelegram } from "../lib/telegram.mjs";
import { store, getChat, fetchPlace, proposeReply, finalCopy, draftReply, keyboard } from "../lib/reputation.mjs";
import { resetConversation } from "../lib/concierge.mjs";
import { pstore, computeDay, dayText, dayKeyboard, tulumDate, owed, isRebeca, money, REBECA_WEEKLY_BASE } from "../lib/payroll.mjs";

// Hand work to the background concierge (it may take up to ~30 seconds).
async function runConcierge(req, payload) {
  const base = process.env.URL || new URL(req.url).origin;
  await fetch(base + "/.netlify/functions/concierge-background", { method: "POST", body: JSON.stringify({ ...payload, key: webhookSecret() }) });
}

export default async (req) => {
  if (!hasTelegram()) return new Response("no token");
  if (req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) return new Response("forbidden", { status: 403 });
  const update = await req.json().catch(() => ({}));
  const s = store();
  const owner = await getChat();

  try {
    // Button taps
    if (update.callback_query) {
      const q = update.callback_query;
      const chat = String(q.message.chat.id);
      await tg("answerCallbackQuery", { callback_query_id: q.id });
      if (owner && chat !== String(owner)) return new Response("ok");
      const [action, key] = q.data.split(":");
      if (["pyok", "pyed", "flpaid"].includes(action)) {
        const ps = pstore();
        if (action === "flpaid") { await ps.set("fl-paid-through", key); await send(chat, `✅ Freelancers marked as paid through ${key}.`); return new Response("ok"); }
        const day = await ps.get("day-" + key, { type: "json" });
        if (!day) { await send(chat, "That day isn't saved anymore. Send /payroll " + key); return new Response("ok"); }
        if (action === "pyok") { day.status = "approved"; await ps.setJSON("day-" + key, day); await send(chat, `✅ Payroll ${key} approved and saved.`); }
        else { await s.set("py-edit", key); await send(chat, `✏️ Editing ${key}. Send one change per message:\n<b>3 600</b> – set line 3 to $600\n<b>3 Rosi</b> – line 3 was done by Rosi\n<b>del 3</b> – remove line 3\n<b>add Rosi 500 Deep Tissue</b> – add a line\n<b>done</b> – finish`); }
        return new Response("ok");
      }
      if (action === "cxok" || action === "cxno") {
        await send(chat, action === "cxok" ? "✅ Got it, I'll tell the guest." : "❌ Got it, I'll offer the guest other times.");
        await runConcierge(req, { pending: key, approved: action === "cxok", channel: "telegram", chat });
        return new Response("ok");
      }
      const rec = await s.get(key, { type: "json" });
      if (!rec) { await send(chat, "I couldn't find that review anymore."); return new Response("ok"); }
      if (action === "ok") {
        rec.state = "approved"; await s.setJSON(key, rec);
        await finalCopy(chat, rec);
      } else if (action === "ed") {
        await s.set("awaiting-edit", key);
        await send(chat, `✏️ Three ways to edit:\n• Send your own reply text, and I'll use it exactly.\n• Send <b>/change</b> + what to change (e.g. <i>/change shorter and mention the sauna</i>).\n• Send <b>/facts</b> + what really happened (e.g. <i>/facts she arrived 40 minutes late and we still gave the full massage</i>) for a firm, factual reply.`);
      } else if (["re", "tw", "tf", "ts"].includes(action)) {
        const notes = { re: "Write a different version from before.", tw: "Tone: WARM.", tf: "Tone: FIRM." + (rec.facts ? " Facts from the owner: " + rec.facts : " No facts given yet; stay factual and general."), ts: "Tone: SHORT." };
        const labels = { re: "🔄 New version", tw: "💛 Warmer version", tf: "🛡️ Firm version", ts: "✂️ Shorter version" };
        rec.draft = await draftReply(rec, notes[action]); await s.setJSON(key, rec);
        const tip = action === "tf" && !rec.facts ? "\n\n<i>Tip: tap ✏️ Edit and send</i> <b>/facts</b> <i>followed by what really happened, and I'll use it in the firm reply.</i>" : "";
        await send(chat, `${labels[action]}:\n${esc(rec.draft)}${tip}`, { reply_markup: keyboard(key) });
      }
      return new Response("ok");
    }

    const msg = update.message;
    if (!msg || !msg.text) return new Response("ok");
    const chat = String(msg.chat.id);
    const text = msg.text.trim();

    if (text.startsWith("/start")) {
      if (!owner) {
        await s.set("chat", chat);
        await send(chat, `👋 Hi! I'm your <b>Art Spa Assistant</b>.\nThis chat is now connected. I'll send Google review replies here for your approval.\n\nCommands:\n/test – try it with your latest review\n/reply – paste any review to get a reply draft\n/status – current Google rating`);
      } else if (chat === String(owner)) {
        await send(chat, "✅ You're already connected. Send /test or /status.");
      } else {
        await send(chat, "This assistant is private.");
      }
      return new Response("ok");
    }
    if (!owner || chat !== String(owner)) return new Response("ok");

    // ---- Payroll ----
    const editing = await s.get("py-edit");
    if (editing && !text.startsWith("/")) {
      const ps = pstore(); const day = await ps.get("day-" + editing, { type: "json" });
      if (/^done$/i.test(text)) { await s.delete("py-edit"); await send(chat, dayText(editing, day.lines, day.tips), { reply_markup: dayKeyboard(editing) }); return new Response("ok"); }
      let m;
      if ((m = text.match(/^del(?:ete)?\s+(\d+)$/i))) day.lines.splice(Number(m[1]) - 1, 1);
      else if ((m = text.match(/^add\s+(\S+)\s+(\d+)\s*(.*)$/i))) day.lines.push({ time: "", service: m[3] || "Manual", mins: 0, therapist: m[1], amount: Number(m[2]), note: "added by Leon" });
      else if ((m = text.match(/^(\d+)\s+(\d+)$/))) { const l = day.lines[Number(m[1]) - 1]; if (l) { l.amount = Number(m[2]); l.note = "edited"; } }
      else if ((m = text.match(/^(\d+)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)$/))) { const l = day.lines[Number(m[1]) - 1]; if (l) { l.therapist = m[2]; l.note = "therapist changed — check amount"; } }
      else { await send(chat, "I didn't get that. Examples: <b>3 600</b>, <b>3 Rosi</b>, <b>del 3</b>, <b>add Rosi 500 Deep Tissue</b>, <b>done</b>"); return new Response("ok"); }
      await ps.setJSON("day-" + editing, day);
      await send(chat, dayText(editing, day.lines, day.tips) + "\n\n<i>Keep editing, or send</i> <b>done</b>");
      return new Response("ok");
    }
    if (text.startsWith("/payroll")) {
      const date = (text.match(/\d{4}-\d{2}-\d{2}/) || [tulumDate()])[0];
      const ps = pstore(); const prev = (await ps.get("day-" + date, { type: "json" })) || {};
      try {
        const lines = await computeDay(date);
        const day = { date, lines, tips: prev.tips || [], status: "pending" };
        await ps.setJSON("day-" + date, day);
        await send(chat, dayText(date, lines, day.tips), { reply_markup: dayKeyboard(date) });
      } catch (e) { await send(chat, "⚠️ Couldn't read SimplyBook bookings: " + String(e.message).slice(0, 200)); }
      return new Response("ok");
    }
    if (text.startsWith("/tip")) {
      const m = text.match(/^\/tip\s+(\S+)\s+(\d+)(?:\s+(\d{4}-\d{2}-\d{2}))?/i);
      if (!m) { await send(chat, "Use: <b>/tip Rosi 300</b> (optionally add a date: /tip Rosi 300 2026-11-14)"); return new Response("ok"); }
      const date = m[3] || tulumDate(); const ps = pstore();
      const day = (await ps.get("day-" + date, { type: "json" })) || { date, lines: [], tips: [], status: "pending" };
      day.tips = [...(day.tips || []), { name: m[1], amount: Number(m[2]) }];
      await ps.setJSON("day-" + date, day);
      await send(chat, `💵 Tip saved: ${m[1]} ${money(Number(m[2]))} on ${date}.`);
      return new Response("ok");
    }
    if (text.startsWith("/expense")) {
      const m = text.match(/^\/expense\s+(\d+(?:\.\d+)?)\s+(.+)$/i);
      if (!m) { await send(chat, "Use: <b>/expense 850 towels laundry</b>"); return new Response("ok"); }
      const ps = pstore(); const month = tulumDate().slice(0, 7);
      const list = (await ps.get("expenses-" + month, { type: "json" })) || [];
      list.push({ date: tulumDate(), amount: Number(m[1]), what: m[2] });
      await ps.setJSON("expenses-" + month, list);
      const total = list.reduce((a, b) => a + b.amount, 0);
      await send(chat, `🧾 Expense saved: ${money(Number(m[1]))} – ${m[2]}.\nThis month so far: <b>${money(total)}</b>`);
      return new Response("ok");
    }
    if (text === "/owed") {
      const ps = pstore(); const last = (await ps.get("fl-paid-through")) || tulumDate(-3);
      const from = new Date(new Date(last + "T12:00:00").getTime() + 86400000).toISOString().slice(0, 10);
      const fl = await owed(from, tulumDate(), (n) => !isRebeca(n));
      const today = new Date(tulumDate() + "T12:00:00"); const back = (today.getDay() + 6) % 7;
      const monday = new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10);
      const rb = Object.values(await owed(monday, tulumDate(), isRebeca)).reduce((a, b) => a + b, 0);
      const flTxt = Object.entries(fl).map(([k, v]) => `• ${k}: ${money(v)}`).join("\n") || "• nothing yet";
      await send(chat, `💳 <b>Owed now</b> (approved days only)\n\nFreelancers since ${from}:\n${flTxt}\n\nRebeca this week (from ${monday}): ${money(REBECA_WEEKLY_BASE)} base + ${money(rb)} = <b>${money(REBECA_WEEKLY_BASE + rb)}</b>`);
      return new Response("ok");
    }

    // ---- Concierge test mode: you chat as a guest ----
    if (text === "/guest" || text === "/guest on") {
      await s.set("guest-mode", "1"); await resetConversation("tg-test");
      await send(chat, "🧪 <b>Guest test mode is ON.</b>\nWrite to me as if you were a guest on WhatsApp, in any language. I'll answer like the concierge, with real free times from SimplyBook. Bookings are only simulated.\n\n/newguest – start over as a new guest\n/guest off – back to normal");
      return new Response("ok");
    }
    if (text === "/guest off") { await s.delete("guest-mode"); await send(chat, "Guest test mode is OFF."); return new Response("ok"); }
    if (text === "/newguest") { await resetConversation("tg-test"); await send(chat, "🆕 New guest. Say hi!"); return new Response("ok"); }
    if (!text.startsWith("/") && (await s.get("guest-mode")) && !(await s.get("awaiting-edit"))) {
      await tg("sendChatAction", { chat_id: chat, action: "typing" });
      await runConcierge(req, { conv: "tg-test", text, channel: "telegram", chat, test: true, guest: { name: "Test guest" } });
      return new Response("ok");
    }

    if (text.startsWith("/reply")) {
      // Paste any review: "/reply 5 Maria: Amazing massage..." (stars and name optional)
      let body = text.replace(/^\/reply\s*/, "");
      if (!body) { await send(chat, "Paste the review after /reply, for example:\n<code>/reply 5 Maria: The hot stone massage was amazing!</code>\n(stars and name are optional)"); return new Response("ok"); }
      let rating = 5, author = "Guest";
      const m = body.match(/^([1-5])\s*(?:stars?|estrellas?|⭐)?\s*/i);
      if (m) { rating = Number(m[1]); body = body.slice(m[0].length); }
      const n = body.match(/^([^:\n]{2,40}):\s*/);
      if (n) { author = n[1].trim(); body = body.slice(n[0].length); }
      await proposeReply(chat, { id: "manual-" + Date.now(), author, rating, text: body.trim(), lang: "auto", when: "pasted review" });
      return new Response("ok");
    }
    if ((text === "/status" || text === "/test") && !process.env.GOOGLE_PLACES_API_KEY) {
      await send(chat, "This command needs the Google Places key, which is optional. New reviews still arrive here automatically from your Gmail. To reply to any review now, use /reply.");
      return new Response("ok");
    }
    if (text === "/status") {
      const p = await fetchPlace();
      await send(chat, `⭐ Google rating: <b>${p.rating}</b> from <b>${p.count}</b> reviews.`);
    } else if (text === "/test") {
      const p = await fetchPlace();
      const latest = [...p.reviews].sort((a, b) => (b.time || "").localeCompare(a.time || ""))[0];
      if (!latest) await send(chat, "No reviews found.");
      else await proposeReply(chat, latest, { test: true });
    } else {
      const key = await s.get("awaiting-edit");
      if (key) {
        const rec = await s.get(key, { type: "json" });
        if (text.startsWith("/facts")) {
          rec.facts = text.replace("/facts", "").trim();
          rec.draft = await draftReply(rec, "Tone: FIRM. Facts from the owner: " + rec.facts);
          await s.setJSON(key, rec);
          await send(chat, `🛡️ <b>Firm reply using your facts:</b>\n${esc(rec.draft)}`, { reply_markup: keyboard(key) });
        } else if (text.startsWith("/change")) {
          rec.draft = await draftReply(rec, text.replace("/change", "").trim());
          await s.setJSON(key, rec);
          await send(chat, `✍️ <b>Updated reply:</b>\n${esc(rec.draft)}`, { reply_markup: keyboard(key) });
        } else {
          rec.draft = text; rec.state = "approved";
          await s.setJSON(key, rec); await s.delete("awaiting-edit");
          await finalCopy(chat, rec);
        }
      } else {
        await send(chat, "Commands: /reply – draft a review reply · /guest – test the WhatsApp concierge. New reviews appear here automatically.");
      }
    }
  } catch (e) {
    console.log("webhook error", e.message);
    if (owner) await send(owner, `⚠️ Something went wrong: ${esc(e.message).slice(0, 200)}`);
  }
  return new Response("ok");
};
