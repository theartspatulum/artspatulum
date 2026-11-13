// Runs every 2 hours: looks for new Google reviews and sends reply drafts to Telegram.
import { checkForNewReviews } from "../lib/reputation.mjs";
import { hasTelegram } from "../lib/telegram.mjs";

export default async () => {
  if (!hasTelegram() || !process.env.ANTHROPIC_API_KEY || !process.env.GOOGLE_PLACES_API_KEY) {
    console.log("Reputation Manager waiting for keys (TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, GOOGLE_PLACES_API_KEY)");
    return new Response("waiting for keys");
  }
  try {
    const result = await checkForNewReviews();
    console.log("Reputation Manager:", result);
    return new Response(result);
  } catch (e) {
    console.log("Reputation Manager error:", e.message);
    return new Response("error", { status: 200 });
  }
};

export const config = { schedule: "0 */2 * * *" };
