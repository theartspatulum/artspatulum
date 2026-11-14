// Reputation Manager: watches Google reviews, drafts replies with Claude, asks Leon to approve in Telegram.
import { getStore } from "@netlify/blobs";
import { send, esc } from "./telegram.mjs";

export const PLACE_ID = "ChIJkVqVXnnXT48RZNaf0299hcc"; // The art Spa TULUM on Google Maps
export const REVIEWS_URL = `https://search.google.com/local/reviews?placeid=${PLACE_ID}`;
const MODEL = "claude-sonnet-5-5";

export const store = () => getStore("reputation");

export async function getChat() {
  return process.env.TELEGRAM_CHAT_ID || (await store().get("chat"));
}

// ---- Eyes: Google Places API (New) ----
export async function fetchPlace() {
  const res = await fetch(`https://places.googleapis.com/v1/places/${PLACE_ID}`, {
    headers: {
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
      "X-Goog-FieldMask": "rating,userRatingCount,reviews",
    },
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const p = await res.json();
  const reviews = (p.reviews || []).map((r) => ({
    id: r.name,
    author: r.authorAttribution?.displayName || "Guest",
    rating: r.rating,
    text: (r.originalText || r.text)?.text || "",
    lang: (r.originalText || r.text)?.languageCode || "en",
    when: r.relativePublishTimeDescription || "",
    time: r.publishTime || "",
  }));
  return { rating: p.rating, count: p.userRatingCount, reviews };
}

// ---- Brain: Claude writes the reply ----
export async function draftReply(review, note = "") {
  const system = `You write replies to Google reviews for The Art Spa Tulum, a gallery-inspired day spa in La Veleta, Tulum, Mexico (massages, couples rituals, facials, private sauna, cold hydropool, original art on the walls). Booking: www.theartspatulum.mx. WhatsApp: +52 984 100 7119.
Rules:
- Reply in the same language as the review (Spanish reviews get Spanish replies).
- Warm, personal, sincere. 2-4 short sentences. Mention one specific thing the guest said. Use their first name if given.
- Never invent facts, offers or discounts. No hashtags, no emojis except at most one.
- For reviews of 3 stars or less (default tone): professional and calm. Thank them, acknowledge their experience without admitting things that are not confirmed, and invite them to message us on WhatsApp so we can understand and make it right.
- Follow the owner's tone instruction when given:
  * WARM: extra friendly and grateful.
  * FIRM: polite but clear. If the review contains claims the owner says are untrue, respectfully set the record straight with the facts the owner provides (never invent facts), do not apologise for things that did not happen, stay professional (no insults, no sarcasm, no personal details about the guest), and invite them to contact us directly. Remember future guests read this reply.
  * SHORT: one or two sentences.
- End with: "— The Art Spa Tulum team" (Spanish: "— El equipo de The Art Spa Tulum").
Return only the reply text.`;
  const user = `Review by ${review.author} (${review.rating} stars):\n"""${review.text || "(no text, rating only)"}"""${note ? `\n\nInstruction from the owner: ${note}` : ""}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text || "").join("").trim();
}

// ---- Read a Google "new review" notification email ----
export async function extractReviewFromEmail(subject, body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 800,
      system: 'You read emails. If the email is a Google Business Profile / Google Maps notification about one or more NEW customer reviews of a business, return JSON {"is_review": true, "reviews": [{"author": "...", "rating": 1-5, "text": "..."}]} with the reviewer name, star rating and full review text exactly as written (text may be empty if only a rating). If it is anything else (tips, reports, replies, marketing), return {"is_review": false, "reviews": []}. Return only JSON.',
      messages: [{ role: "user", content: `Subject: ${subject}\n\n${String(body).slice(0, 8000)}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const out = (await res.json()).content?.map((c) => c.text || "").join("") || "{}";
  try { return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch { return { is_review: false, reviews: [] }; }
}

// ---- Voice: send a review + draft to Telegram with buttons ----
export const keyboard = (key) => ({
  inline_keyboard: [
    [{ text: "✅ Approve", callback_data: `ok:${key}` }, { text: "✏️ Edit", callback_data: `ed:${key}` }],
    [{ text: "💛 Warmer", callback_data: `tw:${key}` }, { text: "🛡️ Firm", callback_data: `tf:${key}` }, { text: "✂️ Shorter", callback_data: `ts:${key}` }],
    [{ text: "🔄 New version", callback_data: `re:${key}` }],
  ],
});
const stars = (n) => "⭐".repeat(Math.max(0, Math.min(5, n || 0)));
export async function proposeReply(chat, review, { test = false } = {}) {
  const draft = await draftReply(review);
  const key = "r-" + Buffer.from(review.id).toString("base64url").slice(-40);
  await store().setJSON(key, { ...review, draft, state: "pending" });
  const warn = review.rating <= 3 ? "\n⚠️ <b>Low rating, please read carefully.</b>" : "";
  return await send(
    chat,
    `${test ? "🧪 <b>Test</b>\n" : ""}🆕 <b>Google review</b> ${stars(review.rating)}\n<b>${esc(review.author)}</b> · ${esc(review.when)}\n<i>${esc(review.text || "(rating only, no text)")}</i>${warn}\n\n✍️ <b>Suggested reply:</b>\n${esc(draft)}\n\n<i>Nothing is posted without your approval.</i>`,
    { reply_markup: keyboard(key) }
  );
}

export async function finalCopy(chat, rec) {
  await send(
    chat,
    `✅ <b>Approved.</b> Copy this reply and paste it on Google:\n\n<code>${esc(rec.draft)}</code>\n\n👉 <a href="${REVIEWS_URL}">Open your Google reviews</a>`
  );
}

// ---- The check that runs on a schedule ----
export async function checkForNewReviews() {
  const chat = await getChat();
  if (!chat) return "no Telegram chat yet (send /start to the bot)";
  const s = store();
  const seen = (await s.get("seen", { type: "json" })) || null;
  const place = await fetchPlace();
  const ids = place.reviews.map((r) => r.id);
  if (!seen) {
    // First run: remember current reviews, don't spam old ones.
    await s.setJSON("seen", ids);
    await send(chat, `👋 <b>Reputation Manager is on.</b>\nGoogle rating: <b>${place.rating}</b> from <b>${place.count}</b> reviews.\nI'll message you here as soon as a new review arrives.\nTip: send /test to try it with your latest review.`);
    return "seeded";
  }
  const fresh = place.reviews.filter((r) => !seen.includes(r.id));
  // When the Gmail forwarder is active it catches every review, so skip here to avoid duplicates.
  if (!process.env.REVIEWS_EMAIL_SECRET) for (const r of fresh) await proposeReply(chat, r);
  await s.setJSON("seen", Array.from(new Set([...seen, ...ids])).slice(-200));
  await s.setJSON("last-status", { rating: place.rating, count: place.count, at: new Date().toISOString() });
  return `checked: ${fresh.length} new`;
}
