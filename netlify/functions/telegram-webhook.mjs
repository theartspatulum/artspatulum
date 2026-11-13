// Receives messages and button taps from Telegram.
import { send, tg, esc, webhookSecret, hasTelegram } from "../lib/telegram.mjs";
import { store, getChat, fetchPlace, proposeReply, finalCopy, draftReply } from "../lib/reputation.mjs";

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
        await send(chat, `✏️ Send me your version of the reply. Or describe the change (for example: <i>"shorter and mention the sauna"</i>) starting with <b>/change</b>.`);
      } else if (action === "re") {
        rec.draft = await draftReply(rec, "Write a different version from before."); await s.setJSON(key, rec);
        await send(chat, `🔄 <b>New version:</b>\n${esc(rec.draft)}`, { reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `ok:${key}` }, { text: "✏️ Edit", callback_data: `ed:${key}` }], [{ text: "🔄 New version", callback_data: `re:${key}` }]] } });
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
        await send(chat, `👋 Hi! I'm your <b>Art Spa Assistant</b>.\nThis chat is now connected. I'll send Google review replies here for your approval.\n\nCommands:\n/test – try it with your latest review\n/status – current Google rating`);
      } else if (chat === String(owner)) {
        await send(chat, "✅ You're already connected. Send /test or /status.");
      } else {
        await send(chat, "This assistant is private.");
      }
      return new Response("ok");
    }
    if (!owner || chat !== String(owner)) return new Response("ok");

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
        if (text.startsWith("/change")) {
          rec.draft = await draftReply(rec, text.replace("/change", "").trim());
          await s.setJSON(key, rec);
          await send(chat, `✍️ <b>Updated reply:</b>\n${esc(rec.draft)}`, { reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `ok:${key}` }, { text: "✏️ Edit", callback_data: `ed:${key}` }]] } });
        } else {
          rec.draft = text; rec.state = "approved";
          await s.setJSON(key, rec); await s.delete("awaiting-edit");
          await finalCopy(chat, rec);
        }
      } else {
        await send(chat, "Commands: /test, /status. New reviews will appear here automatically.");
      }
    }
  } catch (e) {
    console.log("webhook error", e.message);
    if (owner) await send(owner, `⚠️ Something went wrong: ${esc(e.message).slice(0, 200)}`);
  }
  return new Response("ok");
};
