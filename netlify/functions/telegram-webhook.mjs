// Receives messages and button taps from Telegram.
import { send, tg, esc, webhookSecret, hasTelegram } from "../lib/telegram.mjs";
import { store, getChat, fetchPlace, proposeReply, finalCopy, draftReply, keyboard } from "../lib/reputation.mjs";

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
        await send(chat, "Commands: /test, /reply, /status. New reviews will appear here automatically.");
      }
    }
  } catch (e) {
    console.log("webhook error", e.message);
    if (owner) await send(owner, `⚠️ Something went wrong: ${esc(e.message).slice(0, 200)}`);
  }
  return new Response("ok");
};
