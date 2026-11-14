// Receives Google "new review" emails forwarded by the Apps Script in the spa's Gmail,
// lets Claude read them, and sends the review + reply draft to Telegram for approval.
// Every email's result is written to a small log shown on the agent-status page.
import { store, getChat, proposeReply, extractReviewFromEmail, REVIEWS_URL } from "../lib/reputation.mjs";
import { send, esc } from "../lib/telegram.mjs";

async function log(subject, outcome) {
  try {
    const s = store();
    const list = (await s.get("email-log", { type: "json" })) || [];
    list.unshift({ at: new Date().toISOString(), subject: String(subject || "").slice(0, 80), outcome });
    await s.setJSON("email-log", list.slice(0, 15));
  } catch {}
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = process.env.REVIEWS_EMAIL_SECRET;
  const data = await req.json().catch(() => ({}));
  const note = async (result) => { try { await store().setJSON("last-email-call", { at: new Date().toISOString(), result }); } catch {} };
  if (!secret || data.secret !== secret) {
    await note(!secret ? "rejected: REVIEWS_EMAIL_SECRET not set on website" : "rejected: secret phrase does not match (" + String(data.secret || "").length + " characters received)");
    return new Response("forbidden", { status: 403 });
  }
  if (data.ping) {
    await note(`accepted: Gmail check ran — found ${Number(data.found) || 0} Google review email(s) from the last 7 days, ${Number(data.fresh) || 0} new`);
    return Response.json({ status: "ping ok" });
  }

  const s = store();
  const id = String(data.id || "");
  const subject = data.subject || "";
  if (id && (await s.get("sent-" + id))) { await log(subject, "already sent to Telegram before"); return Response.json({ status: "already handled" }); }

  const chat = await getChat();
  if (!chat) { await log(subject, "no Telegram chat (send /start to the bot)"); return Response.json({ status: "no chat" }); }
  if (!process.env.ANTHROPIC_API_KEY) { await log(subject, "ANTHROPIC_API_KEY missing"); return Response.json({ status: "no key" }); }

  try {
    const found = await extractReviewFromEmail(subject, data.body || "");
    let ok = true, sent = 0;
    if (found.is_review && found.reviews?.length) {
      for (const r of found.reviews) {
        const res = await proposeReply(chat, { id: "mail-" + id + "-" + (r.author || ""), author: r.author || "Guest", rating: Number(r.rating) || 5, text: r.text || "", lang: "auto", when: "new review" });
        if (res?.ok) sent++; else { ok = false; await log(subject, "Telegram refused: " + String(res?.description || "unknown").slice(0, 120)); }
      }
      if (ok) await log(subject, `sent ${sent} review(s) to Telegram`);
    } else if (/review|reseña|opini/i.test(subject + " " + String(data.body || "").slice(0, 2000))) {
      // Looks review-related but the text couldn't be read: tell Leon anyway so nothing is lost.
      const res = await send(chat, `📩 <b>Google sent a review email</b> I couldn't fully read:\n<i>${esc(subject)}</i>\n\n👉 <a href="${REVIEWS_URL}">Open your Google reviews</a>, then send me the review with /reply and I'll draft an answer.`);
      ok = Boolean(res?.ok);
      await log(subject, ok ? "review text not readable — sent a heads-up to Telegram" : "Telegram refused: " + String(res?.description || "unknown").slice(0, 120));
    } else {
      await log(subject, "not a review email (ignored)");
    }
    if (id && ok) await s.set("sent-" + id, new Date().toISOString());
    return Response.json({ status: ok ? "done" : "telegram error" });
  } catch (e) {
    await log(subject, "error: " + String(e.message || e).slice(0, 150));
    return new Response("error", { status: 500 });
  }
};
