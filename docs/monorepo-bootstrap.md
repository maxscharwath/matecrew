# Monorepo et bootstrap par runtime : plan

Statut : plan, rien n'est encore déplacé. À démarrer **après** la fusion de `cloudflare-migration` sur `main`
(Vercel sur Neon validé en preview puis en prod), pour ne pas toucher au projet Vercel pendant la fusion.

## Objectifs

1. Des frontières nettes : les **apps** déployables d'un côté, les **paquets** réutilisables de l'autre.
2. Un paquet par runtime pour les adaptateurs : un bundle ne peut embarquer que le code de sa cible.
3. Une **description déclarative par cible** (Cloudflare, Vercel, Node, plus tard Azure) et une commande
   `bun run setup <cible>` qui en génère la config, vérifie l'environnement, prépare le local, provisionne à
   distance sur confirmation, build et déploie.
4. Publier les SDK génériques (Bluetooth, cache, kit d'écrans) comme paquets autonomes.

## Structure cible

```
apps/
  web/                 site Next.js (aujourd'hui à la racine)
  realtime/            Worker temps réel (aujourd'hui realtime/)
  firmware/            firmware ESP32 (aujourd'hui device/firmware)
  sim/                 simulateur PNG (device/sim)
packages/
  platform/            ports : interfaces, contrats, tests de contrat partagés
  platform-cloudflare/ D1, R2, Queue, Cron, Images, PDF (yoga en module wasm)
  platform-vercel/     Postgres (Neon), Vercel Blob, QStash, after()
  platform-node/       SQLite (libSQL), fichiers locaux, sharp, PDF Node
  device-ui/           SDK TSX : runtime, kit, compilateur, studio, émulateur (device/sdk)
  device-link/         SDK Bluetooth (device/sdk/link), publiable
  device-cache/        SDK cache TS (device/sdk/cache), publiable
  device-apps/         écrans maté, system, showcase, hello (device/apps) et leurs dist/
crates/                workspace Cargo unique
  engine/ engine-wasm/ core/ ui/ board/ cache/ web/
targets/
  cloudflare.ts  vercel.ts  node.ts  (azure.ts plus tard)
tools/
  setup/               la commande de bootstrap
  fonts/ icons/        outils de génération (device/tools, sdk/tools)
docs/
```

### Correspondance des chemins

| Aujourd'hui | Demain |
|---|---|
| `/` (src, prisma, migrations, messages, public, next.config.ts…) | `apps/web/` |
| `src/platform/ports` | `packages/platform` |
| `src/platform/{cloudflare,vercel,node}` | `packages/platform-{cloudflare,vercel,node}` |
| `realtime/` | `apps/realtime/` |
| `device/firmware/` | `apps/firmware/` |
| `device/sim/` | `apps/sim/` |
| `device/sdk/` (sans link, cache) | `packages/device-ui/` |
| `device/sdk/link`, `device/sdk/cache` | `packages/device-link`, `packages/device-cache` |
| `device/apps/`, `device/dist/`, `device/device.config.ts` | `packages/device-apps/` |
| `device/{engine,engine-wasm,core,ui,board,cache,web}` | `crates/…` |
| `device/tools`, `device/sdk/tools` | `tools/fonts`, `tools/icons` |
| `device/justfile`, `device/CLAUDE.md`, `device/README.md` | racine ou `apps/firmware/` (selon le contenu) |

## Workspaces et outillage

- **Bun workspaces** (`package.json` racine : `apps/*`, `packages/*`), chaque paquet avec son `package.json`, ses
  `exports` et ses dépendances propres. `@matecrew/device-ui` reste le nom importé partout, donc pas de changement
  d'imports dans les apps.
- **Workspace Cargo** à la racine (`Cargo.toml` avec `members = ["crates/*", "apps/firmware", "apps/sim"]`), un seul
  `Cargo.lock` et un seul dossier `target/`. Le firmware garde sa toolchain `esp` et son `.cargo/config.toml` dans
  son dossier.
- **Turborepo** en option, pour mettre en cache `build`, `test`, `lint` et `typecheck` par paquet. On commence
  sans : les workspaces Bun suffisent, et on ajoute Turbo si les temps de CI le justifient (ajout de paquet,
  approbation requise).
- **Frontières** : une règle ESLint `no-restricted-imports` par paquet interdit à `platform-cloudflare` d'importer
  `platform-node` (et inversement), et aux apps d'importer un adaptateur directement (seulement `@matecrew/platform`
  et la cible choisie). Sans nouvelle dépendance.

