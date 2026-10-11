# Migration vers Cloudflare : runbook

Branche `cloudflare-migration`. L'app tourne sur Cloudflare Workers via OpenNext, avec D1 (base), R2 (fichiers),
Queues et Cron Triggers (tâches), Images (photos). Le code métier passe par les ports de `src/platform`
(voir `src/platform/README.md`) : changer de plateforme, par exemple vers Azure, revient à écrire des
adaptateurs.

## Principe de la transition : Vercel en proxy

Microsoft SSO n'autorise pour l'instant que l'URL `matecrew.vercel.app`. Elle reste l'adresse publique, mais
**Vercel ne fait plus tourner l'app** : `vercel.json` relaie toutes les requêtes (`rewrites`) vers le worker
Cloudflare, qui fait tout, rendu SSR compris, avec D1 en accès direct. Une seule copie des données, chez
Cloudflare.

- Better Auth tourne sur le worker avec `BETTER_AUTH_URL=https://matecrew.vercel.app` : Microsoft renvoie vers
  `matecrew.vercel.app/api/auth/callback/microsoft`, Vercel relaie, le worker valide. Les cookies restent sur
  `matecrew.vercel.app`, le seul domaine que le navigateur voit.
- Next.js accepte les server actions venant de l'origine publique (`serverActions.allowedOrigins`, calculé depuis
  `NEXT_PUBLIC_APP_URL` au build).
- Le terminal parle directement au worker (`….workers.dev`) : plus rapide, et les WebSockets du futur canal temps
  réel ne passent pas par les rewrites Vercel.
- L'adaptateur `vercel` et le pont signé (`src/platform/cloudflare/bridge`) restent dans le code comme option
  (faire tourner le SSR sur Vercel avec les données Cloudflare) ; le pont est fermé tant que
  `PLATFORM_BRIDGE_SECRET` n'est pas défini sur le worker. Ce runbook ne l'utilise pas.

Toutes les étapes ci-dessous touchent le compte Cloudflare OWT, Vercel ou la production : elles sont à lancer à
la main, dans l'ordre. Aucune n'a été lancée pendant la préparation.

## 0. Prérequis

- Compte Cloudflare OWT (`fb4a07dcf42e0226490dbaea4aa55bba`) sur **Workers Paid** (déjà le cas) : le worker fait
  environ 8,4 MiB compressés (limite gratuite 3 MiB) et `limits.cpu_ms` demande le plan payant.
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

## 2. Worker Cloudflare

URL du worker : `https://matecrew.owt.workers.dev` (déjà dans `vercel.json`).

`SCHEDULES_ENABLED` est fixé à `"false"` dans `wrangler.jsonc` : tant que Vercel et Neon servent la production,
leurs planifications QStash envoient les messages Slack et les mails ; ce worker les enverrait une seconde fois.

1. Premier déploiement (`NEXT_PUBLIC_APP_URL` est lu au build, pour les liens et les server actions relayées) :
   ```sh
   NEXT_PUBLIC_APP_URL=https://matecrew.vercel.app bun run deploy
   ```
2. Variables : reprendre celles de la production Vercel, sans les afficher.
   ```sh
   bun scripts/cloudflare/vercel-env-to-worker.ts --dry-run   # noms seulement : repris, manquants
   bun scripts/cloudflare/vercel-env-to-worker.ts
   ```
   Le script lit les variables avec `vercel env pull` (projet déjà lié dans `.vercel/`), garde les noms que le
   worker lit (`.dev.vars.example`) et les pose comme secrets du worker (`wrangler secret bulk` ; les secrets
   survivent aux déploiements, contrairement aux variables du tableau de bord). `BETTER_AUTH_URL` et
   `NEXT_PUBLIC_APP_URL` restent donc `https://matecrew.vercel.app`. Il écrit aussi `.env.migration.local`
   (ignoré par git, lisible par toi seul) avec la base Neon et le jeton Vercel Blob pour les scripts de copie.
   Les fichiers temporaires sont supprimés ; aucune valeur n'est affichée. Pas de `PLATFORM_BRIDGE_SECRET` : le
   pont reste fermé.
3. Tester directement sur `workers.dev` ce qui ne demande pas de connexion (Better Auth n'accepte que
   `matecrew.vercel.app`) : pages publiques, `/api/device/state` avec un terminal de test, terminal virtuel.

## 3. Preview Vercel de la branche (proxy)

Pousser la branche : Vercel construit une preview avec le `vercel.json` de la branche, donc une preview **proxy**
vers le worker (build instantané, rien à installer).

- Vérifier que les pages arrivent bien du worker, et qu'un upload de plus de 5 Mo (facture) passe par le proxy.
- La connexion ne fonctionne pas sur l'URL de preview (ni le SSO ni Better Auth ne la connaissent) : c'est normal.

## 4. Bascule (fenêtre de maintenance)

1. Arrêter les écritures sur l'app Vercel (maintenance) et le terminal. Supprimer les planifications QStash.
2. Base :
   ```sh
   bun --env-file=.env.migration.local scripts/cloudflare/copy-db.ts export
   bun scripts/cloudflare/copy-db.ts apply --remote
   bun --env-file=.env.migration.local scripts/cloudflare/copy-db.ts verify --remote
   ```
   `verify` doit être entièrement concordant (lignes, identifiants, centimes, quantités, octets). L'export vide
   d'abord les tables D1 : les données de test de l'étape 2 disparaissent.
3. Fichiers : créer un jeton API R2 (Object Read & Write sur `matecrew-files`) et ajouter `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` à `.env.migration.local` (`BLOB_READ_WRITE_TOKEN` y est déjà) :
   ```sh
   bun --env-file=.env.migration.local scripts/cloudflare/copy-blobs.ts --dry-run
   bun --env-file=.env.migration.local scripts/cloudflare/copy-blobs.ts   # relancer jusqu'à 0 échec
   ```
   Supprimer `.env.migration.local` une fois la copie vérifiée.
