# Motion Design by Sama Abana — site web

Site vitrine + portfolio + demandes de devis.
Front : HTML, CSS, JavaScript, GSAP + ScrollTrigger, WebGL, Lottie.
Back : Python 3.11+, FastAPI, Pydantic v2, SQLAlchemy v2, SQLite ou PostgreSQL.

```
sama-abana-studio/
├── index.html          page unique
├── style.css           styles (sombre #0a0a0a, Syne + Plus Jakarta Sans)
├── script.js           animations, portfolio, lecteur, formulaire
├── main.py             API FastAPI + base de données + envoi des e-mails
├── requirements.txt
├── .env.example        modèle de configuration
├── assets/
│   ├── fonts/          polices auto-hébergées (licence OFL)
│   ├── lottie/         animation de confirmation du formulaire
│   └── vendor/         GSAP, ScrollTrigger, Lottie (copies locales)
└── media/              vidéos et images du portfolio
```

## 1. Lancer le site sur votre ordinateur

Prérequis : Python 3.11 ou plus récent.

```bash
cd sama-abana-studio
python -m venv .venv
# Windows : .venv\Scripts\activate      macOS / Linux : source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # Windows : copy .env.example .env
uvicorn main:app --reload
```

Ouvrez http://127.0.0.1:8000. La documentation de l'API est sur http://127.0.0.1:8000/docs.

Au premier lancement, la base `studio.db` est créée et remplie avec les 4 extraits NK Beauty.

## 2. Recevoir les demandes de devis sur Samaabana@gmail.com

Chaque demande est **toujours enregistrée en base**. En ligne, utilisez Resend (voir DEPLOY.md).
En local, vous pouvez aussi passer par Gmail :

1. Sur le compte Google Samaabana@gmail.com, activez la validation en deux étapes.
2. Créez un mot de passe d'application : https://myaccount.google.com/apppasswords
3. Dans `.env`, collez-le dans `SMTP_PASSWORD`.
4. Relancez le serveur. http://127.0.0.1:8000/api/health doit afficher `"email_notifications": true`.

Le client reçoit aussi un accusé de réception (désactivable avec `SEND_CLIENT_CONFIRMATION=false`).
Avec Resend, cet accusé n'est envoyé qu'une fois un nom de domaine vérifié (voir DEPLOY.md).
Répondre à l'e-mail de notification répond directement au client.

Si l'envoi échoue côté serveur, le formulaire propose au visiteur d'envoyer sa demande sur WhatsApp
avec le message déjà rédigé : aucune demande n'est perdue.

## 3. Ajouter un projet au portfolio

1. Déposez les fichiers dans `media/` :
   - une image de couverture (`.jpg`, 720×1280 pour du vertical, 1280×720 pour du 16:9),
   - un aperçu court et muet (`-preview.mp4`, 4 à 8 s, 360 px de large, sans son),
   - la vidéo complète (`.mp4` H.264, 720p ou 1080p).
2. Définissez `ADMIN_TOKEN` dans `.env`, relancez le serveur.
3. Ouvrez http://127.0.0.1:8000/docs, cliquez sur `POST /api/admin/projects` puis « Try it out »,
   ajoutez l'en-tête `X-Admin-Token`, et envoyez par exemple :

```json
{
  "title": "Lancement application Mobile Money",
  "slug": "lancement-app-mobile-money",
  "description": "Explainer animé de 45 s pour présenter l'application.",
  "category": "ui_ux_motion",
  "cover_image_url": "media/mobile-money.jpg",
  "video_preview_url": "media/mobile-money-preview.mp4",
  "video_full_url": "media/mobile-money.mp4",
  "client": "Nom du client",
  "aspect_ratio": "16:9",
  "sort_order": 5,
  "is_featured": false
}
```

Catégories possibles : `2d_animation`, `3d_animation`, `ui_ux_motion`, `vfx_compositing`.
Le projet dont `is_featured` vaut `true` et qui arrive en premier s'affiche en grand.

Commandes pour préparer les aperçus avec ffmpeg (le site lit le `.webm` en priorité s'il existe
avec le même nom, sinon le `.mp4`) :

```bash
ffmpeg -ss 5 -t 6 -i film.mp4 -vf "scale=360:-2" -an -c:v libx264 -crf 28 -movflags +faststart film-preview.mp4
ffmpeg -ss 5 -t 6 -i film.mp4 -vf "scale=360:-2" -an -c:v libvpx-vp9 -b:v 0 -crf 40 film-preview.webm
```

## 4. Gérer les demandes reçues

Avec l'en-tête `X-Admin-Token` (depuis `/docs`) :

- `GET /api/admin/quotes` : liste des demandes (filtre `?status=pending`)
- `PATCH /api/admin/quotes/{id}` : changer le statut (`pending`, `in_review`, `approved`, `rejected`)

## 5. Mettre en ligne

Le guide pas à pas (faisable depuis un téléphone) est dans **DEPLOY.md** :
Render pour le site, Neon pour la base de données, Resend pour les e-mails. Les trois ont une offre gratuite.

Sur un VPS ou un autre hébergeur Python :

- Commande de démarrage : `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Variables d'environnement : celles de `.env.example`
- Base PostgreSQL : renseignez `DATABASE_URL` (les adresses `postgres://` et `postgresql://` sont acceptées).
- Sans disque persistant, n'utilisez pas SQLite : les données seraient effacées à chaque redémarrage.

Front et API sur deux domaines différents : indiquez l'adresse de l'API dans
`<meta name="api-base" content="https://api.exemple.com">` (index.html) et le domaine du site dans
`ALLOWED_ORIGINS`.

## 6. Ouvrir sans serveur

`index.html` s'ouvre aussi directement dans le navigateur : le portfolio utilise alors la copie des
projets intégrée à `script.js`, et le formulaire propose l'envoi par WhatsApp. Le serveur reste
nécessaire pour enregistrer les demandes et envoyer les e-mails.

## Accessibilité et performance

- Navigation complète au clavier, lien d'évitement, focus visible, lecteur vidéo en `<dialog>`.
- `prefers-reduced-motion` respecté : pas d'animation d'ouverture, fond figé, pas d'aperçus automatiques.
- Curseur personnalisé uniquement sur souris ; rien ne change sur écran tactile.
- Vidéos chargées à la demande (aperçus au survol sur ordinateur, à l'écran sur mobile).
- Polices, GSAP et Lottie hébergés localement : le site ne dépend d'aucun CDN.

## Licences

- Polices Syne et Plus Jakarta Sans : SIL Open Font License (fichiers dans `assets/fonts/`).
- GSAP : licence standard GreenSock, gratuite pour ce type d'usage (https://gsap.com/standard-license).
- Lottie-web : licence MIT.