## Paquets de plateforme

- `packages/platform` exporte les ports (`storage`, `jobs`, `background`, `env`, `database`, `images`, `pdf`), le type
  `Platform`, les erreurs communes (`BatchConflictError`) et une **suite de tests de contrat** que chaque adaptateur
  exécute : `commitBatch` atomique, gardes, conflits d'unicité, stockage, jobs.
- Chaque `platform-<runtime>` exporte un `platform` qui implémente tous les ports, avec ses dépendances :
  `sharp` seulement dans `platform-node`, `@vercel/blob` et `@upstash/qstash` seulement dans `platform-vercel`,
  `@opennextjs/cloudflare` seulement dans `platform-cloudflare`.
- L'app choisit l'adaptateur **au build**, comme aujourd'hui (`@/platform/active`), mais l'alias pointe vers un
  paquet au lieu d'un dossier. La cible fournit l'alias.

## Descriptions de cibles (`targets/*.ts`)

Une seule source de vérité par cible, typée :

```ts
import { defineTarget } from "@matecrew/setup";

export default defineTarget({
  name: "cloudflare",
  platform: "@matecrew/platform-cloudflare",
  database: { provider: "sqlite", migrations: "apps/web/migrations", engine: "d1" },
  resources: {
    d1: [{ binding: "DB", name: "matecrew", jurisdiction: "eu" }],
    r2: [{ binding: "FILES", bucket: "matecrew-files", jurisdiction: "eu" }],
    queues: [{ binding: "JOBS", name: "matecrew-jobs", deadLetter: "matecrew-jobs-dlq" }],
    images: { binding: "IMAGES" },
    crons: ["*/5 * * * *", "0 2 * * *", "0 2 1 * *"],
  },
  env: {
    secrets: ["BETTER_AUTH_SECRET", "MICROSOFT_CLIENT_SECRET", "SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "RESEND_API_KEY"],
    vars: ["BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "SCHEDULES_ENABLED" /* … */],
  },
  build: "opennextjs-cloudflare build",
  deploy: "wrangler deploy",
});
```

- **Vercel** : `provider: "postgresql"` (Neon), migrations Postgres, Blob, QStash (planifications et URL des routes
  cron), variables actuelles du projet Vercel, `vercel-build`.
- **Node** : SQLite local, fichiers `.data/`, exécution des jobs en direct ; c'est la cible du dev et des tests, et
  la base d'un futur Azure App Service.
- **Azure** (plus tard) : PostgreSQL Flexible Server, Blob Storage, Functions (minuteries) et Service Bus ou Storage
  Queue, région Suisse Nord.

## La commande `bun run setup <cible>`

```
bun run setup cloudflare --check     # vérifie seulement
bun run setup cloudflare             # génère la config et prépare le local
bun run setup cloudflare --remote    # provisionne à distance (confirmation à chaque étape)
bun run setup cloudflare --deploy    # build et déploie
```

Étapes, dans l'ordre :

1. **Générer** depuis la description, avec un en-tête « généré, ne pas modifier » :
   `wrangler.jsonc` ou `vercel.json`, `.dev.vars.example` / `.env.example`, les types d'environnement, la variante du
   schéma Prisma (fournisseur, sortie du client), l'alias de plateforme pour Next. Un test vérifie que les fichiers
   générés sont à jour (comme `bun dui check`).
2. **Vérifier** : outils présents (bun, wrangler ou vercel, docker pour la copie Postgres), compte connecté,
   variables et secrets manquants **par leur nom uniquement** (jamais de valeurs affichées ni lues depuis des
   fichiers de secrets).
3. **Préparer le local** : générer le client Prisma de la cible, appliquer les migrations sur la base locale,
   insérer les données de démo (`SEED_PASSWORD`).
