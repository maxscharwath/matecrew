# Terminal matécrew

Un écran e-ink sur batterie, posé au bureau. Il affiche le stock, on badge pour prendre un maté, et tout le reste se règle sur le site matécrew.

Matériel, câblage et boîtier : [doc de montage](https://claude.ai/code/artifact/9b5e65c1-9bca-4c9a-aeb7-994a2acc41eb).

## Fonctionnalités

### Au quotidien

- **Écran** : le stock de chaque article, et le libellé des deux actions juste au-dessus de leur touche.
- **Prise** : on touche une action, on badge, l'écran confirme avec un bip. On a 10 s pour annuler.
- **Badge inconnu** : l'écran le signale et le badge apparaît sur le site, où un admin l'attribue à un membre. Personne n'a besoin de connaître un UID.
- **Hors ligne** : les prises restent en mémoire et partent à la synchro suivante.
- **Batterie** : le contrat et le simulateur exposent la tension ; la mesure ADC réelle et l’alerte matérielle restent à terminer.
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
| `GET` | `/api/device/ui` | jeton | Application précompilée binaire DUI1, activée par `state.appUrl` |
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

## Tous les écrans utilisent le moteur TSX

Les 20 variantes d’écran (Wi-Fi, liaison, badge, prise, confirmation, consommation, erreurs, OTA, stock et préparation) sont réparties dans `screens/terminal/`, avec `apps/mate/index.ts` comme point d’entrée. `just ui` compile ces composants en fichiers binaires DUI1, environ 16 Ko pour l’ensemble. Il n’y a plus de mise en page Rust manuscrite ni de renderer serveur. Rust décode les nœuds, résout les bindings, calcule les textes et dessine les pixels sur l’appareil. Le même code fonctionne dans le terminal virtuel en Wasm.

`ui/` adapte les événements et les données métier aux écrans compilés. `engine/` est indépendant de matécrew, ESP-IDF et du réseau : framebuffer monochrome de dimensions configurables, composants, textes, images, QR, graphiques, état local et effets. Les API fournissent les données : `state.screen` contient stocks, textes et historique numérique, jamais une mise en page ou une trame. Les anciennes copies NVS sans `screen` sont adaptées aux mêmes écrans TSX.

- Les cartes gardent les noms lisibles, les stocks bas sont inversés et le graphe reste visible. Les grands catalogues affichent six articles en aperçu ; le sélecteur contient tous les articles.
- Les polices sont intégrées au moteur. Les textes sont limités selon leur largeur réelle et chaque composant est découpé à ses limites.
- La copie NVS permet de redessiner hors ligne. Le pilote ignore les trames identiques, rafraîchit uniquement les zones modifiées et gère la veille et les rafraîchissements complets.
- Les définitions intégrées sont embarquées dans le firmware : changer leur TSX demande `just ui`, `just web` et une nouvelle version du firmware. Une application téléchargeable peut aussi être fournie via `state.appUrl`, sous forme de `.dui`.
- `screens/example.tsx` montre `useDeviceData`, `useDeviceState` et les boutons. Les hooks sont compilés en déclarations de ressources et d’actions ; leur état et leurs effets s’exécutent en Rust. Le host fait les requêtes API et stocke le cache. Aucune VM JavaScript n’est nécessaire.
- Ce DSL TSX supporte Screen, Group, Row, Column, Card, Text, Image, Qr, Chart, Progress, Button, List et When. Ce n’est pas un runtime React/DOM/CSS ; les fonctions TSX s’exécutent à la compilation, pas sur le serveur à chaque rendu.

Voir `authoring/README.md` pour le SDK complet et `engine/README.md` pour l’intégration sur un autre appareil.

### Showcase et contrôle sans boutons

`apps/showcase/` contient une application de neuf pages : kit UI, courbes/barres/aires, icônes, PNG téléchargés, QR, thèmes, état local, API et buzzer. La navigation push/back, les caches et le rendu s’exécutent sur l’appareil. `bun run device:preview` génère les captures réelles dans `sim/out/showcase-*.png`.

La console web et le terminal virtuel proposent un sélecteur **maté / Showcase** et un écran cliquable. Ces clics sont transmis comme coordonnées logiques au moteur. Les touches gauche/droite restent utilisables à distance. En USB : `app showcase`, `r`, `l`, `tap 95 85`, `app mate`. Le changement d’application attend la fin d’une interaction maté en cours. Le mode et les données locales sont conservés après redémarrage.

Le SDK expose `useRouter`, `useBuzzer` et `useDeviceInfo`, plus `input="left"` sur les boutons. Les callbacks retournent une action compilée. `useDeviceInfo` fournit le profil de broches et les capteurs disponibles ; ce n’est pas une API d’écriture GPIO. La mesure ADC réelle de batterie reste à implémenter.

Les thèmes `flipper`, `macos`, `dark` se choisissent dans le simulateur ou via `useDeviceTheme`. `DEVICE_UI_THEME` configure le thème initial des écrans maté. Les images web sont des PNG non entrelacés (64 KiB / 512 × 512 max), décodés et tramés dans Rust ; aucun serveur ne dessine l’écran.

### Migration vers le firmware 0.3.0

L’ancien endpoint `/api/device/screen` et le renderer serveur sont supprimés ; les données sont incluses dans `/api/device/state`. Les firmwares 0.2.x attendent encore une trame serveur. Préparer le firmware 0.3.0 et le Wasm avant de déployer ce changement serveur ; flasher les appareils existants, ou leur livrer 0.3.0 via OTA tant que le serveur précédent fonctionne encore. Il n’y a plus de renderer serveur de compatibilité.

## Console et terminal virtuel

Dans Admin > Appareils :

- **Console** d'un appareil : son écran en miroir, à jour à chaque rafraîchissement. On clique ses touches, on badge avec le badge d'un membre ou un badge inconnu, on synchronise, on redémarre, on lui fait oublier le Wi-Fi. Clavier : ← et → pour les touches, B pour badger, S pour synchroniser. Touches et badges arrivent en moins d'une seconde quand l'appareil est en ligne ; ceux de plus d'une minute sont abandonnés.
- **Terminal virtuel** : un terminal complet dans le navigateur, sans matériel. La machine à états de la prise et les écrans sont le code Rust du firmware (`core`, `ui`) compilé en WebAssembly (`web`) ; il parle à la même API que le vrai. Il se lie en un clic, a sa file de prises, ses capteurs (batterie, signal), un bouton pour couper le Wi-Fi, le son du buzzer et un moniteur des requêtes. Il apparaît dans la liste des appareils, et sa console marche comme celle d'un vrai.

## Développement

```
device/
  core/      logique sans matériel : contrat de l'API, file de prises, trames PN532
  authoring/ DSL et compilateur binaire TSX
  screens/   écrans TSX et définitions DUI1 compilées
  engine/    moteur Rust générique, indépendant du matériel
  ui/        adaptation des données matécrew au moteur
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
| `just test` | Tests Rust des écrans et de la logique sur le Mac |
| `just ui` | Compile tous les écrans TSX en binaires DUI1 |
| `just web` | Recompile le terminal virtuel (`public/device/matecrew.wasm`) |
| `just release` | Construit l'image d'une mise à jour par le réseau |
| `just publish` | La publie sur le site local : les terminaux l'installent à leur synchro suivante |
| `just web-watch` | Pareil à chaque sauvegarde dans `core`, `ui` ou `web` ; avec `just api`, la page du terminal virtuel recharge le wasm toute seule |
| `just flash` | Compile, flashe le XIAO branché en USB et ouvre le moniteur série |
| `just api` | Lance le site en local ; l'appareil le vise si on compile avec `MATECREW_URL=http://<ip-du-mac>:3000` |

On itère sur les écrans avec `just sim`, ou dans le terminal virtuel avec `just api` et `just web-watch`. On ne flashe que pour tester le matériel, le Wi-Fi ou la liaison.

Les tests d’intégration du terminal virtuel se lancent depuis la racine avec `bun test tests/device` (après `just web`). Ils vérifient le contrat partagé, le rendu Wasm, la synchro sans téléchargement de trame et le démarrage hors ligne.

Le wasm compilé est versionné dans `public/device/` : Vercel n'a pas la toolchain Rust. Après un changement dans `core`, `ui` ou `web`, lancer `just web` et commiter le fichier.

Sans touches ni lecteur câblés, le moniteur série de `just flash` les remplace : `l` et `r` touchent une touche, `b 04A1B2C3D4E5F6` pose un badge, `s` lance une synchro.

La première compilation du firmware prend 10 à 20 minutes : elle compile ESP-IDF. Les suivantes prennent quelques secondes.


### Présentation du kit

Les écrans maté et Showcase utilisent désormais une grille 400 × 240, dessinée à
2× sur la dalle 800 × 480. Le moteur aligne les textes avec les métriques réelles
des polices. La barre basse indique les deux touches physiques par des flèches
vers le bas, des coins inférieurs carrés et un repère RFID central. L’heure est
celle du dernier rafraîchissement, le Wi-Fi vient de l’hôte, et la batterie reste
« ? » tant que sa mesure n’est pas disponible.

Les dessins maison du SDK sont remplacés par Pixelarticons et Streamline Pixel,
importés comme composants (`WifiIcon`, `FoodDrinkCoffeeIcon`…) et convertis au
build en sprites monochromes. Le [catalogue local](authoring/catalog.html) permet
de chercher et copier les imports. Les visuels monochromes des produits fournis
par l’API restent prioritaires. Les crédits sont dans
[authoring/art/licenses](authoring/art/licenses/README.md).
