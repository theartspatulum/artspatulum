// Runs every day at 06:00 Tulum time (11:00 UTC) and asks Netlify to rebuild the site.
// Every rebuild pulls the latest prices, durations, photos and treatments from SimplyBook.
// Needs the environment variable BUILD_HOOK_URL (Netlify → Project configuration → Build & deploy → Build hooks).
export default async () => {
  const hook = process.env.BUILD_HOOK_URL;
  if (!hook) {
    console.log("BUILD_HOOK_URL is not set; skipping daily SimplyBook sync");
    return new Response("missing BUILD_HOOK_URL", { status: 200 });
  }
  const res = await fetch(hook, { method: "POST" });
  console.log("Triggered rebuild for SimplyBook sync:", res.status);
  return new Response("ok");
};

export const config = { schedule: "0 11 * * *" };