4. **Provisionner** (`--remote`, confirmation à chaque ressource) : création de la base, du bucket, des files et des
   planifications, puis la liste des secrets à poser (la commande ouvre `wrangler secret put` ou
   `vercel env add` pour chaque nom, la saisie reste à la personne).
5. **Build et déploiement** (`--deploy`) : commande de la cible, depuis un checkout propre (OpenNext embarque les
   `.env*` de Next).

## Validation au démarrage

Chaque cible déclare un schéma Zod de son environnement. Au premier appel de `platform.env`, l'app valide la
configuration et s'arrête avec un message clair (« SLACK_SIGNING_SECRET manquant pour la cible vercel ») au lieu
d'échouer plus tard dans une requête. Les noms viennent de la description de cible : une seule liste.

## Base de données

- Un seul schéma source (`apps/web/prisma/schema.prisma`, sous-ensemble portable : rôles en table, centimes,
  dates simples, pas de mode propre à un fournisseur).
- Une variante générée par fournisseur (`sqlite`, `postgresql`) avec son propre dossier de migrations : la base D1
  repart d'une baseline SQLite, Neon garde son historique Postgres.
- `commitBatch` est la seule façon d'écrire plusieurs lignes ensemble ; les tests de contrat le vérifient sur chaque
  adaptateur.

## Firmware et terminal

- `include_bytes!` du firmware et de `crates/ui` pointent vers `packages/device-apps/dist/` : à corriger en une fois.
- `justfile` : chemins mis à jour (`apps/firmware`, `crates/*`, `packages/device-apps`).
- `device/CLAUDE.md` et les README : chemins mis à jour (modification de CLAUDE.md par l'outil d'édition, après
  accord).
- Aucun changement fonctionnel : les `.dui`, le Wasm et les captures doivent rester identiques à l'octet près.

## Plateformes d'hébergement

- **Vercel** : « Root Directory » du projet passe à `apps/web`, commande d'installation à la racine (`bun install`),
  build `bun run vercel-build`. À faire d'abord sur une **preview**, puis en prod.
- **Cloudflare** : `wrangler.jsonc` généré dans `apps/web`, déploiement depuis ce dossier.
- **realtime** : son propre `wrangler.jsonc` dans `apps/realtime`.

## Ordre de migration (chaque étape reste verte et déployable)

| Étape | Contenu | Vérifications |
|---|---|---|
| 0 | Fusion `cloudflare-migration` validée en prod | prod Vercel stable |
| 1 | Squelette workspaces ; `device/sdk` → `packages/device-ui`, extraction `device-link`, `device-cache` | tsc, bun test, `bun dui test` identique |
| 2 | Crates Rust → `crates/`, workspace Cargo racine, firmware → `apps/firmware` | cargo test, build firmware, image identique |
| 3 | `src/platform` → `packages/platform*`, tests de contrat partagés | tsc, bun test, deux builds (OpenNext, Vercel) |
| 4 | `targets/*` + `tools/setup` : génération de `wrangler.jsonc`, `vercel.json`, env, variantes Prisma ; anciens fichiers remplacés par les générés | fichiers générés identiques aux actuels, test de fraîcheur |
| 5 | Site → `apps/web`, `realtime` → `apps/realtime` ; « Root Directory » Vercel sur preview puis prod | preview Vercel, preview Cloudflare, lint Sonar à zéro |
| 6 | Publication des SDK (`device-link`, `device-cache`, `device-ui`) | build des paquets, README, versions |

## Décisions à prendre

1. **Turborepo** tout de suite ou plus tard (recommandé : plus tard).
2. **Où publier les SDK** : npm public sous `@matecrew`, ou le flux interne OWT (Azure Artifacts,
   `pkgs.dev.azure.com/OpenWebTechnologyFoundry`). Pour des SDK génériques réutilisables hors OWT : npm public.
3. **Nom du paquet de bootstrap** (`@matecrew/setup`) et s'il doit être réutilisable par d'autres projets OWT.
4. **CI** : aujourd'hui aucune. La fraîcheur des fichiers générés, le lint Sonar et les tests de contrat gagneraient
   à tourner sur chaque push (modification de CI par l'outil d'édition, après accord).
