# Migration vers Cloudflare : runbook

Branche `cloudflare-migration`. L'app tourne sur Cloudflare Workers via OpenNext, avec D1 (base), R2 (fichiers),
Queues et Cron Triggers (tâches), Images (photos). Le code métier passe par les ports de `src/platform`
(voir `src/platform/README.md`) : changer de plateforme, par exemple vers Azure, revient à écrire des
adaptateurs.

Transition : Microsoft SSO n'autorise pour l'instant que l'URL Vercel, donc les utilisateurs restent sur
`matecrew.vercel.app` pendant que Cloudflare prend les données. Le même code tourne sur les deux, sur **les
mêmes données** : Vercel lit et écrit la base D1, les fichiers R2 et la file de Cloudflare à travers le pont de
plateforme du worker (`src/platform/cloudflare/bridge`, section « Platform bridge » du README de
`src/platform`). Seuls les Cron Triggers de Cloudflare lancent les tâches planifiées : Vercel n'en lance aucune.

Toutes les étapes ci-dessous touchent le compte Cloudflare OWT, Vercel ou la production : elles sont à lancer
à la main, dans l'ordre. Aucune n'a été lancée pendant la préparation.

## 0. Prérequis

- Compte Cloudflare OWT (`fb4a07dcf42e0226490dbaea4aa55bba`) sur **Workers Paid** (déjà le cas) : le worker fait
  environ 8,2 MiB compressés (limite gratuite 3 MiB) et `limits.cpu_ms` demande le plan payant.
- Service **Cloudflare Images** activé sur le compte (deux transformations par upload de photo).
- `bunx wrangler whoami` montre le compte OWT.
- Déployer depuis un checkout propre ou la CI : OpenNext embarque les fichiers `.env*` de Next dans le bundle,
  jamais depuis une machine dont `.env.local` contient des valeurs de production.

## 1. Ressources Cloudflare (données en UE)

```sh
bunx wrangler d1 create matecrew --jurisdiction eu      # coller l'id dans wrangler.jsonc (d1_databases[0].database_id)
bunx wrangler r2 bucket create matecrew-files --jurisdiction eu
bunx wrangler queues create matecrew-jobs
bunx wrangler queues create matecrew-jobs-dlq
bunx wrangler d1 migrations apply matecrew --remote
```

## 2. Worker Cloudflare, pont compris

Secrets (`bunx wrangler secret put <NOM>`) : `BETTER_AUTH_SECRET`, `MICROSOFT_CLIENT_SECRET`, `SLACK_BOT_TOKEN`,
`SLACK_SIGNING_SECRET`, `RESEND_API_KEY`, et `PLATFORM_BRIDGE_SECRET`.

`PLATFORM_BRIDGE_SECRET` signe chaque requête de Vercel vers le pont. Il donne un accès complet en lecture et en
écriture à la base et aux fichiers : c'est un identifiant de base de données. Le générer avec
`openssl rand -base64 48` (32 caractères au minimum, sinon le pont reste fermé), le garder dans le gestionnaire
de mots de passe pour l'étape 4, ne jamais l'écrire dans un fichier du dépôt.

Variables (tableau de bord ou bloc `vars`) : `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` (aussi au build),
`ALLOWED_EMAIL_DOMAINS`, `DISABLE_PASSWORD_AUTH`, `EMAIL_DOMAIN_ALIASES`, `MICROSOFT_CLIENT_ID`,
`MICROSOFT_TENANT_ID`, `SLACK_BOT_USERNAME`, `SLACK_BOT_ICON_URL`, `EMAIL_FROM`, `DEVICE_UI_APP`, `DEVICE_UI_THEME`.
Les noms sont dans `.dev.vars.example`. Plus utilisés : `QSTASH_*`, `CRON_SECRET`, `STORAGE_PROVIDER`, `R2_*`,
`S3_*`, `VERCEL_*`.

URL du worker : `https://matecrew.<sous-domaine>.workers.dev` (domaine propre plus tard : la zone `owt.team`
est chez Infomaniak).

1. Premier déploiement et test, sans données réelles, avec `BETTER_AUTH_URL` et `NEXT_PUBLIC_APP_URL` sur
   l'URL du worker :
   ```sh
   bun run deploy
   ```
   Tester sur l'URL `workers.dev` : inscription par mot de passe, pages, terminal virtuel. Déclencher une tâche
   planifiée depuis l'admin (Cron, « lancer maintenant »). Vérifier que le pont reste fermé sans signature :
   `curl -si -X POST https://matecrew.<sous-domaine>.workers.dev/__platform/d1/query` doit répondre la page 404
   de l'app, comme n'importe quelle adresse inconnue.
