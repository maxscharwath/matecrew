# Modèles 3D des composants

Modèles des fabricants ou de la communauté, gardés tels quels pour contrôler l'encombrement
dans Fusion. Ils ne sont pas imprimés et restent la propriété de leurs auteurs : usage interne
au projet seulement, pas de redistribution. La vue 3D du site en montre une version simplifiée,
servie seulement aux utilisateurs connectés, jamais par un fichier public.

| Fichier | Composant | Auteur | Source | Licence |
|---|---|---|---|---|
| `carte-driver.step` | ePaper Driver Board for Seeed Studio XIAO | Seeed Studio | [GrabCAD](https://grabcad.com/library/epaper-driver-board-for-seeed-studio-xiao-1), 11 mars 2025 | Conditions d'utilisation de GrabCAD |
| `dalle-7in5.step` | Écran e-ink 7,5" 800 × 480 noir et blanc | Seeed Studio | [GrabCAD](https://grabcad.com/library/7-5-monochrome-eink-epaper-display-with-800x480-px-1), 30 août 2025 | Conditions d'utilisation de GrabCAD |
| `xiao-esp32s3.step` | Seeed Studio XIAO ESP32-S3 | Seeed Studio | [Wiki Seeed](https://files.seeedstudio.com/wiki/SeeedStudio-XIAO-ESP32S3/res/seeed-studio-xiao-esp32s3-3d_model.zip) | Non indiquée |
| `pn532.step` | Module NFC PN532 V4.1 (même forme et mêmes trous que le V3) | Elechouse | [Elechouse](https://www.elechouse.com/wp-content/uploads/2022/04/ELECHOUSE_PN532_V4_3D.zip) | Non indiquée |
| `ttp223.step` | Module tactile TTP223 | noahbleau | [GitHub, KiCad.lib](https://github.com/noahbleau/KiCad.lib/tree/HEAD/TTP223) | Non indiquée |

## Écarts connus avec les pièces de la commande

- `ttp223.step` : circuit de 0,57 mm, le nôtre fait 1 mm. Le script cote les rails avec `TT_PCB`.
- `carte-driver.step` : porte le support femelle du XIAO (4,5 mm), gardé sur la nôtre : le XIAO y est enfiché par ses barrettes mâles (haut de sa prise USB-C à 13 mm sous la carte, `USB_TOP`).
- `pn532.step` : son circuit fait 0,41 mm dans le modèle, sans doute 1,6 en vrai (`PN_T`, à mesurer). Il contient un objet « CE » parasite sous la carte.
- Le buzzer piézo Ø 16 × 4 à câble n'a pas de modèle : le script le dessine.
