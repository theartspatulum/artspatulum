// /sbcheck: read-only probe of SimplyBook's REST admin API, so we build payments and add-ons on
// what this account really returns. Shows only status codes, field names and add-on names/ids.
import { send, esc } from "./telegram.mjs";
import { rest, restToken, admin } from "./simplybook.mjs";

const keys = (o) => (o && typeof o === "object" ? Object.keys(o).slice(0, 40).join(", ") : String(o).slice(0, 80));
const items = (d) => (Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : []);

export async function sbcheck(d) {
  const out = [];
  try { await restToken(); out.push("✅ REST login OK"); }
  catch (e) { await send(d.chat, "❌ " + esc(e.message)); return; }

  // A real upcoming booking to look at
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Cancun" });
  const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  let bid = null;
  try { const l = await admin("getBookings", [{ date_from: today, date_to: to, booking_type: "non_cancelled" }]); bid = (Array.isArray(l) ? l : Object.values(l || {}))[0]?.id; } catch {}
  if (bid) {
    const b = await rest("GET", `/bookings/${bid}`);
    out.push(`\n<b>GET /bookings/${bid}</b> → ${b.status}\nfields: ${esc(keys(b.data))}`);
    if (b.data?.invoice) out.push(`invoice fields: ${esc(keys(b.data.invoice))}`);
    if (b.data?.products) out.push(`products: ${esc(JSON.stringify(b.data.products).slice(0, 200))}`);
  } else out.push("\n(no upcoming booking found to inspect)");

  for (const p of ["/products?filter[type]=service_addon", "/products", "/invoices?page=1&on_page=1", "/payment-processors", "/settings/payments"]) {
    const r = await rest("GET", p);
    const list = items(r.data);
    let line = `\n<b>GET ${esc(p)}</b> → ${r.status}`;
    if (list.length) {
      line += ` · ${list.length} item(s), fields: ${esc(keys(list[0]))}`;
      if (p.startsWith("/products")) line += "\n" + list.slice(0, 25).map((x) => `• ${esc(x.id)} · ${esc(x.name)} · ${esc(x.type || "")} · ${esc(x.duration ?? "")}`).join("\n");
      if (p.startsWith("/invoices")) line += `\nstatus/processor example: ${esc(String(list[0].status))} / ${esc(String(list[0].payment_processor))}`;
    } else if (r.data) line += ` · ${esc(keys(r.data))}`;
    out.push(line);
  }
  await send(d.chat, "🔬 <b>SimplyBook check</b>\n" + out.join("\n").slice(0, 3800));
}
