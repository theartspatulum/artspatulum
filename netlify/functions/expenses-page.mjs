// Private expenses page: /.netlify/functions/expenses-page?key=…&month=YYYY-MM (add &format=csv to download)
import { webhookSecret } from "../lib/telegram.mjs";
import { monthData, money, esc, tulumDate } from "../lib/expenses.mjs";

export default async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("key") !== webhookSecret()) return new Response("Not found", { status: 404 });
  const month = u.searchParams.get("month") || tulumDate().slice(0, 7);
  const d = await monthData(month);
  if (u.searchParams.get("format") === "csv") {
    const csv = ["Date,Amount,Currency,Vendor,Description,Category,Type", ...d.rows.map((r) => [r.date, r.amount, r.currency, r.vendor, r.what, r.category, r.fixed ? "Fixed" : "Purchase"].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="art-spa-expenses-${month}.csv"` } });
  }
  const prev = new Date(month + "-15"); prev.setMonth(prev.getMonth() - 1);
  const next = new Date(month + "-15"); next.setMonth(next.getMonth() + 1);
  const link = (m) => `?key=${encodeURIComponent(u.searchParams.get("key"))}&month=${m}`;
  const rows = d.rows.sort((a, b) => String(b.date).localeCompare(a.date)).map((r) => `<tr><td>${esc(r.date)}</td><td class="n">${money(r.amount, r.currency)}</td><td>${esc(r.vendor)}</td><td>${esc(r.what)}</td><td>${esc(r.category)}</td><td>${r.fixed ? "Fixed" : r.receipt ? "Receipt" : ""}</td></tr>`).join("");
  const cats = Object.entries(d.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${money(v)}</td><td class="n">${d.total ? Math.round((v / d.total) * 100) : 0}%</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Expenses ${month} · The Art Spa Tulum</title>
<style>body{font:15px/1.5 system-ui,sans-serif;color:#222;max-width:1000px;margin:24px auto;padding:0 16px}h1{font-weight:500}table{border-collapse:collapse;width:100%;margin:12px 0 28px}td,th{border-bottom:1px solid #e6e1d8;padding:8px;text-align:left}th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7a6f5c}.n{text-align:right;white-space:nowrap}.total{font-size:22px}a{color:#8a7a3c}</style></head><body>
<p><a href="${link(prev.toISOString().slice(0, 7))}">← previous</a> · <a href="${link(next.toISOString().slice(0, 7))}">next →</a> · <a href="${link(month)}&format=csv">Download CSV (Excel)</a></p>
<h1>Expenses · ${month}</h1><p class="total">Total <b>${money(d.total)} MXN</b></p>
<h2>By category</h2><table><tr><th>Category</th><th class="n">Amount</th><th class="n">Share</th></tr>${cats}</table>
<h2>All entries</h2><table><tr><th>Date</th><th class="n">Amount</th><th>Vendor</th><th>What</th><th>Category</th><th></th></tr>${rows || '<tr><td colspan="6">Nothing yet.</td></tr>'}</table></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
};
