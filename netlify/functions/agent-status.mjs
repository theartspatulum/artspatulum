// Shows which agent settings are present (yes/no only — never the values).
import { getStore } from "@netlify/blobs";
import { services, therapists, freeTimes } from "../lib/simplybook.mjs";
import { businessAccounts, whatsappNumbers, tx } from "../lib/telnyx.mjs";

export default async () => {
  const has = (k) => (process.env[k] ? "✅ set" : "❌ missing");
  let chat = "❌ not yet (send /start to the bot)";
  try { if (process.env.TELEGRAM_CHAT_ID || (await getStore("reputation").get("chat"))) chat = "✅ connected"; } catch {}
  let last = "never (run checkReviewEmails in Apps Script)";
  try {
    const l = await getStore("reputation").get("last-email-call", { type: "json" });
    if (l) last = `${new Date(l.at).toLocaleString("en-US", { timeZone: "America/Cancun" })} (Tulum time) — ${l.result}`;
  } catch {}
  let emails = [];
  try {
    const list = (await getStore("reputation").get("email-log", { type: "json" })) || [];
    emails = list.map((e) => `  ${new Date(e.at).toLocaleString("en-US", { timeZone: "America/Cancun" })} · ${e.subject} → ${e.outcome}`);
  } catch {}
  let sb = "❌ SIMPLYBOOK_API_KEY missing";
  if (process.env.SIMPLYBOOK_API_KEY) {
    try {
      const ev = Object.values(await services() || {}).filter((e) => e.is_public !== "0" && e.is_active !== "0");
      const un = Object.values(await therapists() || {});
      const durs = [...new Set(ev.map((e) => Number(e.duration)))].sort((a, b) => a - b).join(", ");
      const d = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      let slots = "";
      try {
        const m = await freeTimes(d, d, ev[0].id);
        slots = ` · test: "${ev[0].name}" has ${(m?.[d] || []).length} free start times tomorrow`;
      } catch (e) { slots = " · free-times test failed: " + String(e.message).slice(0, 80); }
      sb = `✅ connected — ${ev.length} services, ${un.length} therapists/rooms, lengths: ${durs} min${slots}`;
    } catch (e) { sb = "❌ key set but SimplyBook said: " + String(e.message).slice(0, 120); }
  }
  let wa = "❌ TELNYX_API_KEY missing";
  if (process.env.TELNYX_API_KEY) {
    try {
      const b = (await businessAccounts()).data || [];
      const n = (await whatsappNumbers()).data || [];
      const nums = n.map((x) => `${x.phone_number || x.display_phone_number || "?"} (${[x.status, x.coexistence_state, x.is_on_biz_app ? "app+API" : ""].filter(Boolean).join(", ")})`).join("; ");
      let su = "";
      for (const sid of ["01a1db1d-666c-749e-b3ea-1016889c1c36", "01a1db34-c207-7055-8efa-bd0530e5d68b"]) {
        try { const r = await tx(`/whatsapp/signup/${sid}/status`); su += ` · signup ${sid.slice(0, 8)}: ${JSON.stringify(r.data || r).slice(0, 400)}`; }
        catch (e) { su += ` · signup ${sid.slice(0, 8)}: ${String(e.message).slice(0, 160)}`; }
      }
      wa = `✅ key works${su} — ${b.length} WhatsApp business account(s): ${b.map((x) => x.name || x.id).join(", ") || "none"} · numbers: ${nums || "none yet"}`;
    } catch (e) { wa = "❌ key set but Telnyx said: " + String(e.message).slice(0, 160); }
  }
  const lines = [
    "The Art Spa — agent status",
    "",
    `Telegram bot token ........ ${has("TELEGRAM_BOT_TOKEN")}`,
    `Telegram chat (/start) .... ${chat}`,
    `Anthropic key (brain) ..... ${has("ANTHROPIC_API_KEY")}`,
    `Reviews email secret ...... ${has("REVIEWS_EMAIL_SECRET")}`,
    `Google Places key ......... ${process.env.GOOGLE_PLACES_API_KEY ? "✅ set" : "— optional, not set"}`,
    `SimplyBook daily hook ..... ${has("BUILD_HOOK_URL")}`,
    `SimplyBook secret key ..... ${has("SIMPLYBOOK_SECRET_KEY")}`,
    `SimplyBook booking API .... ${sb}`,
    `WhatsApp via Telnyx ....... ${wa}`,
    "",
    `Last contact from Gmail ... ${last}`,
    "",
    "Last review emails received:",
    ...(emails.length ? emails : ["  (none yet)"]),
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};