2. Pour la transition, mettre `BETTER_AUTH_URL` et `NEXT_PUBLIC_APP_URL` du worker sur
   `https://matecrew.vercel.app`, puis `bun run deploy` à nouveau (`NEXT_PUBLIC_APP_URL` est figée au build).
   Les messages Slack et les mails que les crons et la file du worker envoient contiennent des liens vers
   l'app : ils mènent ainsi à l'URL où les utilisateurs peuvent se connecter. En contrepartie, on ne peut plus
   se connecter sur l'URL `workers.dev` (Better Auth n'accepte que son URL) ; le terminal, les crons, la file et
   le pont n'en dépendent pas.

## 3. Copie des données (fenêtre de maintenance)

1. Arrêter les écritures sur l'app Vercel (maintenance) et le terminal. Supprimer les planifications QStash :
   à partir de maintenant, seuls les Cron Triggers du worker envoient les messages Slack, sinon les deux
   enverraient chacun le leur.
2. Base :
   ```sh
   SOURCE_DATABASE_URL=<URL directe Neon> bun scripts/cloudflare/copy-db.ts export
   bun scripts/cloudflare/copy-db.ts apply --remote
   SOURCE_DATABASE_URL=<URL directe Neon> bun scripts/cloudflare/copy-db.ts verify --remote
   ```
   `verify` doit être entièrement concordant (lignes, identifiants, centimes, quantités, octets). L'export vide
   d'abord les tables D1 : les données de test de l'étape 2 disparaissent.
3. Fichiers : créer un jeton API R2 (Object Read & Write sur `matecrew-files`), puis avec `BLOB_READ_WRITE_TOKEN`,
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` :
   ```sh
   bun scripts/cloudflare/copy-blobs.ts --dry-run
   bun scripts/cloudflare/copy-blobs.ts      # relancer jusqu'à 0 échec (reprise automatique)
   ```

## 4. Variables du projet Vercel

Settings → Environment Variables, environnement Production :

- `PLATFORM_BRIDGE_URL` : l'origine du worker, `https://matecrew.<sous-domaine>.workers.dev` (sans chemin).
- `PLATFORM_BRIDGE_SECRET` : la même valeur que le secret du worker, en variable « Sensitive ».
- `BETTER_AUTH_URL` et `NEXT_PUBLIC_APP_URL` : `https://matecrew.vercel.app`.
- `BETTER_AUTH_SECRET` : la même valeur que sur le worker, puisque les deux partagent les sessions et les comptes.
- Inchangées : `ALLOWED_EMAIL_DOMAINS`, `DISABLE_PASSWORD_AUTH`, `EMAIL_DOMAIN_ALIASES`, `MICROSOFT_CLIENT_ID`,
  `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`,
  `SLACK_BOT_USERNAME`, `SLACK_BOT_ICON_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `DEVICE_UI_APP`, `DEVICE_UI_THEME`.
- À supprimer, avec les intégrations Neon et Vercel Blob si elles les injectent : `DATABASE_URL`, `DIRECT_URL`,
  `DATABASE_URL_UNPOOLED` et les autres variables Neon (`PG*`, `POSTGRES_*`), `BLOB_READ_WRITE_TOKEN`,
  `STORAGE_PROVIDER`, `R2_*`, `S3_*`, `QSTASH_*`, `CRON_SECRET`.

Pas besoin de `PLATFORM` : le build de Vercel définit `VERCEL`, qui choisit les adaptateurs `vercel`.
`vercel.json` fixe la région `fra1`, près de la base D1 en UE, et la commande de build `next build` : aucune
migration Prisma sur Vercel, le schéma D1 se migre avec wrangler (étape 1). `postinstall` lance toujours
`prisma generate`.

## 5. Fusion dans `main`

Fusionner `cloudflare-migration` dans `main` : Vercel déploie la production, désormais sur D1, R2 et la file de
Cloudflare à travers le pont.

1. Vérifier sur `matecrew.vercel.app` : connexion Microsoft, pages avec données, upload d'une photo d'article
   (R2), images du terminal (page Articles de chaque bureau, bouton « Calculer » pour les photos sans image
   terminal).
2. Terminal : console série `site https://matecrew.<sous-domaine>.workers.dev`. Il parle ainsi directement au
   worker, sans passer par le pont : son attente longue interroge la base toutes les 500 ms, ce qui ferait sinon
   une requête de pont à chaque fois. Le jeton reste valable (la base est copiée), et l'appairage d'un nouveau
   terminal renvoie toujours vers `matecrew.vercel.app`.
