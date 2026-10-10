# matécrew terminal — firmware

Réponds en français.

## Ce qu'on construit

Un poste fixe sur batterie qui affiche le stock de la matécrew (stock de maté du bureau) sur un écran e-ink 7,5".
Deux touches tactiles d'action sont sous l'écran ; leur libellé s'affiche à l'écran juste au-dessus de chacune.
Une zone badge NFC est au centre. On badge avec le badge de bureau (MIFARE DESFire EV1, on lit seulement l'UID).

- Doc de montage complète (matériel, câblage, boîtier, comportement) :
  https://claude.ai/code/artifact/9b5e65c1-9bca-4c9a-aeb7-994a2acc41eb
- Modèle 3D du boîtier (OpenSCAD + STL) : `hardware/`

## Où est quoi

Ce dossier `device/` vit dans le dépôt de l'app web matécrew.

- `device/README.md` : fonctionnalités, mise en service, sécurité de la liaison, commandes `just`.
- `device/core/` : la logique sans matériel (contrat de l'API, file de prises, trames PN532, commandes de la console série), testée sur le Mac.
- `device/ui/` : les écrans (crate Rust), dessinés sur n'importe quelle cible 800 × 480 noir et blanc.
- `device/sim/` : rend les écrans en PNG sur le Mac (`just sim`), sans carte.
- `device/web/` : `core` et `ui` compilés en WebAssembly pour le terminal virtuel du site (`just web` écrit `public/device/matecrew.wasm`, versionné). Le runtime réseau est en TypeScript dans `src/lib/device/virtual/`.
- `device/firmware/` : firmware Rust sur ESP-IDF (`esp-idf-svc`, `epd-waveshare`), toolchain `esp` via espup.
- `device/hardware/` : modèle OpenSCAD du boîtier (`boitier-matecrew.scad`, source de vérité) et ses STL exportés.
- Le reste du dépôt est l'app web (Next.js App Router, Prisma, PostgreSQL, Bun ; voir le `README.md` à la racine).
  Pour l'API de l'appareil, les modèles utiles sont dans `prisma/schema.prisma` : `Office`, `Item`, `Stock`, `StockMovement`, `ConsumptionEntry`, `Membership`, `User`.
  Les endpoints de l'appareil iront sous `src/app/api/device/`.

## Matériel et brochage

Le brochage est fixé par le câblage : ne pas le changer sans raison.
Le firmware est en Rust : il utilise les numéros de GPIO. Correspondance XIAO ESP32-S3 : D0=1, D1=2, D2=3, D3=4, D4=5, D5=6, D6=43, D7=44, D8=7, D9=8, D10=9.

| Fonction | Broche XIAO ESP32-S3 | Remarque |
|---|---|---|
| Écran RST | D0 | via la carte « ePaper Driver Board for XIAO » de Seeed |
| Écran CS | D1 | |
| Écran BUSY | D2 | |
| Écran DC | D3 | |
| Écran SCK | D8 | |
| Écran MOSI | D10 | D9 (MISO) n'est pas reliée à l'écran |
| Touche gauche | D4 | TTP223, sortie active haute, mode momentané ; réveil deep sleep |
| Touche droite | D9 | TTP223, idem ; D9 n'est reliée qu'aux trous de la carte driver (vérifié sur le schéma Seeed) |
| PN532 SDA | D6 | I2C 100 kHz, adresse 0x24 ; interrupteurs du module : 1 ON, 2 OFF (I2C), à régler hors tension |
| PN532 SCL | D7 | D6 et D7 sont l'UART0, libre : la console passe par l'USB-Serial-JTAG |
| Buzzer piézo passif | D5 | PWM (LEDC) vers 4 kHz, l'autre fil à GND ; partage D5 avec la mesure batterie (un piézo ne laisse passer aucun courant continu) : sortie le temps d'un bip, flottante sinon |
| Mesure batterie | D5 (ADC1) | point milieu d'un pont 1 MΩ / 1 MΩ entre BAT+ et GND : Vbat ≈ 2 × Vmesurée, à calibrer ; optionnel, sans pont la batterie ne s'affiche pas |

- **Écran** : dalle 7,5" 800 × 480 noir et blanc du kit « Seeed XIAO 7.5" ePaper Panel ». Elle est montée nappe en haut, donc il faudra peut-être tourner l'affichage de 180°.
- **Lecteur NFC** : PN532 V3, mini-interrupteurs en I2C, adresse 0x24. IRQ et RSTO ne sont pas câblés.
- **Alimentation** : LiPo 1S 2000 mAh (654060) soudée sur les pastilles BAT+/BAT− du XIAO, qui la charge par son USB-C. Il n'y a pas d'interrupteur.
  La broche 5V du XIAO n'est volontairement pas reliée à la carte driver, pour isoler sa puce ETA9740 qui vide la batterie en veille. Tout fonctionne en 3,3 V.
- **Position des touches** : les touches sont centrées à environ x = 130 px et x = 670 px de la largeur de l'écran (800 px). Les libellés d'action vont en bas de l'écran, juste au-dessus.

## Comportement attendu

### Repos
- L'appareil est en deep sleep. L'écran e-ink garde le stock et les libellés des deux actions, chacun au-dessus de sa touche.

### Prise
1. Toucher une touche réveille le XIAO (ext1, `ESP_EXT1_WAKEUP_ANY_HIGH` sur D4 et D9). Un bip court, puis l'écran demande le badge (rafraîchissement partiel).
2. Le PN532 lit l'UID. Le nom vient d'une table UID → nom gardée en mémoire (NVS ou LittleFS), sans Wi-Fi.
   Pour tester, utiliser un vrai badge (UID de 7 octets). Ne jamais committer d'UID : le dépôt est public.
3. L'écran affiche par exemple « Maxime : 1 maté pris » avec deux bips. Pendant 10 s, les touches deviennent « OK » et « Annuler ». Sans réponse, la prise est validée.
4. La prise va dans une file locale persistante, puis l'appareil se rendort.
- Badge inconnu ou erreur : un bip grave.
- Les libellés et le rôle des deux touches viennent de la configuration (« Prendre un maté » et « Rendre un maté » ne sont que des exemples).

### Synchronisation (4 fois par jour, horaires configurables)
- Connexion Wi-Fi rapide : IP fixe, canal et BSSID mémorisés.
- Envoi des prises en attente, puis récupération du stock, de la liste des badges et de la configuration : libellés et rôle des touches, horaires de synchro, volume du bip.
- Remontée de la version du firmware et de la tension de la batterie.
- Mise à jour OTA en HTTPS si l'API annonce une nouvelle version, avec retour à l'ancienne si la nouvelle ne démarre pas.
- Commandes à distance (redémarrage, retour à la config Wi-Fi), appliquées à la synchro.
- Jamais de NFC pendant le Wi-Fi, pour ne pas cumuler les pics de courant.

### Éteindre, rallumer, redémarrer (il n'y a pas d'interrupteur)
- **Éteindre** : les deux touches maintenues environ 3 s. L'écran affiche « Éteint », puis deep sleep sans réveil programmé.
  Une touche seule réveille quand même le XIAO (ext1 ANY_HIGH) : le firmware vérifie alors que les deux touches sont maintenues 3 s, sinon il se rendort aussitôt.
- **Rallumer** : les deux touches 3 s.
- **Redémarrer** : les deux touches 10 s, puis `esp_restart()`. Le watchdog doit être actif.
- **Revenir à la config Wi-Fi** : depuis l'état éteint, rallumer en gardant les deux touches 10 s.

### Première mise en service
- Sans Wi-Fi enregistré, l'appareil ouvre un point d'accès « matecrew-setup » et affiche un QR code pour le rejoindre.
- Un portail captif demande : le Wi-Fi du bureau, son mot de passe, l'URL de l'API matécrew et la clé de l'appareil. Ces réglages vont en NVS.

### Batterie
- Tension lue sur D5 à chaque synchro seulement ; alerte à l'écran sous 3,5 V.

## Règles d'énergie

- Objectif de courant en veille : environ 50 µA en tout (XIAO S3 environ 14 µA, plus les deux TTP223, le pont de mesure, le PN532 et l'écran en veille).
- Deep sleep par défaut. Le PN532 passe en power-down avant chaque mise en veille.
- Écran : mettre le contrôleur en veille après chaque affichage. Rien ne flashe pendant qu'on utilise le terminal (demande de l'utilisateur) : rafraîchissement partiel (environ 1 s) pour une mise à jour de données, deux partiels de suite (environ 2 s) pour un nouvel écran, dès que plus de 6 % des pixels changent (`ui/src/frame.rs`, `refresh`) : un seul partiel sur tout l'écran laisse l'ancien transparaître. Le complet rapide (un flash) qui efface les images fantômes n'a lieu qu'après 60 s sans appui, à la synchro, quand les partiels accumulés atteignent 30 % de l'écran (`frame::worn`), 40 partiels ou une heure. Seul le premier écran au démarrage prend un complet.
- Mémoire : JSON, scènes, Wi-Fi et mbedTLS vont en PSRAM (`sdkconfig.defaults`) ; garder environ 180 Ko de RAM interne libre (ligne `heap:` dans les logs). Sous 40 Ko, la pile Wi-Fi échouait (`ESP_ERR_NO_MEM`) et le firmware redémarrait.
- Wi-Fi groupé : se connecter à chaque prise diviserait l'autonomie par deux environ.

## API de l'appareil (côté site)

- Contrat Zod : `src/lib/device/contract.ts`. Routes : `src/app/api/device/` (`link`, `link/token`, `state`, `takes`, `status`, `ui`, `commands`, `frame`, `firmware/<version>`).
- Mise à jour par le réseau : `state.firmware` annonce la dernière `FirmwareRelease` ; `firmware/src/ota.rs` l'installe dans l'autre slot (`partitions.csv`) et la confirme après sa première synchro, sinon le bootloader revient à l'ancienne. Publier : `just release` puis `just publish`.
- Liaison façon RFC 8628 : `/api/device/link` renvoie `device_code` (secret, gardé par l'appareil) et `user_code` (affiché) ; un admin valide sur `/link` ; l'appareil interroge `/api/device/link/token` toutes les 5 s et reçoit son jeton `mcd_…` une seule fois.
- Ensuite : `Authorization: Bearer mcd_…`. Le serveur ne garde que le SHA-256 du jeton. Un 401 veut dire « appareil délié » : effacer le jeton et recommencer la liaison.
- `POST /api/device/takes` est idempotent par `id` de prise : renvoyer toute la file tant qu'elle n'est pas acquittée, puis retirer les ids de `done`.
- Tous les écrans sont des binaires DUI1 compilés depuis `device/apps/mate/` dans `device/dist/`, rendus par `device/engine` sur l’appareil (Rust/Wasm pour le virtuel). `state.screen` contient uniquement les textes, sprites et valeurs de l’historique. L’ancien endpoint `/api/device/screen` est supprimé. Les 48 000 octets 1 bit sont uniquement envoyés par l’appareil à `/api/device/frame` pour le miroir. Voir la migration 0.3.0 dans `README.md`.
- En local : `just api`, puis compiler le firmware avec `MATECREW_URL=http://<ip-du-mac>:3000`. Comptes de test dans `prisma/seed.ts`.

## Outils

- Commandes depuis `device/` : `just sim`, `just test`, `just flash`, `just build`, `just api` (voir le `README.md`).
- Itérer sur les écrans avec `just studio` (terminal émulé et previews dans le navigateur, rechargés à chaque sauvegarde ; `just engine` recompile `sdk/engine.wasm`) ou `just sim`, ne flasher que pour le matériel, le Wi-Fi ou la liaison.
- Le XIAO se flashe par son USB-C (`/dev/cu.usbmodem…`) ; `espflash` gère le reset USB. Si espflash ne se connecte pas, `esptool.py --chip esp32s3 --before usb_reset --after no_reset chip_id` (celui de PlatformIO) met la puce en mode téléchargement, puis `firmware/flash.sh --before no-reset --after hard-reset`.
- `firmware/flash.sh` pose la table à deux slots et le bootloader du projet, compilé avec le retour arrière ; celui d'espflash ne l'a pas.
- Le XIAO n'a aucun bouton accessible et la batterie est soudée sans interrupteur : pas de B + R, et débrancher l'USB ne le redémarre pas. Le flash ne passe que par le reset USB : un firmware qui casse l'USB-Serial-JTAG ou plante avant qu'il démarre rend l'appareil inflashable. Tester d'abord dans le terminal virtuel.
- En deep sleep, le port USB disparaît : réveiller avec une touche.
- Les binaires sortent dans le `target-dir` partagé de Cargo (`~/.cargo/shared-target`), pas dans `device/firmware/target`.

## Ordre de travail

1. **Banc d'essai.** Le S3 est sur breadboard, relié au support femelle de la carte driver par 14 câbles.
   Valider : écran test, scan I2C et version du PN532, lecture de l'UID de test, réveil par chaque touche, bip, mesure batterie.
2. **Mesure du courant de veille** au multimètre (calibre 200 µA ; ponter le multimètre pendant le démarrage).
3. **Firmware complet** : machine à états, stockage persistant, écrans, portail captif, synchro, OTA.
4. **Client de l'API**, une fois son contrat défini.

## État au 9 octobre 2026

- Commande Bastelgarage reçue. Le kit est ouvert et le XIAO C3 retiré de son support ; le S3 va le remplacer.
- La carte driver mesure environ 41 × 26 mm. La batterie est une 654060 (environ 60 × 40 × 6,5 mm).
- Le modèle du boîtier dans `device/hardware/` doit encore être mis à jour avec la vraie batterie et la vraie carte driver.

## Moteur TSX (0.3.0)

Les mises en page maté sont réparties dans `apps/mate/screens/`, exportées par `apps/mate/index.ts`, compilées par `bun dui build` (manifeste `device.config.ts`). Ne pas ajouter de renderer de secours Rust ou serveur. `ui/` fournit seulement les données et services métier au moteur générique `engine/`. Les `.dui` de `dist/` et `public/device/matecrew.wasm` sont versionnés ; `bun dui check` signale une copie périmée. Exécuter `bun dui build` avant les builds et les tests ; valider avec le simulateur et `bun test tests/device`.


`apps/showcase/` est la démonstration interactive du SDK : navigation, kit, graphiques, images, thèmes et effets matériels. Le firmware et le Wasm l’embarquent. Contrôles USB sans boutons : `app showcase`, `l`, `r`, `tap <x> <y>`, `app mate`. Les mêmes commandes passent par la console web. Les nouveaux hooks et limites sont documentés dans `sdk/README.md`.

Les layouts intégrés sont en 800 × 480 natifs (1 px = 1 px du panneau), thème `paper`, construits avec le kit de `sdk/kit/`, à la manière de shadcn : composants composés, contenu en enfants, props seulement pour une variante ou une taille (jetons dans `tokens.ts` : marges 32, barre d'état jusqu'à y = 56, onglets des touches dès y = 424, touches sous x = 130 et 670, lecteur sous x = 400). La mise en page est un flex calculé sur l'appareil (`fill`, poids, pourcentages, `gap`, `padding`, `align`, `justify`) : pas de coordonnées absolues dans les écrans. Le texte se centre sur ses capitales ; `fit` le réduit avant de l'ellipser. Les textes affichés passent par `useI18n` au format i18next (`cle_one`/`cle_other`, `{{nom}}`, contexte `cle_<ctx>`), pas de chaînes en dur. Le protocole de clic distant reste normalisé en 200 × 120 ; les hôtes le convertissent aux dimensions de l’app. Les icônes sont les icônes Lucide du site (`@matecrew/device-ui/icons/lucide`, dessinées à la compilation par `sdk/icons/vector.ts`) ; les illustrations passent par `createArt` (`apps/mate/art.ts`). Ne pas réintroduire de dessins maison en bitmap. Les polices sont Latin-1 : pas de `—` ni de `’` dans les textes affichés. Le rendu est optimisé pour l'énergie : mesurer avec `engine/tests/bench.rs` avant et après un changement du moteur, et vérifier que `bun dui test` reste identique au pixel près.
