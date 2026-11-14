// Shows which agent settings are present (yes/no only — never the values).
import { getStore } from "@netlify/blobs";

export default async () => {
  const has = (k) => (process.env[k] ? "✅ set" : "❌ missing");
  let chat = "❌ not yet (send /start to the bot)";
  try { if (process.env.TELEGRAM_CHAT_ID || (await getStore("reputation").get("chat"))) chat = "✅ connected"; } catch {}
  let last = "never (run checkReviewEmails in Apps Script)";
  try {
    const l = await getStore("reputation").get("last-email-call", { type: "json" });
    if (l) last = `${new Date(l.at).toLocaleString("en-US", { timeZone: "America/Cancun" })} (Tulum time) — ${l.result}`;
  } catch {}
  const lines = [
    "The Art Spa — agent status",
    "",
    `Telegram bot token ........ ${has("TELEGRAM_BOT_TOKEN")}`,
    `Telegram chat (/start) .... ${chat}`,
    `Anthropic key (brain) ..... ${has("ANTHROPIC_API_KEY")}`,
    `Reviews email secret ...... ${has("REVIEWS_EMAIL_SECRET")}`,
    `Google Places key ......... ${process.env.GOOGLE_PLACES_API_KEY ? "✅ set" : "— optional, not set"}`,
    `SimplyBook daily hook ..... ${has("BUILD_HOOK_URL")}`,
    "",
    `Last contact from Gmail ... ${last}`,
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};
