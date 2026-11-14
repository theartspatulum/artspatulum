// Runs the concierge in the background (can take 10-30 seconds), then sends the reply.
// Called by telegram-webhook (test mode) and later by the WhatsApp webhook.
import { handleGuestMessage, cstore } from "../lib/concierge.mjs";
import { send, esc } from "../lib/telegram.mjs";
import { getChat } from "../lib/reputation.mjs";
import { webhookSecret } from "../lib/telegram.mjs";

export default async (req) => {
  const data = await req.json().catch(() => ({}));
  if (data.key !== webhookSecret()) return new Response("forbidden", { status: 403 });
  const owner = await getChat();
  try {
    let text = data.text;
    if (data.pending) {
      const p = await cstore().get("pending-" + data.pending, { type: "json" });
      if (!p) return new Response("gone");
      await cstore().delete("pending-" + data.pending);
      text = `[Team update, not from the guest: the owner ${data.approved ? "APPROVED and already made" : "said NO to"} this change: ${p.summary}. Continue with the guest accordingly.]`;
      data.conv = p.conv; data.test = p.test; data.guest = p.guest;
    }
    const reply = await handleGuestMessage({ conv: data.conv, text, guest: data.guest || {}, owner, test: !!data.test });
    if (!reply) return new Response("paused");
    if (data.channel === "telegram") await send(data.chat, `💬 <b>Concierge:</b>\n${esc(reply)}`);
    // WhatsApp channel will be added once Telnyx links the number.
  } catch (e) {
    if (owner) await send(owner, `⚠️ Concierge error: ${esc(String(e.message)).slice(0, 200)}`);
  }
  return new Response("ok");
};