4. `SCHEDULES_ENABLED` : `"true"` dans `wrangler.jsonc`, puis
   `NEXT_PUBLIC_APP_URL=https://matecrew.vercel.app bun run deploy`.
5. Fusionner `cloudflare-migration` dans `main` : la production Vercel devient le proxy.
6. Vérifier sur `matecrew.vercel.app` : connexion Microsoft, pages avec données, upload d'une photo d'article,
   bouton Slack (l'URL d'interactivité reste `matecrew.vercel.app/api/slack/interactions`, relayée), connecteur
   MCP (inchangé, relayé). Page Articles de chaque bureau : bouton « Calculer » pour les images du terminal.
7. Terminal : console série `site https://matecrew.owt.workers.dev` (le jeton reste valable).
8. Lever la maintenance.

Retour arrière : « Instant Rollback » de Vercel vers le déploiement précédent (l'app sur Neon). Ce qui a été
écrit dans D1 depuis la bascule n'existe pas dans Neon : à décider au cas par cas, d'où l'intérêt de vérifier
juste après la bascule.

## 4 bis. Relais temps réel des terminaux

Un second Worker, `matecrew-realtime` (`realtime/`), tient un Durable Object par terminal (dans l'UE) : le terminal
et les consoles y gardent un WebSocket, le site l'appelle en RPC (binding `TERMINALS` avec `script_name`). Il lit
seulement `Device.tokenHash` dans la même D1. Aucun secret à poser.

1. Déployer le relais **avant** le site (le binding du site nomme son script) :
   ```sh
   cd realtime && bun run deploy        # wrangler deploy, matecrew-realtime.owt.workers.dev
   ```
2. Déployer le site (`REALTIME_URL` est une variable de `wrangler.jsonc`) :
   ```sh
   NEXT_PUBLIC_APP_URL=https://matecrew.vercel.app bun run deploy
   ```
3. Vérifier : la console d'un terminal dit « Canal direct ouvert » dans son journal, et le terminal (firmware
   0.4.0 et plus, ou le terminal virtuel) affiche `relay: connected` sur la console série.
4. Publier le firmware (`just release` puis `just publish` depuis `device/`) : l'ancien firmware continue en
   long-poll jusqu'à sa mise à jour.

Si le relais tombe, le site retombe sur le polling (`noRelay`), et le terminal sur le long-poll, tout seuls.
En local, `jurisdiction("eu")` n'existe pas dans workerd : `realtime/src/locate.ts` prend l'espace de noms simple.

## 5. Plus tard : URL Cloudflare et retrait de Vercel

1. Domaine propre si voulu (Cloudflare for SaaS, voir la discussion `matecrew.owt.team`), sinon `workers.dev`.
2. Microsoft Entra : ajouter l'URI de redirection `https://<URL Cloudflare>/api/auth/callback/microsoft`.
3. Worker : secrets `BETTER_AUTH_URL` et `NEXT_PUBLIC_APP_URL` sur l'URL Cloudflare
   (`bunx wrangler secret put …`), puis `NEXT_PUBLIC_APP_URL=<URL Cloudflare> bun run deploy`.
4. Slack : URL d'interactivité `https://<URL Cloudflare>/api/slack/interactions`. Connecteur MCP Claude :
   `https://<URL Cloudflare>/api/mcp`. Annoncer la nouvelle URL.
5. Retirer le projet Vercel, Neon, Vercel Blob et QStash ; supprimer `scripts/cloudflare/copy-blobs.ts` et ses
   dépendances de dev (`@vercel/blob`, `@aws-sdk/client-s3`), la partie Vercel de `scripts/clone-prod-db.sh`, et
   `vercel.json` / `deploy/vercel-proxy`.

## Développement local

- `bun run dev` : adaptateurs Node (SQLite `.data/`, fichiers `.data/storage`).
- `bun run dev:cf` : `next dev` avec les ressources Cloudflare locales.
- `bun run preview` : build du worker dans workerd en local (port 8787). Les crons y sont coupés comme en
  production tant que `SCHEDULES_ENABLED` vaut `"false"`.
- `bun run db:migrate:local`, `bun run db:migrate:sqlite`, `bun run db:migration <nom>`, `SEED_PASSWORD=… bun run seed`.
- Qualité : `bun run lint` (règles SonarQube incluses), `bun test`, `bunx tsc --noEmit`.

## Points d'attention

- D1 n'a pas de transactions interactives, et Prisma ne rend aucun `$transaction` atomique sur D1 : toutes les
  écritures groupées passent par `commitBatch` (lot D1 avec gardes conditionnelles). `$transaction` ne compile plus.
- Proxy Vercel : un saut réseau de plus par requête du navigateur (Vercel → Cloudflare), mais aucun par requête
  SQL. Taille maximale des requêtes relayées à vérifier à l'étape 3 (uploads de factures). Les WebSockets ne
  passent pas par les rewrites.
- `NEXT_PUBLIC_APP_URL` doit être défini au build du worker : sinon Next refuse les server actions arrivant par
  `matecrew.vercel.app`. Le secret du worker ne suffit pas (lu à l'exécution) : `build:cloudflare`, que lance
  Workers Builds, le fixe à `https://matecrew.vercel.app` par défaut.
- La file des mails de décompte n'a pas été testée de bout en bout en local (pas d'envoi local de message) : à
  vérifier à la première clôture mensuelle.
- `proxy.ts` (Next 16) fonctionne, mais OpenNext marque encore le middleware Node comme expérimental.
- Marge de taille du worker : environ 1,6 MiB sous la limite de 10 MiB.
