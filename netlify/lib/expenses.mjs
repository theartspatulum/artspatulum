// Expense tracking for The Art Spa Tulum.
// Leon tells the Telegram bot what was spent (text or a receipt photo); Claude reads it,
// picks a category, and it's saved per month. Fixed monthly costs (rent…) are added automatically.
import { getStore } from "@netlify/blobs";

export const estore = () => getStore("expenses");
export const CATEGORIES = [
  "Oils & spa products",
  "Amazon & online orders",
  "Rent",
  "Utilities (power, water, gas, internet)",
  "Laundry & cleaning",
  "Maintenance & repairs",
  "Marketing & ads",
  "Software & subscriptions",
  "Guest amenities (tea, snacks, flowers)",
  "Staff (non-payroll)",
  "Taxes, bank & card fees",
  "Other",
];
const MODEL = "claude-sonnet-5-5";
const tulumDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Cancun" });
const money = (n, cur = "MXN") => (cur === "MXN" ? "$" : cur + " ") + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Ask Claude to turn a message and/or receipt photo into a clean expense record
export async function parseExpense(text, image) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.type || "image/jpeg", data: image.data } });
  content.push({
    type: "text",
    text: `Today in Tulum is ${tulumDate()}. Extract the business expense from this ${image ? "receipt photo" : "message"}${text ? `: "${text}"` : ""}.
Reply with JSON only: {"amount": number, "currency": "MXN" or "USD" etc (default MXN), "vendor": string, "what": short description, "category": one of ${JSON.stringify(CATEGORIES)}, "date": "YYYY-MM-DD" (default today; use the receipt date if shown), "confident": true/false}.
If there is no clear amount, set amount to 0 and confident to false.`,
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const out = await res.json();
  const raw = (out.content || []).map((c) => c.text || "").join("");
  const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  if (!CATEGORIES.includes(j.category)) j.category = "Other";
  return j;
}

export async function addExpense(e) {
  const month = (e.date || tulumDate()).slice(0, 7);
  const s = estore();
  const list = (await s.get("m-" + month, { type: "json" })) || [];
  const id = (list.reduce((m, x) => Math.max(m, x.id), 0) || 0) + 1;
  const item = { id, date: e.date || tulumDate(), amount: Number(e.amount) || 0, currency: e.currency || "MXN", vendor: e.vendor || "", what: e.what || "", category: e.category || "Other", receipt: !!e.receipt };
  list.push(item);
  await s.setJSON("m-" + month, list);
  return { month, item };
}
export async function updateExpense(month, id, patch) {
  const s = estore(); const list = (await s.get("m-" + month, { type: "json" })) || [];
  const it = list.find((x) => x.id === Number(id)); if (!it) return null;
  Object.assign(it, patch); await s.setJSON("m-" + month, list); return it;
}
export async function deleteExpense(month, id) {
  const s = estore(); const list = (await s.get("m-" + month, { type: "json" })) || [];
  const i = list.findIndex((x) => x.id === Number(id)); if (i < 0) return false;
  list.splice(i, 1); await s.setJSON("m-" + month, list); return true;
}

// Fixed monthly costs: { "Rent": {amount, category} }
export const getFixed = async () => (await estore().get("fixed", { type: "json" })) || {};
export async function setFixed(name, amount, category) {
  const f = await getFixed();
  if (amount == null) delete f[name]; else f[name] = { amount: Number(amount), category: category || (/rent|renta/i.test(name) ? "Rent" : /luz|power|electric|agua|water|gas|internet/i.test(name) ? "Utilities (power, water, gas, internet)" : "Other") };
  await estore().setJSON("fixed", f); return f;
}

export async function monthData(month) {
  const list = (await estore().get("m-" + month, { type: "json" })) || [];
  const fixed = await getFixed();
  const rows = [...list, ...Object.entries(fixed).map(([name, v], i) => ({ id: "F" + (i + 1), date: month + "-01", amount: v.amount, currency: "MXN", vendor: name, what: "Fixed monthly cost", category: v.category, fixed: true }))];
  const by = {}; const other = {};
  for (const r of rows) {
    if (r.currency === "MXN") by[r.category] = (by[r.category] || 0) + r.amount;
    else other[r.currency] = (other[r.currency] || 0) + r.amount;
  }
  return { rows, by, other, total: Object.values(by).reduce((a, b) => a + b, 0) };
}

export async function reportText(month) {
  const d = await monthData(month);
  if (!d.rows.length) return `📊 <b>Expenses ${month}</b>\nNothing recorded yet.`;
  const cats = Object.entries(d.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `• ${esc(k)}: <b>${money(v)}</b>`).join("\n");
  const other = Object.entries(d.other).map(([c, v]) => `\n• Also in ${c}: ${money(v, c)}`).join("");
  return `📊 <b>Expenses ${month}</b>\n\n${cats}${other}\n\n<b>Total: ${money(d.total)} MXN</b>\n${d.rows.filter((r) => !r.fixed).length} purchases + ${d.rows.filter((r) => r.fixed).length} fixed costs`;
}

export const savedText = (month, it) =>
  `🧾 <b>Saved #${it.id}</b> · ${esc(it.date)}\n${money(it.amount, it.currency)} · ${esc(it.vendor || it.what)}${it.what && it.vendor ? " – " + esc(it.what) : ""}\nCategory: <b>${esc(it.category)}</b>`;
export const savedKeyboard = (month, id) => ({
  inline_keyboard: [[{ text: "🏷️ Change category", callback_data: `exk:${month}:${id}` }, { text: "🗑️ Delete", callback_data: `exd:${month}:${id}` }]],
});
export const categoryKeyboard = (month, id) => ({
  inline_keyboard: CATEGORIES.map((c, i) => [{ text: c, callback_data: `exc:${month}:${id}:${i}` }]),
});
export { money, esc, tulumDate };
