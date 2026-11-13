// Visit once after saving TELEGRAM_BOT_TOKEN: connects the bot to this website.
import { tg, webhookSecret, hasTelegram } from "../lib/telegram.mjs";

export default async (req) => {
  if (!hasTelegram()) return new Response("Add TELEGRAM_BOT_TOKEN in Netlify first, then redeploy.", { status: 200 });
  const origin = new URL(req.url).origin;
  const url = `${origin}/.netlify/functions/telegram-webhook`;
  const r = await tg("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"] });
  const me = await tg("getMe", {});
  const name = me.result?.username ? "@" + me.result.username : "your bot";
  return new Response(
    r.ok
      ? `Connected! Now open Telegram, find ${name}, and send /start.`
      : `Telegram said: ${r.description || "unknown error"}`,
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  );
};
