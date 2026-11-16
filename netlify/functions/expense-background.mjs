// Reads an expense from a Telegram message or receipt photo (can take ~10 s), saves it, confirms.
import { tg, send, webhookSecret } from "../lib/telegram.mjs";
import { parseExpense, addExpense, savedText, savedKeyboard } from "../lib/expenses.mjs";

export default async (req) => {
  const d = await req.json().catch(() => ({}));
  if (d.key !== webhookSecret()) return new Response("forbidden", { status: 403 });
  try {
    let image = null;
    if (d.fileId) {
      const f = await tg("getFile", { file_id: d.fileId });
      const path = f?.result?.file_path;
      const r = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`);
      image = { data: Buffer.from(await r.arrayBuffer()).toString("base64"), type: /\.png$/i.test(path) ? "image/png" : "image/jpeg" };
    }
    const e = await parseExpense(d.text || "", image);
    if (!e.amount) { await send(d.chat, "🤔 I couldn't find an amount. Try e.g. <b>/expense 1200 oils from Aceites Tulum</b>, or send a clearer photo of the receipt."); return new Response("ok"); }
    const { month, item } = await addExpense({ ...e, receipt: !!image });
    await send(d.chat, savedText(month, item) + (e.confident === false ? "\n<i>I wasn't fully sure, please check.</i>" : ""), { reply_markup: savedKeyboard(month, item.id) });
  } catch (err) {
    await send(d.chat, "⚠️ Couldn't save that expense: " + String(err.message).slice(0, 150));
  }
  return new Response("ok");
};
