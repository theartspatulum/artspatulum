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
- For reviews of 3 stars or less: thank them, apologise sincerely without arguing, and invite them to message us on WhatsApp so we can make it right.
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

// ---- Voice: send a review + draft to Telegram with buttons ----
const stars = (n) => "⭐".repeat(Math.max(0, Math.min(5, n || 0)));
export async function proposeReply(chat, review, { test = false } = {}) {
  const draft = await draftReply(review);
  const key = "r-" + Buffer.from(review.id).toString("base64url").slice(-40);
  await store().setJSON(key, { ...review, draft, state: "pending" });
  const warn = review.rating <= 3 ? "\n⚠️ <b>Low rating, please read carefully.</b>" : "";
  await send(
    chat,
    `${test ? "🧪 <b>Test</b>\n" : ""}🆕 <b>Google review</b> ${stars(review.rating)}\n<b>${esc(review.author)}</b> · ${esc(review.when)}\n<i>${esc(review.text || "(rating only, no text)")}</i>${warn}\n\n✍️ <b>Suggested reply:</b>\n${esc(draft)}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Approve", callback_data: `ok:${key}` }, { text: "✏️ Edit", callback_data: `ed:${key}` }],
          [{ text: "🔄 New version", callback_data: `re:${key}` }],
        ],
      },
    }
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
  for (const r of fresh) await proposeReply(chat, r);
  await s.setJSON("seen", Array.from(new Set([...seen, ...ids])).slice(-200));
  await s.setJSON("last-status", { rating: place.rating, count: place.count, at: new Date().toISOString() });
  return `checked: ${fresh.length} new`;
}
