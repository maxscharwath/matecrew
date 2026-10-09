# Terminal matécrew

Un écran e-ink sur batterie, posé au bureau. Il affiche le stock, on badge pour prendre un maté, et tout le reste se règle sur le site matécrew.

Matériel, câblage et boîtier : [doc de montage](https://claude.ai/code/artifact/9b5e65c1-9bca-4c9a-aeb7-994a2acc41eb).

## Fonctionnalités

### Au quotidien

- **Écran** : le stock de chaque article, et le libellé des deux actions juste au-dessus de leur touche.
- **Prise** : on touche une action, on badge, l'écran confirme avec un bip. On a 10 s pour annuler.
- **Badge inconnu** : l'écran le signale et le badge apparaît sur le site, où un admin l'attribue à un membre. Personne n'a besoin de connaître un UID.
- **Hors ligne** : les prises restent en mémoire et partent à la synchro suivante.
- **Batterie** : le niveau remonte sur le site ; alerte à l'écran et sur le site sous 3,5 V.
- **Sans interrupteur** : gestes à deux touches pour éteindre, rallumer et redémarrer (détail dans `CLAUDE.md`).

### Mise en service

Deux étapes, rien à saisir à part le mot de passe du Wi-Fi.

1. **Wi-Fi.** Au premier démarrage, l'écran affiche un QR. Le téléphone qui le scanne rejoint un point d'accès protégé par un mot de passe aléatoire, et la page de réglage s'ouvre toute seule : on choisit le Wi-Fi du bureau et on tape son mot de passe. Sous « Site matécrew », l'adresse du site est pré-remplie ; on ne la change que si le bureau a son propre site. L'écran suit chaque étape : connexion au Wi-Fi, connecté, contact du site.
2. **Liaison.** L'appareil affiche un code court, par exemple `MATE-4F2K`, avec un QR vers `<site>/link?code=MATE-4F2K`. Un admin du bureau ouvre le lien, choisit le bureau, nomme l'appareil et valide. L'appareil reçoit son jeton tout seul, puis affiche « Lié au bureau de Lausanne ».

Le site n'est pas figé dans le firmware : il est gardé en mémoire avec le Wi-Fi, et le jeton ne vaut que pour lui. Si le site ne répond pas pendant 5 minutes, un appareil pas encore lié revient à l'étape 1. `MATECREW_URL` à la compilation ne fait que changer l'adresse proposée.

### Sur le site, dans Admin > Appareils

- Liste des appareils : bureau, dernière synchro, batterie, version du firmware.
- Réglages par appareil : article et sens de chaque touche (prendre, rendre), horaires de synchro, volume du bip.
- Badges en attente d'attribution.
- Mise à jour du firmware, appliquée à la synchro suivante.
- Révocation : l'appareil perd son accès et revient à l'étape de liaison.

## Sécurité de la liaison

Le principe est celui du « device authorization grant » (RFC 8628), le même que pour se connecter à une app de TV.

- L'appareil demande une liaison (`POST /api/device/link`). Le serveur lui renvoie un `device_code` secret de 256 bits, qui ne quitte jamais l'appareil, et un `user_code` court, valable 10 minutes.
- Seul le `user_code` est affiché. Il ne sert à rien sans la validation d'un admin connecté au site. Sa saisie est limitée en nombre d'essais.
- L'appareil interroge `POST /api/device/link/token` avec son `device_code`. Après validation, il reçoit son jeton une seule fois, en HTTPS.
- Le jeton fait 256 bits aléatoires. Le serveur n'en garde que l'empreinte SHA-256 ; l'appareil le garde en NVS. Il n'est jamais affiché ni tapé, il est propre à un appareil et à son bureau, et on peut le révoquer depuis le site.
- Tout passe en HTTPS, et le firmware vérifie le certificat du serveur avec le bundle de certificats d'ESP-IDF.
- Le mot de passe du Wi-Fi du bureau ne circule qu'entre le téléphone et l'appareil, sur le point d'accès WPA2 dont le mot de passe aléatoire est dans le QR.
- La page de validation montre l'identifiant matériel de l'appareil et l'heure de la demande. L'appareil affiche ensuite le bureau auquel il est lié : on voit tout de suite si on a validé le bon.

## API de l'appareil

| Méthode | Route | Authentification | Rôle |
|---|---|---|---|
| `POST` | `/api/device/link` | aucune | Démarrer une liaison |
| `POST` | `/api/device/link/token` | `device_code` | Attendre la validation, recevoir le jeton |
| `GET` | `/api/device/state` | jeton | Stock, libellés, badges, réglages, firmware attendu |
| `POST` | `/api/device/takes` | jeton | Envoyer les prises en attente (idempotent) |
| `POST` | `/api/device/status` | jeton | Batterie, version, signal Wi-Fi, badges inconnus |
| `GET` | `/api/device/screen` | jeton | Écran principal en bitmap 1 bit, `304` s'il n'a pas changé |
| `GET` | `/api/device/commands?wait=25` | jeton | Ce qu'un admin fait depuis la console : touche, badge, synchro, redémarrage, oubli du Wi-Fi. Tenue jusqu'à 25 s |
| `PUT` | `/api/device/frame` | jeton | Ce que l'écran affiche, 48 000 octets, pour le miroir de la console |
| `GET` | `/api/device/firmware/<version>` | jeton | Image du firmware annoncé dans l'état, pour la mise à jour |

Le contrat est écrit en Zod dans `src/lib/device/contract.ts` ; le firmware reprend les mêmes formes.

## Mise à jour par le réseau

Le site annonce son dernier firmware dans chaque état (`firmware` : version, chemin, SHA-256, taille). Un terminal inactif dont la version est plus ancienne le télécharge dans l'autre slot de la flash (deux slots de 3,5 Mo, `firmware/partitions.csv`), vérifie la taille et le SHA-256, puis redémarre dessus. L'écran montre la progression.

- La nouvelle version démarre « en essai » : elle ne devient définitive qu'après sa première synchro. Si elle plante ou redémarre avant, le bootloader revient à l'ancienne, et le terminal ne retente plus cette version.
- Le Wi-Fi, le site et le jeton restent en NVS : une mise à jour ne les touche pas.
- Le retour arrière vient du bootloader du projet, pas de celui d'espflash : flasher par `just flash` (ou `firmware/flash.sh`), jamais par `cargo run` seul pour un premier flash.

Publier une version :

1. Monter `version` dans `firmware/Cargo.toml`.
2. `just release` : construit l'image applicative `release/matecrew-<version>.bin`.
3. `just publish` : l'envoie sur la copie locale de la production (`scripts/dev-prod-copy.sh`). Pour un autre site : `bun scripts/publish-firmware.ts <image> [version]` avec la `DATABASE_URL` et le stockage de ce site. Republier une version la remplace.

## L'écran principal est en React

Le site dessine l'écran principal en React (`src/lib/device/screen.tsx`) avec `next/og`, en pixel art comme les écrans de l'appareil : une toile de 200 × 120 avec des polices pixel (Silkscreen, Pixelify Sans), agrandie quatre fois en 800 × 480 pixels noir et blanc, soit 48 000 octets. L'appareil le télécharge à chaque synchro et l'affiche tel quel.

- Aperçu exact dans Admin > Appareils. Avec `just api`, une modification de `screen.tsx` se voit en rechargeant la page.
- Changer le design ne demande pas de reflasher l'appareil.
- Les écrans qui doivent apparaître tout de suite et hors ligne (badge, confirmation, Wi-Fi, code de liaison, erreurs) restent dessinés par l'appareil, dans `device/ui`.

## Console et terminal virtuel

Dans Admin > Appareils :

- **Console** d'un appareil : son écran en miroir, à jour à chaque rafraîchissement. On clique ses touches, on badge avec le badge d'un membre ou un badge inconnu, on synchronise, on redémarre, on lui fait oublier le Wi-Fi. Clavier : ← et → pour les touches, B pour badger, S pour synchroniser. Touches et badges arrivent en moins d'une seconde quand l'appareil est en ligne ; ceux de plus d'une minute sont abandonnés.
- **Terminal virtuel** : un terminal complet dans le navigateur, sans matériel. La machine à états de la prise et les écrans sont le code Rust du firmware (`core`, `ui`) compilé en WebAssembly (`web`) ; il parle à la même API que le vrai. Il se lie en un clic, a sa file de prises, ses capteurs (batterie, signal), un bouton pour couper le Wi-Fi, le son du buzzer et un moniteur des requêtes. Il apparaît dans la liste des appareils, et sa console marche comme celle d'un vrai.

## Développement

```
device/
  core/      logique sans matériel : contrat de l'API, file de prises, trames PN532
  ui/        écrans, compilés pour le Mac et pour l'appareil
  sim/       rend tous les écrans en PNG sur le Mac, sans carte
  web/       le terminal virtuel : core et ui en WebAssembly pour le site
  firmware/  firmware Rust (ESP-IDF) du XIAO ESP32-S3
  hardware/  boîtier OpenSCAD et STL
```

Les commandes passent par [`just`](https://github.com/casey/just), depuis `device/` :

| Commande | Effet |
|---|---|
| `just setup` | Installe la toolchain Rust de l'ESP32-S3, `espflash`, `ldproxy` et `cargo-watch` |
| `just sim` | Redessine les écrans dans `sim/out/` à chaque sauvegarde, en une seconde environ |
| `just test` | Tests des écrans et de la logique sur le Mac |
| `just web` | Recompile le terminal virtuel (`public/device/matecrew.wasm`) |
| `just release` | Construit l'image d'une mise à jour par le réseau |
| `just publish` | La publie sur le site local : les terminaux l'installent à leur synchro suivante |
| `just web-watch` | Pareil à chaque sauvegarde dans `core`, `ui` ou `web` ; avec `just api`, la page du terminal virtuel recharge le wasm toute seule |
| `just flash` | Compile, flashe le XIAO branché en USB et ouvre le moniteur série |
| `just api` | Lance le site en local ; l'appareil le vise si on compile avec `MATECREW_URL=http://<ip-du-mac>:3000` |

On itère sur les écrans avec `just sim`, ou dans le terminal virtuel avec `just api` et `just web-watch`. On ne flashe que pour tester le matériel, le Wi-Fi ou la liaison.

Le wasm compilé est versionné dans `public/device/` : Vercel n'a pas la toolchain Rust. Après un changement dans `core`, `ui` ou `web`, lancer `just web` et commiter le fichier.

Sans touches ni lecteur câblés, le moniteur série de `just flash` les remplace : `l` et `r` touchent une touche, `b 04A1B2C3D4E5F6` pose un badge, `s` lance une synchro.

La première compilation du firmware prend 10 à 20 minutes : elle compile ESP-IDF. Les suivantes prennent quelques secondes.
