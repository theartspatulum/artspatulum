// Receives Google "new review" emails forwarded by the Apps Script in the spa's Gmail,
// lets Claude read them, and sends the review + reply draft to Telegram for approval.
import { store, getChat, proposeReply, extractReviewFromEmail } from "../lib/reputation.mjs";
import { send } from "../lib/telegram.mjs";

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
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ status: "waiting for ANTHROPIC_API_KEY" });

  const s = store();
  const id = String(data.id || "");
  if (id && (await s.get("mail-" + id))) { await note("accepted: review already sent before"); return Response.json({ status: "already handled" }); }

  const chat = await getChat();
  if (!chat) return Response.json({ status: "no Telegram chat yet (send /start to the bot)" });

  const found = await extractReviewFromEmail(data.subject || "", data.body || "");
  if (id) await s.set("mail-" + id, new Date().toISOString());
  if (!found.is_review) { await note("accepted: email was not a review (ignored)"); return Response.json({ status: "not a review email" }); }

  for (const r of found.reviews) {
    await proposeReply(chat, { id: "mail-" + id + "-" + (r.author || ""), author: r.author || "Guest", rating: Number(r.rating) || 5, text: r.text || "", lang: "auto", when: "new review" });
  }
  if (!found.reviews.length) await send(chat, "📩 Google sent a review email, but I couldn't read the review text. Please check your Google reviews.");
  await note(`accepted: ${found.reviews.length} review(s) sent to Telegram`);
  return Response.json({ status: "sent to Telegram", count: found.reviews.length });
};