3. Lever la maintenance.

Slack (URL d'interactivité) et le connecteur MCP Claude restent sur `matecrew.vercel.app` : ils fonctionnent sur
les données partagées.

Les sessions Vercel et Cloudflare vivent toutes dans la base partagée, mais les cookies restent propres à chaque
domaine : se connecter sur une URL ne connecte pas sur l'autre.

## 6. Plus tard : utilisateurs sur Cloudflare, retrait de Vercel

1. Microsoft Entra : ajouter l'URI de redirection `https://<URL Cloudflare>/api/auth/callback/microsoft`.
2. Worker : `BETTER_AUTH_URL` et `NEXT_PUBLIC_APP_URL` sur l'URL Cloudflare, puis `bun run deploy`.
3. Slack : URL d'interactivité `https://<URL Cloudflare>/api/slack/interactions`. Connecteur MCP Claude :
   nouvelle URL `https://<URL Cloudflare>/api/mcp`. Annoncer la nouvelle URL aux utilisateurs.
4. Terminal sur l'URL Cloudflare, si ce n'est pas déjà fait (étape 5).
5. Une fois Vercel inutilisé : `bunx wrangler secret delete PLATFORM_BRIDGE_SECRET` ferme le pont. Retirer
   Vercel, Neon, Vercel Blob et QStash.
6. Code : retirer le pont et les adaptateurs Vercel (liste à la fin de la section « Platform bridge » du README
   de `src/platform`), `scripts/cloudflare/copy-blobs.ts` et ses dépendances de dev (`@vercel/blob`,
   `@aws-sdk/client-s3`), et la partie Vercel de `scripts/clone-prod-db.sh`.

## Développement local

- `bun run dev` : adaptateurs Node (SQLite `.data/`, fichiers `.data/storage`).
- `bun run dev:cf` : `next dev` avec les ressources Cloudflare locales.
- `bun run preview` : build du worker dans workerd en local (port 8787). Déclencher un cron :
  `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"`.
- `PLATFORM=vercel bunx next build` : build des adaptateurs Vercel. Pour les essayer en local contre le pont de
  `bun run preview` (avec `PLATFORM_BRIDGE_SECRET` dans `.dev.vars`) : `PLATFORM=vercel bun run dev` avec
  `PLATFORM_BRIDGE_URL=http://localhost:8787` et le même secret.
- `bun run db:migrate:local`, `bun run db:migrate:sqlite`, `bun run db:migration <nom>`, `SEED_PASSWORD=… bun run seed`.
- Qualité : `bun run lint` (règles SonarQube incluses), `bun test`, `bunx tsc --noEmit`.
  `tests/platform/bridge.integration.test.ts` lance `wrangler dev` en local (D1, R2 et file locales, aucun compte).

## Points d'attention

- D1 n'a pas de transactions interactives, et Prisma ne rend aucun `$transaction` atomique sur D1 : toutes les
  écritures groupées passent par `commitBatch` (lot D1 avec gardes conditionnelles). `$transaction` ne compile plus.
  Sur Vercel, le lot part en une requête de pont et s'exécute dans le worker : mêmes gardes, même annulation.
- Chaque requête SQL de Vercel fait un aller-retour HTTPS vers le worker : environ 1,5 ms en local, plus le
  réseau entre `fra1` et Cloudflare. Chaque aller-retour compte comme une requête Workers (10 millions par mois
  inclus dans Workers Paid).
- Changer `PLATFORM_BRIDGE_SECRET` : le mettre à jour sur le worker et sur Vercel (puis redéployer Vercel) au
  même moment. Entre les deux, Vercel échoue avec « The platform bridge did not answer ». Les horloges des deux
  côtés doivent rester à moins de 60 s l'une de l'autre.
- « Lancer maintenant » dans l'admin de Vercel exécute la tâche dans la fonction Vercel : c'est voulu, une
  exécution manuelle ne double pas les Cron Triggers.
- La file des mails de décompte n'a pas été testée de bout en bout en local (pas d'envoi local de message) : à
  vérifier à la première clôture mensuelle.
- `proxy.ts` (Next 16) fonctionne, mais OpenNext marque encore le middleware Node comme expérimental.
- Marge de taille du worker : environ 1,8 MiB sous la limite de 10 MiB.
