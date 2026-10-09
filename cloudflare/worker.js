// Relais Cloudflare du site Motion Design by Sama Abana
// 1. Sert le site Render sous l'adresse *.workers.dev (certains réseaux mobiles bloquent *.onrender.com).
// 2. Si Render ne répond pas, affiche une page de secours avec WhatsApp et e-mail au lieu d'une erreur.
// 3. Réveille le site toutes les 10 minutes (déclencheur « Cron »).
// Coller ce code dans Cloudflare > Workers & Pages > votre worker > Edit code, puis Deploy.
const ORIGIN = "https://sama-abana-studio.onrender.com";
const WHATSAPP = "237656294043";
const EMAIL = "samaabana@gmail.com";
const DELAI = 25000; // sans réponse après 25 secondes, on affiche la page de secours

export default {
  async fetch(request, env = {}) {
    const origin = env.ORIGIN || ORIGIN;
    const url = new URL(request.url);
    // une page ouverte par un visiteur (et non un appel de l'API ou un fichier)
    const page = request.method === "GET" && !url.pathname.startsWith("/api/")
      && (request.headers.get("Accept") || "").includes("text/html");
    // aperçu de la page de secours : https://votre-relais.workers.dev/?apercu-secours
    if (url.searchParams.has("apercu-secours")) return secours(true);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "");
    headers.set("X-Forwarded-Host", url.host);
    let res;
    try {
      res = await fetch(origin + url.pathname + url.search, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? null : await request.arrayBuffer(),
        redirect: "manual",
        signal: page ? AbortSignal.timeout(Number(env.DELAI) || DELAI) : undefined,
      });
    } catch (err) {
      return secours(page);
    }
    if (page && res.status >= 500) return secours(true);
    const out = new Response(res.body, res);
    const loc = out.headers.get("Location");
    if (loc && loc.startsWith(origin)) out.headers.set("Location", loc.replace(origin, url.origin));
    return out;
  },
  async scheduled(event, env = {}) {
    await fetch((env.ORIGIN || ORIGIN) + "/api/health");
  },
};

function secours(page) {
  const headers = { "Retry-After": "60", "Cache-Control": "no-store" };
  if (!page) {
    return new Response(JSON.stringify({ detail: "Le site est momentanément indisponible." }),
      { status: 503, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  }
  return new Response(PAGE, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

const MESSAGE = encodeURIComponent("Bonjour Sama Abana, j'aimerais parler d'un projet de motion design.");
const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="theme-color" content="#0a0a0a">
<title>Motion Design by Sama Abana · de retour dans un instant</title>
<style>
:root{color-scheme:dark;--ink:#0a0a0a;--bone:#ece8e1;--fog:#9a968f;--key:#ffb547;--rule:#2c2a27}
*{box-sizing:border-box}
body{margin:0;min-height:100svh;background:var(--ink);color:var(--bone);font:400 17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
display:flex;flex-direction:column;padding:max(24px,env(safe-area-inset-top)) 22px max(24px,env(safe-area-inset-bottom))}
.brand{font:900 15px/1 "Arial Black",system-ui,sans-serif;letter-spacing:.02em;text-transform:uppercase}
.brand span{color:var(--fog);font:600 12px system-ui,sans-serif;letter-spacing:.12em;margin-left:8px}
main{flex:1;display:flex;flex-direction:column;justify-content:center;max-width:640px;width:100%;margin:0 auto;padding:40px 0}
h1{font:900 clamp(36px,9vw,64px)/1 "Arial Black",system-ui,sans-serif;letter-spacing:-.03em;margin:0 0 20px}
h1 em{font-style:normal;color:var(--key)}
p{margin:0 0 28px;color:#cfcac2;max-width:34em}
.actions{display:flex;flex-wrap:wrap;gap:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:54px;padding:0 24px;border-radius:99px;font-weight:700;text-decoration:none;color:var(--bone);border:1px solid var(--rule)}
.btn--key{background:var(--key);color:#1a1205;border-color:var(--key)}
.btn svg{width:20px;height:20px;fill:currentColor}
.timeline{margin-top:44px;display:flex;align-items:center;gap:14px;color:var(--fog);font:600 13px ui-monospace,monospace}
.track{position:relative;flex:1;height:2px;background:var(--rule)}
.track::before{content:"";position:absolute;inset:0 auto 0 0;width:100%;background:var(--key);transform-origin:left;animation:play 30s linear forwards}
.key{position:absolute;top:50%;left:0;width:12px;height:12px;margin:-6px 0 0 -6px;background:var(--key);transform:rotate(45deg);animation:move 30s linear forwards}
@keyframes play{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes move{to{left:100%}}
.retry{margin-top:14px;font-size:14px;color:var(--fog)}
.retry a{color:var(--key)}
@media (prefers-reduced-motion:reduce){.track::before,.key{animation:none}.track::before{transform:none}}
</style></head><body>
<div class="brand">Sama Abana<span>Motion Design</span></div>
<main>
<h1>Le studio revient <em>dans un instant.</em></h1>
<p>Le site fait une courte pause technique. Votre projet, lui, n'attend pas : écrivez-nous directement, nous répondons rapidement.</p>
<div class="actions">
<a class="btn btn--key" href="https://wa.me/${WHATSAPP}?text=${MESSAGE}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z"/></svg>Écrire sur WhatsApp</a>
<a class="btn" href="mailto:${EMAIL}?subject=${encodeURIComponent("Demande de devis")}">Envoyer un e-mail</a>
</div>
<div class="timeline" aria-hidden="true"><span id="tc">00:00</span><div class="track"><span class="key"></span></div><span>00:30</span></div>
<p class="retry" role="status">Nouvel essai automatique dans <span id="s">30</span> secondes. <a href="">Réessayer maintenant</a></p>
</main>
<script>
var n=30,s=document.getElementById("s"),tc=document.getElementById("tc");
setInterval(function(){n--;if(n<=0)location.reload();else{s.textContent=n;var t=30-n;tc.textContent="00:"+(t<10?"0":"")+t;}},1000);
</script>
</body></html>`;
