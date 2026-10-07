# Mettre le site en ligne (gratuit, faisable depuis un téléphone)

Trois services gratuits, chacun avec un rôle :

| Service | Rôle | Offre gratuite |
|---|---|---|
| **Render** | héberge le site et l'API | 750 h/mois ; le site s'endort après 15 min sans visite et met environ 1 min à se réveiller |
| **Neon** | base de données PostgreSQL (projets, devis) | 1 Go, sans limite de durée, sans carte bancaire |
| **Resend** | envoie chaque demande de devis sur Samaabana@gmail.com | 100 e-mails par jour, 3 000 par mois |

Pourquoi pas tout chez Render : sa base gratuite est supprimée après 30 jours, et son offre gratuite
bloque l'envoi d'e-mails par SMTP. Neon et Resend contournent ces deux limites.

Prévoir 20 minutes. Gardez un bloc-notes ouvert pour copier deux valeurs (étapes 2 et 3).

---

## Étape 1 — Mettre le code sur GitHub

Créez un compte sur https://github.com si vous n'en avez pas, puis un dépôt vide :
**+ > New repository**, nom `sama-abana-studio`, sans README, puis **Create repository**.

Ensuite, au choix :

- **Avec Claude** : dans Claude, *Paramètres > Connecteurs > GitHub*, connectez votre compte, puis donnez
  à Claude votre nom d'utilisateur GitHub. Claude envoie le code dans le dépôt.
- **Depuis un ordinateur** : dans le dépôt, *Add file > Upload files*, glissez **le contenu** du dossier
  `sama-abana-studio` (pas le dossier lui-même, et pas le fichier .zip), puis *Commit changes*.
  Vérifiez que `render.yaml` et `main.py` apparaissent à la racine du dépôt.

## Étape 2 — Créer la base de données (Neon)

1. Ouvrez https://neon.com, *Sign up*, connectez-vous avec Google.
2. Créez un projet : nom `sama-abana-studio`, région **AWS Europe (Frankfurt)**, la plus proche du Cameroun.
3. Sur le tableau de bord, bouton **Connect** : copiez la *connection string*.
   Elle commence par `postgresql://` et finit par `sslmode=require` (parfois suivi de `&channel_binding=require`).
4. Collez-la dans votre bloc-notes : c'est **DATABASE_URL**.

## Étape 3 — Créer la clé d'envoi d'e-mails (Resend)

1. Ouvrez https://resend.com et créez un compte **avec l'adresse Samaabana@gmail.com**
   (important : sans nom de domaine, Resend n'envoie qu'à l'adresse du compte).
2. Confirmez l'e-mail reçu.
3. Menu **API Keys > Create API Key**, nom `site`, permission *Sending access*, puis **Add**.
4. Copiez la clé (elle commence par `re_` et ne s'affiche qu'une fois) : c'est **RESEND_API_KEY**.

## Étape 4 — Déployer sur Render

1. Ouvrez ce lien en remplaçant `VOTRE-NOM` par votre nom d'utilisateur GitHub :
   `https://render.com/deploy?repo=https://github.com/VOTRE-NOM/sama-abana-studio`
2. Connectez-vous **avec GitHub** et autorisez Render à lire le dépôt.
3. Render lit `render.yaml` et demande deux valeurs : collez **DATABASE_URL** et **RESEND_API_KEY**.
4. Cliquez sur **Deploy Blueprint**. La première mise en ligne prend 3 à 5 minutes.
5. Votre adresse s'affiche en haut du service : `https://sama-abana-studio.onrender.com`
   (ou une variante si le nom est déjà pris).

## Étape 5 — Vérifier

1. Ouvrez `https://VOTRE-ADRESSE.onrender.com/api/health`. Vous devez voir :
   `{"status":"ok","email_notifications":true,"email_provider":"resend"}`
2. Ouvrez le site, envoyez une demande de devis de test : elle arrive sur Samaabana@gmail.com
   (regardez aussi dans *Spam* la première fois et marquez « Non spam »).
3. Votre mot de passe d'administration : Render > votre service > **Environment** > `ADMIN_TOKEN`.
   Il sert dans `https://VOTRE-ADRESSE.onrender.com/docs` pour ajouter des projets et lire les devis.

---

## Pour aller plus loin

- **Nom de domaine** (par exemple `sama-abana.com`) : achetez-le chez un registraire, ajoutez-le dans
  Render > *Settings > Custom Domains*, puis dans Resend > *Domains*. Ensuite, remplacez `EMAIL_FROM`
  par `Motion Design by Sama Abana <devis@votre-domaine.com>` : les clients recevront alors aussi
  un accusé de réception automatique.
- **Éviter la mise en veille** : passez le service Render sur une offre payante, ou acceptez qu'une
  première visite après 15 minutes de calme prenne environ une minute.
- **Mises à jour** : chaque modification envoyée sur GitHub redéploie le site automatiquement.

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| Le déploiement échoue sur `psycopg` | version de Python | vérifiez `PYTHON_VERSION=3.12.8` dans Render > Environment |
| `/api/health` affiche `"email_notifications": false` | clé Resend absente | ajoutez `RESEND_API_KEY` dans Render > Environment, puis *Manual Deploy* |
| Aucun e-mail reçu | compte Resend créé avec une autre adresse | `NOTIFY_EMAIL` doit être l'adresse du compte Resend ; voir Render > *Logs* |
| Les projets ajoutés disparaissent | `DATABASE_URL` vide : le site utilise SQLite, effacé à chaque veille | renseignez la connection string Neon |
