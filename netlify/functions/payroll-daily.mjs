// Every evening at 20:30 Tulum: work out the day's commissions and send them to Leon for approval.
// Every morning at 10:00 Tulum: payday reminders (Rebeca on Mondays, freelancers every 2 days).
import { getChat } from "../lib/reputation.mjs";
import { send } from "../lib/telegram.mjs";
import { pstore, computeDay, dayText, dayKeyboard, tulumDate, owed, isRebeca, money, REBECA_WEEKLY_BASE } from "../lib/payroll.mjs";

export default async () => {
  const chat = await getChat(); if (!chat) return new Response("no chat");
  const s = pstore();
  if ((await s.get("paused")) !== "no") return new Response("paused"); // paused until Leon sends /payroll resume
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Cancun", hour: "numeric", hour12: false }));
  try {
    if (hour >= 18) {
      const date = tulumDate();
      const prev = (await s.get("day-" + date, { type: "json" })) || {};
      const lines = await computeDay(date);
      const day = { date, lines, tips: prev.tips || [], status: "pending" };
      await s.setJSON("day-" + date, day);
      await send(chat, dayText(date, lines, day.tips), { reply_markup: dayKeyboard(date) });
    } else {
      const today = tulumDate();
      const weekday = new Date(today + "T12:00:00").getDay(); // 1 = Monday
      if (weekday === 1) {
        const from = tulumDate(-7), to = tulumDate(-1);
        const o = await owed(from, to, isRebeca);
        const comm = Object.values(o).reduce((a, b) => a + b, 0);
        await send(chat, `💳 <b>Payday: Rebeca</b> (${from} → ${to})\nBase ${money(REBECA_WEEKLY_BASE)} + commissions & tips ${money(comm)} = <b>${money(REBECA_WEEKLY_BASE + comm)}</b>\n<i>Only approved days are counted.</i>`);
      }
      const last = (await s.get("fl-paid-through")) || tulumDate(-3);
      const days = Math.round((new Date(today) - new Date(last)) / 86400000);
      if (days >= 2) {
        const from = new Date(new Date(last + "T12:00:00").getTime() + 86400000).toISOString().slice(0, 10), to = tulumDate(-1);
        const o = await owed(from, to, (n) => !isRebeca(n));
        const lines = Object.entries(o).filter(([, v]) => v).map(([k, v]) => `• ${k}: <b>${money(v)}</b>`).join("\n") || "Nothing owed (or days not approved yet).";
        await send(chat, `💳 <b>Payday: freelancers</b> (${from} → ${to})\n${lines}`, { reply_markup: { inline_keyboard: [[{ text: "✅ Marked as paid", callback_data: `flpaid:${to}` }]] } });
      }
    }
  } catch (e) {
    await send(chat, `⚠️ Payroll error: ${String(e.message).slice(0, 200)}`);
  }
  return new Response("ok");
};
export const config = { schedule: "30 1,15 * * *" }; // 20:30 and 10:30 Tulum (UTC-5)
