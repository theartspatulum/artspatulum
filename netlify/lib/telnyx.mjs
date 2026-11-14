// Talks to Telnyx (our WhatsApp provider) with the spa's API key.
const API = "https://api.telnyx.com/v2";
export async function tx(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Telnyx ${res.status}: ${JSON.stringify(data.errors?.[0]?.detail || data.errors?.[0]?.title || data).slice(0, 160)}`);
  return data;
}
export const businessAccounts = () => tx("/whatsapp/business_accounts");
export const whatsappNumbers = () => tx("/whatsapp/phone_numbers");
