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

- `device/firmware/` : projet PlatformIO du firmware, à créer.
- `device/hardware/` : modèle OpenSCAD du boîtier (`boitier-matecrew.scad`, source de vérité) et ses STL exportés.
- Le reste du dépôt est l'app web (Next.js App Router, Prisma, PostgreSQL, Bun ; voir le `README.md` à la racine).
  Pour l'API de l'appareil, les modèles utiles sont dans `prisma/schema.prisma` : `Office`, `Item`, `Stock`, `StockMovement`, `ConsumptionEntry`, `Membership`, `User`.
  Les endpoints de l'appareil iront sous `src/app/api/device/`.

## Matériel et brochage

Le brochage est fixé par le câblage : ne pas le changer sans raison.
Dans le code, utiliser les macros `D0`…`D10` du variant Arduino `XIAO_ESP32S3` plutôt que des numéros de GPIO en dur.

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
| PN532 SDA | IO41 | pastille sous le XIAO (pastille JTAG, libre comme GPIO tant que le JTAG reste sur l'USB) |
| PN532 SCL | IO42 | idem ; `Wire.begin(41, 42)` |
| Buzzer piézo passif | D7 | PWM (LEDC) vers 4 kHz, l'autre fil à GND |
| Mesure batterie | D5 (ADC1) | point milieu d'un pont 1 MΩ / 1 MΩ entre BAT+ et GND : Vbat ≈ 2 × Vmesurée, à calibrer |
| Libre | D6 | LED d'état éventuelle plus tard |

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
- Écran : mettre le contrôleur en veille après chaque affichage. Rafraîchissement partiel (environ 0,3 s) pour les confirmations, complet une fois par jour contre les images fantômes.
- Wi-Fi groupé : se connecter à chaque prise diviserait l'autonomie par deux environ.

## API matécrew : encore à définir

Il faut ces endpoints : lecture du stock, liste des badges (UID → nom), envoi groupé des prises, configuration de l'appareil, dernière version du firmware, état de l'appareil (version, batterie).
L'appareil s'authentifie avec sa clé.
Avant de coder le client, proposer un contrat JSON qui s'appuie sur le schéma Prisma de ce dépôt, puis l'implémenter côté app sous `src/app/api/device/`.

## Outils

- PlatformIO, `board = seeed_xiao_esp32s3`, framework Arduino. Activer l'USB CDC au démarrage pour le moniteur série.
- Écran : bibliothèque Seeed GFX configurée pour la « ePaper Driver Board for XIAO » et la dalle 7,5" noir et blanc, ou GxEPD2 si c'est plus simple. À valider sur le matériel.
- PN532 : Adafruit PN532 en I2C.
- Programmation : USB-C du XIAO branché sur le Mac (`/dev/cu.usbmodem…`).
  - Si le téléversement échoue : maintenir B, appuyer sur R, relâcher B, puis relancer.
  - En deep sleep, le port USB disparaît : réveiller avec une touche ou passer par B + R. En développement, attendre quelques secondes au démarrage avant de dormir.
- Pendant le banc d'essai, la batterie n'est pas branchée : l'USB alimente tout.

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
