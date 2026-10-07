// Relais Cloudflare : sert le site Render sous une adresse *.workers.dev
// (certains opérateurs mobiles bloquent les adresses *.onrender.com).
// Coller ce code dans Cloudflare > Workers & Pages > votre worker > Edit code, puis Deploy.
const ORIGIN = "https://sama-abana-studio.onrender.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "");
    headers.set("X-Forwarded-Host", url.host);
    const res = await fetch(ORIGIN + url.pathname + url.search, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? null : await request.arrayBuffer(),
      redirect: "manual",
    });
    const out = new Response(res.body, res);
    const loc = out.headers.get("Location");
    if (loc && loc.startsWith(ORIGIN)) out.headers.set("Location", loc.replace(ORIGIN, url.origin));
    return out;
  },
  // Facultatif : avec un déclencheur « Cron » toutes les 10 min, le site ne s'endort plus.
  async scheduled() {
    await fetch(ORIGIN + "/api/health");
  },
};
