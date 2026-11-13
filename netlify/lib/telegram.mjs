// Small helpers for talking to Telegram (the agents' "voice").
import { createHash } from "node:crypto";

const token = () => process.env.TELEGRAM_BOT_TOKEN;
export const hasTelegram = () => Boolean(token());

// Secret that Telegram sends back with every webhook call, so we know messages are real.
export const webhookSecret = () =>
  createHash("sha256").update(String(token())).digest("hex").slice(0, 32);

export const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.log("Telegram error", method, JSON.stringify(data).slice(0, 300));
  return data;
}

export const send = (chat_id, text, extra = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
