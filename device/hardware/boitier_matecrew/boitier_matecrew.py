"""Boîtier e-ink matécrew : modèle paramétrique Fusion.

Le script crée un nouveau document :
- les cotes sont des paramètres utilisateur (Modifier > Modifier les paramètres)
  et chaque esquisse est cotée par ces paramètres : changer une valeur dans
  Fusion met tout le modèle à jour ;
- composants « facade », « cadre » (pièces noires de la face), « chassis », « capot »,
  « socle », « composants » (visserie, aimants, batterie, buzzer, barrettes et Dupont)
  et « modeles » (modèles 3D réels des cartes, dans ../modeles) ;
- build() renvoie les erreurs de la timeline, les esquisses pas entièrement
  contraintes et les interférences entre les pièces, les maquettes et les modèles.

Le dessin suit le terminal du site (src/components/device-console/device-shell.tsx) :
dalle presque bord à bord, cadre d'écran noir, touches rondes à point central sous
les pixels 130 et 670, zone badge à icône NFC entre elles. Tout tient avec la commande
Bastelgarage : 8 aimants 10 x 1,6, 5 des 10 vis M2 x 5 Torx (tête Ø 3,8 x 1,6) et
5 inserts laiton M2 x 3 (Ø 3,6, trou de 3,2, profondeur 3,5 au moins).

Montage sans colle, sauf les aimants : la façade porte le PN532 (une vis dans un insert en bas,
un pion du châssis en haut), les touches (rails à lèvres), le buzzer (emmanché) et les pièces
noires de la face (posées par l'arrière). Le châssis, accroché en haut par des languettes, plaque
la dalle et la carte driver et porte la batterie dans une cage à lèvres. Le capot se visse aux
quatre coins, têtes noyées, et ses colonnes plaquent le bas du châssis et le haut du PN532. Six
aimants collés à fleur de son dos le tiennent sur un frigo ; les deux du bas le tiennent aussi
sur le socle, qui porte les deux derniers.

Repère : x vers la droite et y vers le haut vus de face, z = 0 sur la face
extérieure du capot (dos), z = BOX_D sur la face avant. Unités : mm.

Lancer : Utilitaires > Scripts et compléments > ce dossier, ou par le serveur
MCP de Fusion (voir device/hardware/README.md). `export(dossier)` écrit les STL
des pièces, le STEP et l'archive .f3d.
"""

import math
import os

import adsk.core
import adsk.fusion

# (nom, expression, commentaire[, unité]). Les noms d'une lettre ou qui sont des
# symboles d'unité (W, H, R, TW...) sont refusés par Fusion.
PARAMS = [
    # Boîtier : la dalle presque bord à bord, comme le terminal du site
    ("BOX_W", "P_W + 2 * (PANEL_GAP + T_WALL)", "largeur extérieure"),
    ("BOX_H", "P_Y + P_H + PANEL_GAP + T_WALL", "hauteur extérieure"),
    ("PANEL_GAP", "(BOX_R - T_WALL) * (1 - 1 / sqrt(2)) + 0.1 mm",
     "jeu entre la dalle et les parois : ses coins passent dans les arrondis de la cavité"),
    ("BOX_D", "15.2 mm", "épaisseur ; au moins 15,2 pour que le passage USB-C reste au-dessus du capot"),
    ("BOX_R", "8 mm", "rayon des coins"),
    ("FRONT_CH", "1.5 mm", "chanfrein de l'arête avant, à 45° : imprimée contre le plateau, un congé s'affaisserait"),
    ("FRONT_FR", "2 mm", "congé au-dessus du chanfrein avant : l'arête paraît arrondie et reste imprimable"),
    ("BASE_CH", "0.4 mm", "chanfrein des arêtes posées sur le plateau, contre la patte d'éléphant"),
    ("BACK_FR", "1 mm", "congé de l'arête arrière (la lèvre fait 1,2 mm)"),
    ("T_WALL", "1.6 mm", "parois latérales"),
    ("CAV_R", "BOX_R - T_WALL", "rayon intérieur des coins de la cavité : parois d'épaisseur constante"),
    ("T_FRONT", "1.6 mm", "façade, devant le lecteur NFC et les touches"),
    ("T_COVER", "1.2 mm", "capot ; tenu sur son tour par la feuillure et au milieu par la cage de la batterie"),
    ("LIP", "1.2 mm", "lèvre extérieure autour du capot"),
    ("GAP", "0.15 mm", "jeu capot / feuillure"),
    ("CAV_CLR", "0.2 mm", "jeu entre les pièces internes et les parois"),
    ("PAD", "2 mm", "plots des vis sous le capot : 1,4 mm de matière sous les têtes noyées"),
    ("Z_PLATE", "BOX_D - T_FRONT", "face intérieure de la façade"),
    ("Z_PAD", "T_COVER + PAD", "dessus des plots du capot"),
    # Dalle e-ink 7,5" 800 x 480 (GDEY075T7 du kit Seeed), nappe en haut
    ("P_W", "170.2 mm", "largeur de la dalle"),
    ("P_H", "111.2 mm", "hauteur de la dalle"),
    ("P_T", "1.25 mm", "épaisseur de la dalle"),
    ("P_LEDGE", "4 mm", "haut du verre sans couche avant : puce et collage de la nappe"),
    ("P_LEDGE_RELIEF", "0.5 mm", "dégagement de la façade devant ce rebord"),
    ("P_X", "(BOX_W - P_W) / 2", "gauche de la dalle"),
    ("P_Y", "KEY_Y + KEY_DROP - P_BORDER", "bas de la dalle, posé sur les touches : la bande du bas ne fait que "
                                         "ce qu'il faut aux touches, au pavé et au PN532 centré derrière lui"),
    ("P_BORDER", "3.5 mm", "bordure étroite (côtés et bas) ; la large (9,79) est en haut"),
    ("AA_W", "163.2 mm", "zone affichée, largeur"),
    ("AA_H", "97.92 mm", "zone affichée, hauteur"),
    ("AA_X", "P_X + P_BORDER", "gauche de la zone affichée"),
    ("AA_Y", "P_Y + P_BORDER", "bas de la zone affichée"),
    ("P_CLR", "0.25 mm", "jeu autour de la dalle"),
    ("Z_PANEL_BACK", "Z_PLATE - P_T", "dos de la dalle, face avant du châssis"),
    ("RIB_W", "1 mm", "nervure sous la dalle"),
    ("RIB_L", "12 mm", "nervures de centrage de la dalle, sur les côtés et en haut"),
    ("RIB_H", "P_T - 0.2 mm", "hauteur des nervures, sous le dos de la dalle pour laisser passer le châssis"),
    # Cadre noir de l'écran, pièce à part : posé dans la fenêtre par l'arrière, sa collerette
    # est prise entre la façade et la dalle
    ("FRAME_W", "1.5 mm", "largeur visible du cadre, autour de la zone affichée"),
    ("FRAME_R", "2 mm", "rayon extérieur du cadre"),
    ("FRAME_IN_R", "0.5 mm", "rayon intérieur du cadre"),
    ("FRAME_CLR", "0.15 mm", "jeu entre le cadre et la fenêtre de la façade"),
    ("FLANGE_W", "2 mm", "collerette du cadre, au-delà de la fenêtre"),
    ("FLANGE_T", "0.6 mm", "épaisseur de la collerette, logée dans la façade"),
    ("WIN_CH", "0.4 mm", "chanfrein des arêtes de la fenêtre et du cadre"),
    # Châssis derrière la dalle : languettes dans la paroi du haut, deux vis en bas
    ("CH_T", "1.6 mm", "épaisseur de la plaque du châssis (= épaisseur de la carte driver)"),
    ("CH_FRAME", "6 mm", "cadre du châssis sur la bordure de la dalle, autour des fenêtres"),
    ("CH_BAR", "6 mm", "barres qui portent l'îlot de la batterie"),
    ("CH_TAB_W", "10 mm", "languettes du haut du châssis"),
    ("CH_TAB_L", "0.9 mm", "débord des languettes dans la paroi"),
    ("CH_SLOT_D", "1 mm", "profondeur des logements des languettes dans la paroi"),
    ("CH_TAB_X", "22 mm", "languettes extérieures, depuis le bord ; les autres à BOX_W / 2 +/- 25"),
    ("FPC_WIN_W", "30 mm", "fenêtre du châssis pour le pli de la nappe et son raccord"),
    ("FPC_WIN_H", "25 mm", "hauteur de cette fenêtre, depuis le haut de la dalle"),
    ("CH_REST_D", "6 mm", "colonnes du capot qui plaquent le bas du châssis (et la dalle) contre la façade"),
    # Vis M2 x 5 Torx T6 à tête cylindrique Ø 3,8 x 1,6 et inserts laiton M2 x 3 Ø 3,6 de la commande.
    # Chaque vis traverse 1,4 à 1,6 mm de pièce puis prend toute la longueur de l'insert (3 mm).
    ("SCREW_D", "2.4 mm", "passage des vis M2"),
    ("INS_HOLE", "3.2 mm", "trou des inserts, cote du fabricant"),
    ("INS_DEPTH", "4 mm", "profondeur des trous d'inserts (3,5 au moins) : le bout de la vis y finit"),
    # Lecteur NFC PN532 V3
    # Monté face plate vers l'avant, composants et barrette I2C coudée vers le capot, barrette à droite
    # (son côté de 40,4 mm à la verticale). Cotes du modèle Elechouse, vues de face, depuis le coin
    # bas gauche du circuit.
    ("PN_W", "40.4 mm", "largeur du module, tourné d'un quart de tour : barrette I2C en haut"),
    ("PN_H", "42.7 mm", "hauteur du module"),
    ("PN_T", "1.6 mm", "épaisseur du circuit, à mesurer"),
    ("PN_SHIFT", "5 mm", "décalage à droite : le plot de la vis reste hors de la collerette du pavé NFC"),
    ("PN_X", "(BOX_W - PN_W) / 2 + PN_SHIFT", "gauche du module"),
    ("PN_Y", "T_WALL + 0.8 mm", "bas du module ; sa puce dépasse un peu du bord du circuit (modèle)"),
    ("PN_RAISE", "9.75 mm", "le PN532 monte sous la dalle au-dessus du pavé NFC : un badge (85 x 54) couvre "
                            "quand même son antenne"),
    ("PN_STANDOFF", "INS_DEPTH + 0.5 mm", "plot plein : trou d'insert borgne, 2,1 mm de matière devant lui "
                                          "pour que la pose à chaud ne marque pas la face avant"),
    ("PN_H1_X", "7.59 mm", "trou en haut à gauche, sous la dalle : pion du châssis devant, appui du capot derrière"),
    ("PN_H1_Y", "35.29 mm", "trou en haut à gauche"),
    ("PN_H2_X", "32.79 mm", "trou en bas à droite : la vis, dans un plot de la façade"),
    ("PN_H2_Y", "7.49 mm", "trou en bas à droite"),
    ("PN_HDR_X", "16.38 mm", "première broche de la barrette I2C depuis la gauche ; broches coudées vers le haut"),
    ("PN_HDR_Y", "36.29 mm", "rangée de la barrette I2C, depuis le bas"),
    ("PN_PIN_D", "2.6 mm", "pion du châssis dans le trou du haut (Ø 3,05)"),
    ("PN_PIN_PAD_D", "6 mm", "cale du châssis autour du pion, et appui du capot en face"),
    ("BOSS_D", "7 mm", "diamètre des plots à inserts : 1,7 mm de paroi"),
    # Touches tactiles TTP223, glissées dans des rails à lèvres, pastille contre la façade
    ("TT_W", "14.5 mm", "longueur du module, barrette coudée au bout côté centre"),
    ("TT_H", "11 mm", "largeur du module"),
    ("TT_PCB", "1 mm", "épaisseur du circuit (mesurée) : les lèvres le plaquent contre la façade"),
    ("TT_SOLDER", "1 mm", "creux de la façade sous les soudures de la barrette, côté pastille"),
    ("TT_SOLDER_L", "2.25 mm", "longueur du creux depuis le bord du circuit, hors du logement de la pastille"),
    ("TT_SOLDER_W", "8 mm", "largeur du creux, les trois broches"),
    ("TT_PAD_DX", "1.17 mm", "la zone tactile est décalée du centre du circuit, à l'opposé de la barrette "
                             "(modèle) : le module se décale d'autant pour la centrer sous la pastille"),
    ("KEY_X", "AA_X + AA_W * 130 / 800", "centre de la touche gauche, sous le pixel 130 (droite : BOX_W - KEY_X)"),
    ("KEY_Y", "PN_Y + PN_H / 2 - PN_RAISE", "centre des touches et du pavé NFC, devant le PN532"),
    ("KEY_DROP", "13.3 mm", "touches sous la zone affichée (12,5 sur le site) : les collerettes du pavé et du "
                            "cadre ne se chevauchent pas"),
    ("TT_CLR", "0.2 mm", "jeu autour des modules"),
    ("TT_FRAME", "1 mm", "paroi des rails"),
    ("TT_LIP", "0.6 mm", "débord des lèvres sur le circuit"),
    ("TT_LIP_T", "0.8 mm", "épaisseur des lèvres"),
    ("HDR_BODY", "2.5 mm", "corps des barrettes coudées"),
    ("DUPONT_L", "14 mm", "longueur d'un connecteur Dupont"),
    ("DUPONT_T", "2.6 mm", "section d'un connecteur Dupont"),
    ("WIRE_BEND", "6 mm", "place pour le coude des fils derrière un Dupont"),
    # Pastilles noires des touches, comme le cadre : partie visible et épaulement posé par l'arrière
    ("KEY_DOT_D", "8 mm", "pastille visible de chaque touche"),
    ("KEY_DOT_BACK_D", "9 mm", "épaulement de la pastille, qui l'empêche de sortir par l'avant"),
    ("INLAY_LIP", "0.6 mm", "épaisseur de la partie visible des pastilles"),
    ("INLAY_CLR", "0.15 mm", "jeu des pastilles et du pavé dans la façade"),
    # Buzzer piézo passif Ø 16 x 4 à câble, emmanché dans sa bague, derrière une micro-grille
    ("BUZ_X", "15 mm", "centre du buzzer, dans le coin bas gauche, au-dessus du gousset du plot d'angle"),
    ("BUZ_Y", "12 mm", "centre du buzzer"),
    ("BUZ_D", "16 mm", "diamètre du buzzer"),
    ("BUZ_H", "4 mm", "épaisseur du buzzer"),
    ("BUZ_FIT", "0 mm", "jeu radial dans la bague ; négatif pour serrer davantage"),
    ("BUZ_RING", "1.2 mm", "paroi de la bague"),
    ("BUZ_RING_H", "3 mm", "hauteur de la bague"),
    ("BUZ_SLOT", "3 mm", "encoche de la bague pour le câble du buzzer"),
    ("BUZ_HOLE", "1 mm", "trous de la grille"),
    ("BUZ_PITCH", "2.4 mm", "pas de la grille"),
    # Carte « ePaper Driver Board for XIAO » + XIAO ESP32-S3, couchée en haut à droite, prise USB-C
    # sur la tranche droite, connecteur de nappe vers la gauche. Cotes du modèle Seeed (GrabCAD) ; dans
    # le repère de la carte, u part du bout côté XIAO, v du bord côté encoche.
    ("DB_W", "42 mm", "longueur de la carte driver"),
    ("DB_H", "25 mm", "largeur de la carte driver"),
    ("DB_T", "1.6 mm", "épaisseur de la carte driver"),
    ("XIAO_OVER", "0.18 mm", "le XIAO dépasse du bout de la carte (broches centrées sur sa longueur)"),
    ("XIAO_CV", "12.39 mm", "axe du XIAO et de sa prise USB-C, depuis le bord de la carte"),
    ("DB_X", "BOX_W - T_WALL - 0.3 mm - USB_OVER - XIAO_OVER - DB_W", "gauche de la carte"),
    ("DB_Y", "USB_CY - XIAO_CV", "bas de la carte"),
    ("DB_HOLE_U1", "22.6 mm", "trous de la carte, depuis le bout côté XIAO"),
    ("DB_HOLE_U2", "40.26 mm", "trous de la carte, côté nappe"),
    ("DB_HOLE_V1", "1.9 mm", "trous de la carte, depuis le bord côté encoche"),
    ("DB_HOLE_V2", "23.2 mm", "trous de la carte, côté interrupteur"),
    ("DB_Z", "Z_PANEL_BACK - DB_T", "face composants de la carte, plaquée contre la dalle"),
    ("DB_CLR", "0.3 mm", "jeu de la carte dans la découpe du châssis"),
    ("TAB_W", "4.5 mm", "largeur des pattes qui retiennent la carte, sur les zones de ses trous"),
    ("TAB_OVER", "1.9 mm", "recouvrement des pattes sur la carte : jusqu'à l'axe de ses trous"),
    ("TAB_BASE", "2.5 mm", "accroche des pattes sur le châssis, à distance de la paroi du haut"),
    ("TAB_T", "1 mm", "épaisseur des pattes"),
    ("USB_OVER", "1.53 mm", "la prise USB-C dépasse du bord du XIAO"),
    ("XIAO_GAP", "2.5 mm", "entretoise des barrettes : place pour les fils sous le XIAO"),
    ("XIAO_USB_Z", "2.37 mm", "centre de la prise USB-C depuis le dessous du XIAO (modèle Seeed)"),
    ("USB_Z", "DB_Z - XIAO_GAP - XIAO_USB_Z", "centre de la prise USB-C"),
    ("DB_PIN_V2", "23.74 mm", "rangée de broches du haut de la carte (5V, GND, 3V3, D10 à D7), depuis le bord "
                              "de l'encoche"),
    ("PIN_ROOM", "15 mm", "place entre cette rangée et la paroi du haut, pour les fils soudés et leur coude"),
    ("USB_CY", "BOX_H - T_WALL - PIN_ROOM - (DB_PIN_V2 - XIAO_CV)", "hauteur de la prise USB-C sur la tranche droite"),
    ("USB_OPEN_W", "12.5 mm", "passage du surmoulage d'une fiche USB-C courante, largeur"),
    ("USB_OPEN_H", "7 mm", "passage du surmoulage, épaisseur"),
    ("USB_OPEN_R", "2 mm", "rayon des coins du passage : accepte les surmoulages ronds et rectangulaires"),
    ("USB_CH", "0.6 mm", "chanfrein du passage"),
    # Batterie LiPo 2000 mAh 654060, dans la cage du châssis, fils côté droit
    ("BAT_W", "60 mm", "longueur de la batterie"),
    ("BAT_H", "40 mm", "largeur de la batterie"),
    ("BAT_T", "6.5 mm", "épaisseur de la batterie"),
    ("BAT_CX", "BOX_W / 2", "centre de la batterie"),
    ("BAT_CY", "P_Y + P_H / 2 + 4 mm", "centre de la batterie, au-dessus des Dupont du PN532"),
    ("BAT_CLR", "0.5 mm", "jeu sur les côtés : les cellules souples dépassent leur cote"),
    ("BAT_END_CLR", "1 mm", "jeu aux extrémités"),
    ("BAT_T_CLR", "0.5 mm", "jeu sous les lèvres"),
    ("BAT_WALL", "1.2 mm", "parois de la cage"),
    ("BAT_WALL_L", "24 mm", "longueur des parois à lèvre"),
    ("BAT_STOP_L", "6 mm", "longueur des butées d'extrémité"),
    ("BAT_LIP", "0.8 mm", "débord des lèvres sur la batterie"),
    ("BAT_LIP_T", "0.8 mm", "épaisseur des lèvres"),
    ("CAGE_Z", "Z_PANEL_BACK - CH_T - BAT_T - BAT_T_CLR - BAT_LIP_T", "bas de la cage de la batterie"),
    ("COVER_REST_CLR", "0.1 mm", "jeu entre les appuis du capot et la cage : le capot porte dessus dès qu'on le "
                                 "presse, sans l'empêcher de se poser à plat"),
    # Aimants néodyme 10 x 1,6 mm, serrés dans leurs logements
    # Capot vissé aux quatre coins (vis M2 x 5 dans des inserts, têtes noyées)
    ("CORNER_OFF", "6 mm", "vis du capot, depuis l'angle extérieur"),
    # Plots d'angle : prisme triangulaire calé dans le coin, porté à l'impression (façade à l'envers) par
    # un gousset à 45° accroché aux deux parois. t : distance au coin le long de sa diagonale.
    ("CORNER_T", "CORNER_OFF * sqrt(2) + INS_HOLE / 2 + 1.2 mm", "étendue des plots d'angle le long de la "
                                                                "diagonale : 1,2 mm de paroi derrière l'insert"),
    ("CORNER_GUSSET_TOP", "Z_PANEL_BACK - 0.25 mm", "haut des goussets : la dalle passe devant"),
    ("CH_NOTCH_T", "CORNER_T - (Z_PANEL_BACK - CH_T - Z_PAD - INS_DEPTH) + 0.3 mm",
     "coins du haut du châssis coupés à 45° : les goussets passent"),
    ("CORNER_PAD_D", "2 * (CAV_R - CAV_CLR - (BOX_R - CORNER_OFF) * sqrt(2))",
     "plots des vis sous le capot, à CAV_CLR de l'arrondi des coins"),
    ("HEAD_D", "4.4 mm", "lamage des têtes de vis M2 (Ø 3,8)"),
    ("HEAD_DEPTH", "1.8 mm", "profondeur du lamage : tête de 1,6 en retrait de 0,2 du dos, qui reste plat"),
    # Aimants néodyme 10 x 1,6 mm collés à fleur du dos : 6 pour le frigo (environ 3 fois le poids
    # en glissement), dont les 2 du bas tiennent aussi le boîtier contre le socle ; 2 dans le socle
    ("MAG_D", "10.1 mm", "logement des aimants"),
    ("MAG_T", "1.6 mm", "épaisseur des aimants"),
    ("MAG_PAD_H", "0.8 mm", "renfort derrière chaque logement, côté intérieur du capot"),
    ("MAG_LOW_DX", "45 mm", "aimants du bas, en face de ceux du socle"),
    ("MAG_LOW_Y", "20 mm", "aimants du bas, depuis le bas du boîtier"),
    ("MAG_MID_DX", "60 mm", "aimants du milieu"),
    ("MAG_TOP_DX", "45 mm", "aimants du haut"),
    ("MAG_TOP_Y", "BOX_H - 25 mm", "aimants du haut"),

    # Fixation murale (trous de serrure dans le capot)
    ("KH_D", "7.5 mm", "tête de vis"),
    ("KH_SLOT", "3.6 mm", "fente"),
    ("KH_LEN", "7 mm", "longueur de la fente"),
    ("KH_DX", "50 mm", "écart des trous depuis le centre"),
    ("KH_Y", "BOX_H - 40 mm", "hauteur des trous"),
    # Encoche d'ouverture du capot, tranche du bas
    ("NOTCH_W", "18 mm", "largeur de l'encoche"),
    ("NOTCH_DEPTH", "T_COVER - 0.4 mm", "profondeur de l'encoche depuis le dos"),
    # Gravures de la face avant
    ("ENGR_DEPTH", "0.4 mm", "profondeur des gravures"),
    ("ENGR_W", "0.8 mm", "largeur des traits"),
    # Zone badge, comme le site : pavé noir à l'icône NFC (Lucide), à la hauteur des touches
    ("PAD_W", "22 mm", "largeur du pavé NFC"),
    ("PAD_H", "16.5 mm", "hauteur du pavé NFC"),
    ("PAD_R", "2.75 mm", "rayon du pavé NFC"),
    ("PAD_FLANGE", "1.2 mm", "collerette du pavé NFC, logée dans la façade"),
    ("NFC_SIZE", "10 mm", "taille de l'icône NFC (24 unités Lucide)"),
    ("NFC_ANGLE", "30 deg", "demi-ouverture des ondes", "deg"),
    # Socle de bureau : profilé fin, semelle + dossier incliné + lèvre avant
    ("SOCLE_X", "BOX_W + 30 mm", "position du socle dans le document, à droite du boîtier"),
    ("SOCLE_W", "140 mm", "largeur"),
    ("SOCLE_D", "90 mm", "profondeur de la semelle : loin derrière le dossier, le boîtier ne bascule pas "
                         "en arrière sous un appui sur une touche"),
    ("SOCLE_T", "2.4 mm", "épaisseur du profilé : peau et aimant du socle (0,8 + 1,6) ; plus fin, il s'imprime plus vite"),
    ("SOCLE_FR", "1.2 mm", "rayon des plis"),
    ("SOCLE_END_FR", "0.8 mm", "congé des arêtes des bouts"),
    ("TILT", "15 deg", "inclinaison du boîtier", "deg"),
    ("REST_Y", "24 mm", "pied du dossier, depuis l'avant de la semelle"),
    ("REST_L", "45 mm", "longueur du dossier"),
    ("LIP_L", "5 mm", "longueur de la lèvre avant : elle arrête le pied du boîtier sans cacher le pavé NFC"),
    ("SLOT_CLR", "0.6 mm", "jeu entre le boîtier et la lèvre"),
    ("SOCLE_SKIN", "0.8 mm", "peau devant les aimants du socle (deux passes de buse de 0,4) : face avant lisse"),
]

P3 = adsk.core.Point3D.create
VI = adsk.core.ValueInput.createByString
HORIZ = adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation
VERT = adsk.fusion.DimensionOrientations.VerticalDimensionOrientation
ALIGNED = adsk.fusion.DimensionOrientations.AlignedDimensionOrientation
NEW = adsk.fusion.FeatureOperations.NewBodyFeatureOperation
JOIN = adsk.fusion.FeatureOperations.JoinFeatureOperation
CUT = adsk.fusion.FeatureOperations.CutFeatureOperation
EPS = 1e-6
DESIGN_TAG = ("matecrew", "boitier")

_design = None
_planes = {}
_fixed = {}


# ---------------------------------------------------------------- expressions

def ev(expr):
    """Valeur d'une expression, en cm (unité interne de Fusion)."""
    return _design.unitsManager.evaluateExpression(expr, "mm")


def neg(expr):
    expr = expr.strip()
    if expr.startswith("-(") and expr.endswith(")"):
        depth = 0
        for i, ch in enumerate(expr[1:], 1):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0:
                if i == len(expr) - 1:
                    return expr[2:-1]
                break
    return f"-({expr})"


# ---------------------------------------------------------------- esquisses

def oc(items):
    coll = adsk.core.ObjectCollection.create()
    for item in items:
        coll.add(item)
    return coll


def plane(comp, expr, base=None):
    """Plan décalé de `expr` le long de la normale de `base` (XY par défaut)."""
    base = base or comp.xYConstructionPlane
    if abs(ev(expr)) < EPS:
        return base
    key = (comp.name, base.name, expr)
    if key not in _planes:
        inp = comp.constructionPlanes.createInput()
        inp.setByOffset(base, VI(expr))
        _planes[key] = comp.constructionPlanes.add(inp)
        _planes[key].name = expr
    return _planes[key]


def sketch(comp, pl, name):
    sk = comp.sketches.add(pl)
    sk.name = name
    return sk


def fix(sk, point, x=None, y=None):
    """Cote la position d'un point depuis l'origine de l'esquisse.

    Fusion refuse (« over constrained ») une deuxième cote depuis l'origine de même
    sens et de même valeur. Un point qui partage une coordonnée avec un point déjà
    coté lui est donc aligné : les formes d'une esquisse qui tombent sur la même
    coordonnée restent alignées quand les paramètres changent.
    """
    done = _fixed.setdefault(sk.entityToken, {})
    g = point.geometry
    gc = sk.geometricConstraints
    for expr, val, orient in ((x, g.x, HORIZ), (y, g.y, VERT)):
        if expr is None:
            continue
        align = gc.addVerticalPoints if orient == HORIZ else gc.addHorizontalPoints
        key = (orient, round(val, 5))
        if key in done:
            align(done[key], point)
            continue
        done[key] = point
        if abs(val) < EPS:
            align(sk.originPoint, point)
            continue
        text = P3(g.x / 2 if orient == HORIZ else g.x - 0.4, g.y - 0.4 if orient == HORIZ else g.y / 2, 0)
        dim = sk.sketchDimensions.addDistanceDimension(sk.originPoint, point, orient, text)
        dim.parameter.expression = expr if val > 0 else neg(expr)


def poly(sk, pts):
    """Polygone fermé, chaque sommet coté depuis l'origine : [(x, y), ...]."""
    lines = sk.sketchCurves.sketchLines
    geo = [P3(ev(x), ev(y), 0) for x, y in pts]
    ls = []
    for i in range(len(geo)):
        start = ls[-1].endSketchPoint if ls else geo[0]
        end = ls[0].startSketchPoint if i == len(geo) - 1 else geo[i + 1]
        ls.append(lines.addByTwoPoints(start, end))
    for line, (x, y) in zip(ls, pts):
        fix(sk, line.startSketchPoint, x, y)
    return ls


def rect(sk, x, y, w, h):
    return poly(sk, [(x, y), (f"{x} + {w}", y), (f"{x} + {w}", f"{y} + {h}"), (x, f"{y} + {h}")])


def rrect(sk, x, y, w, h, r):
    """Rectangle à coins arrondis : position, largeur, hauteur et rayon cotés."""
    x0, y0 = ev(x), ev(y)
    ls = sk.sketchCurves.sketchLines.addTwoPointRectangle(P3(x0, y0, 0), P3(x0 + ev(w), y0 + ev(h), 0))
    gc = sk.geometricConstraints
    bottom, right, top, left = (ls.item(i) for i in range(4))
    gc.addHorizontal(bottom)
    gc.addVertical(right)
    gc.addHorizontal(top)
    gc.addVertical(left)
    arcs = []
    for i in range(4):
        a, b = ls.item(i), ls.item((i + 1) % 4)
        arcs.append(sk.sketchCurves.sketchArcs.addFillet(a, a.endSketchPoint.geometry, b, b.startSketchPoint.geometry, ev(r)))
    fix(sk, left.startSketchPoint, x=x)
    fix(sk, bottom.startSketchPoint, y=y)
    dims = sk.sketchDimensions
    dims.addDistanceDimension(left.startSketchPoint, right.startSketchPoint, HORIZ,
                              P3(x0 + ev(w) / 2, y0 - 0.3, 0)).parameter.expression = w
    dims.addDistanceDimension(bottom.startSketchPoint, top.startSketchPoint, VERT,
                              P3(x0 - 0.3, y0 + ev(h) / 2, 0)).parameter.expression = h
    dims.addRadialDimension(arcs[0], P3(x0 + ev(w) + 0.2, y0 - 0.2, 0)).parameter.expression = r
    for arc in arcs[1:]:
        gc.addEqual(arcs[0], arc)
    return ls, arcs


def point(sk, x, y):
    p = sk.sketchPoints.add(P3(ev(x), ev(y), 0))
    fix(sk, p, x, y)
    return p


def circle(sk, x, y, d, center=None):
    center = center or point(sk, x, y)
    c = sk.sketchCurves.sketchCircles.addByCenterRadius(center, ev(d) / 2)
    g = center.geometry
    sk.sketchDimensions.addDiameterDimension(c, P3(g.x + ev(d) * 0.4, g.y + ev(d) * 0.4, 0)).parameter.expression = d
    return c


def rings(sk):
    """Profils à deux boucles : la matière entre deux contours imbriqués."""
    return [p for p in sk.profiles if p.profileLoops.count == 2]


def holes(sk):
    """Profils à une boucle : l'intérieur des contours."""
    return [p for p in sk.profiles if p.profileLoops.count == 1]


def corner_triangle(sk, cx, cy, t, out="10 mm"):
    """Triangle du coin (cx, cy) de la boîte : tout ce qui est à moins de t du coin le long de sa
    diagonale. Ses deux autres côtés passent à `out` hors de la boîte."""
    sx = "+" if ev(cx) < EPS else "-"
    sy = "+" if ev(cy) < EPS else "-"
    far = f"{t} * sqrt(2) + {out}"
    return poly(sk, [(f"{cx} {sx} -({out})", f"{cy} {sy} -({out})"),
                     (f"{cx} {sx} ({far})", f"{cy} {sy} -({out})"),
                     (f"{cx} {sx} -({out})", f"{cy} {sy} ({far})")])


# ---------------------------------------------------------------- fonctions 3D

def extrude(comp, profiles, dist, op, negative=False, bodies=None, name=None, taper=None):
    ef = comp.features.extrudeFeatures
    inp = ef.createInput(oc(profiles), op)
    direction = adsk.fusion.ExtentDirections.NegativeExtentDirection if negative \
        else adsk.fusion.ExtentDirections.PositiveExtentDirection
    if taper:
        inp.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(VI(dist)), direction, VI(taper))
    else:
        inp.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(VI(dist)), direction)
    if bodies:
        inp.participantBodies = bodies
    feat = ef.add(inp)
    if name:
        feat.name = name
    return feat


def extrude_sym(comp, profiles, dist, op, bodies=None, name=None):
    ef = comp.features.extrudeFeatures
    inp = ef.createInput(oc(profiles), op)
    inp.setSymmetricExtent(VI(dist), True)
    if bodies:
        inp.participantBodies = bodies
    feat = ef.add(inp)
    if name:
        feat.name = name
    return feat


def new_body(comp, profiles, dist, name, negative=False):
    body = extrude(comp, profiles, dist, NEW, negative, name=name).bodies.item(0)
    body.name = name
    return body


def fillet(comp, entities, r, name):
    ff = comp.features.filletFeatures
    inp = ff.createInput()
    inp.edgeSetInputs.addConstantRadiusEdgeSet(oc(entities), VI(r), True)
    ff.add(inp).name = name


def chamfer(comp, entities, dist, name):
    """Chanfrein égal. Une face passée telle quelle donne un chanfrein vide : on passe ses arêtes."""
    edges = []
    for e in entities:
        edges.extend(e.edges if isinstance(e, adsk.fusion.BRepFace) else [e])
    cf = comp.features.chamferFeatures
    inp = cf.createInput2()
    inp.chamferEdgeSets.addEqualDistanceChamferEdgeSet(oc(edges), VI(dist), True)
    feat = cf.add(inp)
    feat.name = name
    if feat.faces.count == 0:
        raise RuntimeError(f"chanfrein « {name} » vide")


def combine(comp, target, tools, op, name):
    cf = comp.features.combineFeatures
    inp = cf.createInput(target, oc(tools))
    inp.operation = op
    inp.isKeepToolBodies = False
    cf.add(inp).name = name


def vertical_edges(body):
    out = []
    for e in body.edges:
        if e.startVertex is None or e.endVertex is None:
            continue
        a, b = e.startVertex.geometry, e.endVertex.geometry
        if abs(a.x - b.x) < EPS and abs(a.y - b.y) < EPS and abs(a.z - b.z) > EPS:
            out.append(e)
    return out


def planar_face(body, nz, z):
    """Face plane de normale (0, 0, nz) à la cote z (cm)."""
    for f in body.faces:
        if f.geometry.surfaceType != adsk.core.SurfaceTypes.PlaneSurfaceType:
            continue
        _, n = f.evaluator.getNormalAtPoint(f.pointOnFace)
        if abs(n.z - nz) < EPS and abs(f.pointOnFace.z - z) < 1e-5:
            return f
    raise RuntimeError(f"pas de face plane de normale {nz} à z = {z * 10} mm sur {body.name}")


def edges_within(body, lo, hi):
    """Arêtes contenues dans la boîte [lo, hi] (expressions x, y, z)."""
    lo = [ev(e) - 1e-4 for e in lo]
    hi = [ev(e) + 1e-4 for e in hi]
    out = []
    for e in body.edges:
        a, b = e.boundingBox.minPoint.asArray(), e.boundingBox.maxPoint.asArray()
        if all(lo[i] <= a[i] and b[i] <= hi[i] for i in range(3)):
            out.append(e)
    if not out:
        raise RuntimeError(f"aucune arête de {body.name} dans la boîte demandée")
    return out


def paint(body, name, material=None):
    """Matériau physique (pour la masse) puis apparence, qui le recouvre à l'écran."""
    if material is not None:
        body.material = material
    appearance = _design.appearances.itemByName(name)
    if appearance is None:
        lib = adsk.core.Application.get().materialLibraries.itemByName("Fusion Appearance Library")
        appearance = _design.appearances.addByCopy(lib.appearances.itemByName(name), name)
    body.appearance = appearance


# PLA massif, valeurs indicatives (unités de Fusion : kg/m3, kPa, W/m.K, J/g.°C, µm/m.°C).
# Fusion n'a pas de PLA : on part de son ABS.
PLA = {
    "structural_Density": 1240.0,
    "structural_Young_modulus": 3.5e6,
    "structural_Poisson_ratio": 0.36,
    "structural_Shear_modulus": 1.29e6,
    "structural_Minimum_tensile_strength": 50000.0,
    "structural_Minimum_yield_stress": 45000.0,
    "structural_Thermal_conductivity": 0.13,
    "structural_Specific_heat": 1.8,
    "structural_Thermal_expansion_coefficient": 68.0,
}


def pla():
    material = _design.materials.itemByName("PLA")
    if material is None:
        lib = adsk.core.Application.get().materialLibraries.itemByName("Fusion Material Library")
        material = _design.materials.addByCopy(lib.materials.itemByName("ABS Plastic"), "PLA")
        props = material.materialProperties
        for i in range(props.count):
            prop = props.item(i)
            for key, value in PLA.items():
                if prop.id == key or prop.id.startswith(key + "_"):
                    prop.value = value
            if prop.id == "physmat_Comments":
                prop.value = "PLA massif, valeurs indicatives ; une pièce imprimée est moins rigide"
    return material


CORNERS = [("CORNER_OFF", "CORNER_OFF"), ("BOX_W - CORNER_OFF", "CORNER_OFF"),
           ("CORNER_OFF", "BOX_H - CORNER_OFF"), ("BOX_W - CORNER_OFF", "BOX_H - CORNER_OFF")]
BACK_MAGNETS = [(f"BOX_W / 2 {sx} MAG_{row}_DX", y) for row, y in (("LOW", "MAG_LOW_Y"), ("MID", "BOX_H / 2"),
                                                                    ("TOP", "MAG_TOP_Y")) for sx in "-+"]
CH_RESTS = [(f"BOX_W / 2 {sx} {dx}", "P_Y + CH_FRAME / 2") for dx in ("62 mm", "34 mm") for sx in "-+"]
CH_TABS = ["CH_TAB_X", "BOX_W / 2 - 25 mm", "BOX_W / 2 + 25 mm"]
KEYS = ["KEY_X", "BOX_W - KEY_X"]
TT_CENTERS = ["KEY_X + TT_PAD_DX", "BOX_W - KEY_X - TT_PAD_DX"]
PN_PIN_HOLE = ("PN_X + PN_H1_X", "PN_Y + PN_H1_Y")
PN_SCREW_HOLE = ("PN_X + PN_H2_X", "PN_Y + PN_H2_Y")
PN_HOLES = [PN_PIN_HOLE, PN_SCREW_HOLE]


def around(x, y, w, h, grow):
    """Rectangle (x, y, w, h) agrandi de `grow` de chaque côté."""
    return f"{x} - ({grow})", f"{y} - ({grow})", f"{w} + 2 * ({grow})", f"{h} + 2 * ({grow})"


AA = ("AA_X", "AA_Y", "AA_W", "AA_H")
PAD = ("BOX_W / 2 - PAD_W / 2", "KEY_Y - PAD_H / 2", "PAD_W", "PAD_H")


# Variante monobloc : une façade d'un seul tenant et d'une couleur, sans cadre, pastilles ni pavé NFC
# rapportés. Seule la fenêtre de l'écran la traverse ; les zones des touches et du badge sont gravées
# en traits fins (anneaux, contour du pavé, icône NFC). Le composant « cadre » reste vide.
MONOBLOC = False


# ---------------------------------------------------------------- façade

def build_facade(comp):
    xy = comp.xYConstructionPlane
    plate = plane(comp, "Z_PLATE")
    front = plane(comp, "BOX_D")

    sk = sketch(comp, xy, "Contour")
    rect(sk, "0 mm", "0 mm", "BOX_W", "BOX_H")
    body = new_body(comp, sk.profiles, "BOX_D", "facade")
    fillet(comp, vertical_edges(body), "BOX_R", "Coins")
    chamfer(comp, [planar_face(body, 1, ev("BOX_D"))], "FRONT_CH", "Chanfrein avant")
    fillet(comp, edges_within(body, ("-1 mm", "-1 mm", "BOX_D - FRONT_CH"), ("BOX_W + 1 mm", "BOX_H + 1 mm",
                                                                           "BOX_D - FRONT_CH")), "FRONT_FR", "Congé avant")
    fillet(comp, list(planar_face(body, -1, 0).edges), "BACK_FR", "Congé arrière")

    # Cavité, moins les plots d'angle où se visse le capot : un prisme droit autour de l'insert, puis un
    # gousset qui se resserre à 45° vers le coin jusqu'au dos de la dalle. La façade s'imprime face avant
    # sur le plateau : le gousset porte le plot, sans pont ni partie en l'air.
    sk = sketch(comp, xy, "Cavité")
    rect(sk, "T_WALL", "T_WALL", "BOX_W - 2 * T_WALL", "BOX_H - 2 * T_WALL")
    cavity = new_body(comp, sk.profiles, "Z_PLATE", "cavité")
    fillet(comp, vertical_edges(cavity), "CAV_R", "Coins cavité")
    for z, name in (("Z_PAD", "Plots d'angle"), ("Z_PAD + INS_DEPTH", "Goussets d'angle")):
        sk = sketch(comp, plane(comp, z), name)
        for cx, cy in (("0 mm", "0 mm"), ("BOX_W", "0 mm"), ("0 mm", "BOX_H"), ("BOX_W", "BOX_H")):
            corner_triangle(sk, cx, cy, "CORNER_T")
        if z == "Z_PAD":
            extrude(comp, sk.profiles, "INS_DEPTH", CUT, bodies=[cavity], name=name)
        else:
            extrude(comp, sk.profiles, "CORNER_GUSSET_TOP - Z_PAD - INS_DEPTH", CUT, bodies=[cavity], name=name,
                    taper="-45 deg")
    combine(comp, body, [cavity], CUT, "Cavité")

    sk = sketch(comp, xy, "Feuillure")
    rect(sk, "LIP", "LIP", "BOX_W - 2 * LIP", "BOX_H - 2 * LIP")
    rebate = new_body(comp, sk.profiles, "T_COVER", "feuillure")
    fillet(comp, vertical_edges(rebate), "BOX_R - LIP", "Coins feuillure")
    combine(comp, body, [rebate], CUT, "Feuillure du capot")

    # Nervure sous la dalle, et nervures courtes qui la centrent sur les côtés et en haut
    sk = sketch(comp, plate, "Nervures dalle")
    # Nervure du bas en deux morceaux : elle s'arrête avant le logement de la collerette du pavé NFC,
    # qu'elle franchirait en pont
    gap = "PAD_W / 2 + PAD_FLANGE + INLAY_CLR + 1 mm"
    rect(sk, "T_WALL", "P_Y - P_CLR - RIB_W", f"BOX_W / 2 - ({gap}) - T_WALL", "RIB_W")
    rect(sk, f"BOX_W / 2 + {gap}", "P_Y - P_CLR - RIB_W", f"BOX_W / 2 - ({gap}) - T_WALL", "RIB_W")
    side_w = "P_X - P_CLR - T_WALL + 0.5 mm"
    for yc in ("P_Y + P_H / 4", "P_Y + 3 * P_H / 4"):
        rect(sk, "T_WALL - 0.5 mm", f"{yc} - RIB_L / 2", side_w, "RIB_L")
        rect(sk, "P_X + P_W + P_CLR", f"{yc} - RIB_L / 2", side_w, "RIB_L")
    for xc in ("BOX_W / 2 - 45 mm", "BOX_W / 2 + 45 mm"):
        rect(sk, f"{xc} - RIB_L / 2", "P_Y + P_H + P_CLR", "RIB_L", "PANEL_GAP - P_CLR + 0.5 mm")
    extrude(comp, sk.profiles, "RIB_H", JOIN, negative=True, bodies=[body], name="Nervures dalle")

    # Logements des languettes du châssis, dans la paroi du haut
    sk = sketch(comp, plane(comp, "Z_PANEL_BACK + 0.15 mm"), "Logements languettes")
    for tx in CH_TABS:
        for x in (tx, f"BOX_W - {tx}") if tx == "CH_TAB_X" else (tx,):
            rect(sk, f"{x} - CH_TAB_W / 2 - 0.3 mm", "BOX_H - T_WALL - 1 mm", "CH_TAB_W + 0.6 mm", "1 mm + CH_SLOT_D")
    extrude(comp, sk.profiles, "CH_T + 0.3 mm", CUT, negative=True, bodies=[body], name="Logements languettes")

    # PN532 : un plot à insert pour son trou du bas ; celui du haut est sous la dalle (pion du châssis)
    sk = sketch(comp, plate, "Plot PN532")
    circle(sk, *PN_SCREW_HOLE, "BOSS_D")
    extrude(comp, sk.profiles, "PN_STANDOFF", JOIN, negative=True, bodies=[body], name="Plot PN532")
    sk = sketch(comp, plane(comp, "Z_PLATE - PN_STANDOFF"), "Insert PN532")
    circle(sk, *PN_SCREW_HOLE, "INS_HOLE")
    extrude(comp, sk.profiles, "INS_DEPTH", CUT, bodies=[body], name="Insert PN532")

    # Rails des touches : le module glisse depuis le centre, ses bords longs passent sous
    # les lèvres qui plaquent la pastille contre la façade
    sk = sketch(comp, plate, "Rails touches")
    lips = sketch(comp, plane(comp, "Z_PLATE - TT_PCB"), "Lèvres touches")
    yo0, yi0 = "KEY_Y - TT_H / 2 - TT_CLR - TT_FRAME", "KEY_Y - TT_H / 2 - TT_CLR"
    yi1, yo1 = "KEY_Y + TT_H / 2 + TT_CLR", "KEY_Y + TT_H / 2 + TT_CLR + TT_FRAME"
    for kx, side in zip(TT_CENTERS, (-1, 1)):
        closed_in =f"{kx} - TT_W / 2 - TT_CLR" if side < 0 else f"{kx} + TT_W / 2 + TT_CLR"
        closed_out = f"{closed_in} - TT_FRAME" if side < 0 else f"{closed_in} + TT_FRAME"
        open_end = f"{kx} + TT_W / 2 + TT_CLR" if side < 0 else f"{kx} - TT_W / 2 - TT_CLR"
        poly(sk, [(closed_out, yo0), (open_end, yo0), (open_end, yi0), (closed_in, yi0),
                  (closed_in, yi1), (open_end, yi1), (open_end, yo1), (closed_out, yo1)])
        for a, b in ((yo0, f"{yi0} + TT_LIP"), (f"{yi1} - TT_LIP", yo1)):
            poly(lips, [(closed_out, a), (open_end, a), (open_end, b), (closed_out, b)])
    extrude(comp, sk.profiles, "TT_PCB + TT_LIP_T", JOIN, negative=True, bodies=[body], name="Rails touches")
    extrude(comp, lips.profiles, "TT_LIP_T", JOIN, negative=True, bodies=[body], name="Lèvres touches")

    # Les soudures de la barrette coudée dépassent côté pastille : un creux les loge pour que le circuit
    # reste à plat contre la façade
    sk = sketch(comp, plate, "Creux soudures touches")
    for kx, side in zip(TT_CENTERS, (-1, 1)):
        edge = f"{kx} + TT_W / 2" if side < 0 else f"{kx} - TT_W / 2"
        x0 = f"{edge} - TT_SOLDER_L" if side < 0 else f"{edge} - TT_CLR"
        rect(sk, x0, "KEY_Y - TT_SOLDER_W / 2", "TT_SOLDER_L + TT_CLR", "TT_SOLDER_W")
    extrude(comp, sk.profiles, "TT_SOLDER", CUT, bodies=[body], name="Creux soudures touches")

    sk = sketch(comp, plate, "Bague buzzer")
    ring = circle(sk, "BUZ_X", "BUZ_Y", "BUZ_D + 2 * (BUZ_FIT + BUZ_RING)")
    circle(sk, "BUZ_X", "BUZ_Y", "BUZ_D + 2 * BUZ_FIT", center=ring.centerSketchPoint)
    extrude(comp, rings(sk), "BUZ_RING_H", JOIN, negative=True, bodies=[body], name="Bague buzzer")
    sk = sketch(comp, plate, "Encoche câble buzzer")
    rect(sk, "BUZ_X", "BUZ_Y - BUZ_SLOT / 2", "BUZ_D / 2 + BUZ_FIT + BUZ_RING + 1 mm", "BUZ_SLOT")
    extrude(comp, sk.profiles, "BUZ_RING_H", CUT, negative=True, bodies=[body], name="Encoche câble buzzer")

    sk = sketch(comp, plate, "Grille buzzer")
    for dx, dy in (("0 mm", "0 mm"), ("BUZ_PITCH", "0 mm"), ("-BUZ_PITCH", "0 mm"),
                   ("BUZ_PITCH / 2", "BUZ_PITCH * 0.866"), ("-BUZ_PITCH / 2", "BUZ_PITCH * 0.866"),
                   ("BUZ_PITCH / 2", "-BUZ_PITCH * 0.866"), ("-BUZ_PITCH / 2", "-BUZ_PITCH * 0.866")):
        circle(sk, f"BUZ_X + {dx}", f"BUZ_Y + {dy}", "BUZ_HOLE")
    extrude(comp, sk.profiles, "T_FRONT + 1 mm", CUT, bodies=[body], name="Grille buzzer")

    # Le haut du verre n'a pas de couche avant : la puce et la nappe y sont collées, rien ne doit y appuyer
    sk = sketch(comp, plate, "Dégagement rebord dalle")
    rect(sk, "P_X", "P_Y + P_H - P_LEDGE", "P_W", "P_LEDGE + P_CLR")
    extrude(comp, sk.profiles, "P_LEDGE_RELIEF", CUT, bodies=[body], name="Dégagement rebord dalle")

    if MONOBLOC:
        # Fenêtre au bord de la zone affichée, la dalle s'appuie directement sur la face intérieure ;
        # logements des incrustations noires, sauf l'icône NFC qui reste en blanc
        sk = sketch(comp, plate, "Fenêtre")
        rrect(sk, *AA, "FRAME_IN_R")
        extrude(comp, sk.profiles, "T_FRONT + 1 mm", CUT, bodies=[body], name="Fenêtre")
        chamfer(comp, edges_within(body, ("AA_X", "AA_Y", "BOX_D"), ("AA_X + AA_W", "AA_Y + AA_H", "BOX_D")),
                "WIN_CH", "Chanfrein fenêtre")
        # Zones gravées en traits de ENGR_W : face contre le plateau, chaque trait s'imprime en pont court
        sk = sketch(comp, plane(comp, "BOX_D - ENGR_DEPTH"), "Zones gravées")
        for kx in KEYS:
            ring = circle(sk, kx, "KEY_Y", "KEY_DOT_D")
            circle(sk, kx, "KEY_Y", "KEY_DOT_D - 2 * ENGR_W", center=ring.centerSketchPoint)
        rrect(sk, *PAD, "PAD_R")
        rrect(sk, *around(*PAD, "-ENGR_W"), "PAD_R - ENGR_W")
        extrude(comp, rings(sk), "ENGR_DEPTH + 1 mm", CUT, bodies=[body], name="Zones gravées")
        sk = sketch(comp, plane(comp, "BOX_D - ENGR_DEPTH"), "Icône NFC")
        extrude(comp, nfc_icon(sk, "BOX_W / 2", "KEY_Y"), "ENGR_DEPTH + 1 mm", CUT, bodies=[body],
                name="Icône NFC")
    else:
        # Fenêtre du cadre noir, et logement de sa collerette dans la face intérieure
        sk = sketch(comp, plate, "Fenêtre")
        rrect(sk, *around(*AA, "FRAME_W + FRAME_CLR"), "FRAME_R + FRAME_CLR")
        extrude(comp, sk.profiles, "T_FRONT + 1 mm", CUT, bodies=[body], name="Fenêtre")
        sk = sketch(comp, plate, "Logement collerette")
        rrect(sk, *around(*AA, "FRAME_W + FLANGE_W + FRAME_CLR"), "FRAME_R + FLANGE_W + FRAME_CLR")
        extrude(comp, sk.profiles, "FLANGE_T", CUT, bodies=[body], name="Logement collerette")
        g = "FRAME_W + FRAME_CLR"
        chamfer(comp, edges_within(body, (f"AA_X - {g}", f"AA_Y - {g}", "BOX_D"),
                                   (f"AA_X + AA_W + {g}", f"AA_Y + AA_H + {g}", "BOX_D")), "WIN_CH",
                "Chanfrein fenêtre")

    # Logements des pièces noires de la face, comme le site : pastilles des touches (trou épaulé,
    # posées par l'arrière, retenues par le module tactile) et pavé NFC (collerette). En monobloc, la
    # face reste pleine : les touches et le lecteur travaillent à travers 1,6 mm de PLA.
    if not MONOBLOC:
        sk = sketch(comp, plane(comp, "BOX_D - INLAY_LIP"), "Pastilles")
        for kx in KEYS:
            circle(sk, kx, "KEY_Y", "KEY_DOT_D + 2 * INLAY_CLR")
        extrude(comp, sk.profiles, "INLAY_LIP + 1 mm", CUT, bodies=[body], name="Pastilles")
        sk = sketch(comp, plate, "Épaulements pastilles")
        for kx in KEYS:
            circle(sk, kx, "KEY_Y", "KEY_DOT_BACK_D + 2 * INLAY_CLR")
        extrude(comp, sk.profiles, "T_FRONT - INLAY_LIP", CUT, bodies=[body], name="Épaulements pastilles")
        sk = sketch(comp, plate, "Pavé NFC")
        rrect(sk, *around(*PAD, "INLAY_CLR"), "PAD_R + INLAY_CLR")
        extrude(comp, sk.profiles, "T_FRONT + 1 mm", CUT, bodies=[body], name="Pavé NFC")
        sk = sketch(comp, plate, "Logement collerette pavé")
        rrect(sk, *around(*PAD, "PAD_FLANGE + INLAY_CLR"), "PAD_R + PAD_FLANGE + INLAY_CLR")
        extrude(comp, sk.profiles, "FLANGE_T", CUT, bodies=[body], name="Logement collerette pavé")

    # Passage USB-C sur la tranche droite, à la taille du surmoulage : la fiche s'enfonce jusqu'à
    # la prise. Sur ce plan, x d'esquisse = -z.
    sk = sketch(comp, plane(comp, "BOX_W - T_WALL / 2", comp.yZConstructionPlane), "Passage USB-C")
    rrect(sk, "-(USB_Z + USB_OPEN_H / 2)", "USB_CY - USB_OPEN_W / 2", "USB_OPEN_H", "USB_OPEN_W", "USB_OPEN_R")
    extrude_sym(comp, sk.profiles, "T_WALL + 2 mm", CUT, bodies=[body], name="Passage USB-C")
    chamfer(comp, edges_within(body, ("BOX_W", "USB_CY - USB_OPEN_W / 2", "USB_Z - USB_OPEN_H / 2"),
                               ("BOX_W", "USB_CY + USB_OPEN_W / 2", "USB_Z + USB_OPEN_H / 2")),
            "USB_CH", "Chanfrein USB-C")

    sk = sketch(comp, xy, "Encoche d'ouverture")
    rect(sk, "BOX_W / 2 - NOTCH_W / 2", "-1 mm", "NOTCH_W", "LIP + 1.1 mm")
    extrude(comp, sk.profiles, "NOTCH_DEPTH", CUT, bodies=[body], name="Encoche d'ouverture")

    sk = sketch(comp, plane(comp, "Z_PAD"), "Inserts capot")
    for x, y in CORNERS:
        circle(sk, x, y, "INS_HOLE")
    extrude(comp, sk.profiles, "INS_DEPTH", CUT, bodies=[body], name="Inserts capot")

    paint(body, "Plastic - Matte (White)", pla())
    return body


def nfc_icon(sk, x, y):
    """Icône NFC de Lucide : quatre ondes concentriques vers la droite. Renvoie les profils à graver.

    Ondes de rayon 6,45 / 10,24 / 13,81 / 17,5 et trait de 2 sur une grille de 24 ; leur centre
    est 12,8 à gauche du centre de l'icône.
    """
    unit = "NFC_SIZE / 24"
    cx, cy = f"{x} - 12.8 * {unit}", y
    center = point(sk, cx, cy)
    bands = []
    for r in (6.45, 10.24, 13.81, 17.5):
        bands.append((circle(sk, cx, cy, f"{2 * r - 2} * {unit}", center=center),
                      circle(sk, cx, cy, f"{2 * r + 2} * {unit}", center=center)))

    lines, gc, dims = sk.sketchCurves.sketchLines, sk.geometricConstraints, sk.sketchDimensions
    c = center.geometry
    length = f"19 * {unit}"
    a = _design.unitsManager.evaluateExpression("NFC_ANGLE", "deg")
    n = ev(length)
    axis = lines.addByTwoPoints(center, P3(c.x + n, c.y, 0))
    axis.isConstruction = True
    gc.addHorizontal(axis)
    up = lines.addByTwoPoints(center, P3(c.x + n * math.cos(a), c.y + n * math.sin(a), 0))
    down = lines.addByTwoPoints(center, P3(c.x + n * math.cos(a), c.y - n * math.sin(a), 0))
    gc.addSymmetry(up, down, axis)
    gc.addSymmetry(up.endSketchPoint, down.endSketchPoint, axis)
    dims.addAngularDimension(up, down, P3(c.x + 0.3, c.y, 0)).parameter.expression = "2 * NFC_ANGLE"
    dims.addDistanceDimension(up.startSketchPoint, up.endSketchPoint, ALIGNED,
                              P3(c.x + n, c.y + n * 0.8, 0)).parameter.expression = length
    dims.addDistanceDimension(axis.startSketchPoint, axis.endSketchPoint, ALIGNED,
                              P3(c.x + n / 2, c.y - 0.2, 0)).parameter.expression = length

    keep = []
    for p in sk.profiles:
        ents = [pc.sketchEntity for loop in p.profileLoops for pc in loop.profileCurves]
        if any(any(e == inner for e in ents) and any(e == outer for e in ents) for inner, outer in bands) \
                and p.boundingBox.minPoint.x > center.geometry.x:
            keep.append(p)
    return keep


# ---------------------------------------------------------------- pièces noires de la face

def build_cadre(comp):
    """Pièces noires de la face, imprimées ensemble en noir : cadre de l'écran, pastilles des touches,
    pavé NFC. Toutes affleurent la face avant et se posent par l'arrière, sans colle : la dalle serre
    le cadre, les modules tactiles plaquent les pastilles, le pavé tient par sa collerette.
    """
    if MONOBLOC:
        return
    plate = plane(comp, "Z_PLATE")
    front = plane(comp, "BOX_D")
    sk = sketch(comp, plate, "Cadre")
    rrect(sk, *around(*AA, "FRAME_W"), "FRAME_R")
    rrect(sk, *AA, "FRAME_IN_R")
    body = new_body(comp, rings(sk), "T_FRONT", "cadre")
    sk = sketch(comp, plate, "Collerette")
    rrect(sk, *around(*AA, "FRAME_W + FLANGE_W"), "FRAME_R + FLANGE_W")
    rrect(sk, *AA, "FRAME_IN_R")
    extrude(comp, rings(sk), "FLANGE_T", JOIN, bodies=[body], name="Collerette")
    chamfer(comp, edges_within(body, ("AA_X", "AA_Y", "BOX_D"), ("AA_X + AA_W", "AA_Y + AA_H", "BOX_D")),
            "WIN_CH", "Chanfrein intérieur")
    paint(body, "Plastic - Matte (Black)", pla())

    for name, kx in zip(("pastille gauche", "pastille droite"), KEYS):
        sk = sketch(comp, plane(comp, "BOX_D - INLAY_LIP"), name)
        circle(sk, kx, "KEY_Y", "KEY_DOT_D")
        dot = new_body(comp, sk.profiles, "INLAY_LIP", name)
        sk = sketch(comp, plate, f"Épaulement {name}")
        circle(sk, kx, "KEY_Y", "KEY_DOT_BACK_D")
        extrude(comp, sk.profiles, "T_FRONT - INLAY_LIP", JOIN, bodies=[dot], name=f"Épaulement {name}")
        paint(dot, "Plastic - Matte (Black)", pla())

    sk = sketch(comp, plate, "Pavé NFC")
    rrect(sk, *PAD, "PAD_R")
    pad = new_body(comp, sk.profiles, "T_FRONT", "pavé nfc")
    sk = sketch(comp, plate, "Collerette pavé")
    rrect(sk, *around(*PAD, "PAD_FLANGE"), "PAD_R + PAD_FLANGE")
    rrect(sk, *PAD, "PAD_R")
    extrude(comp, rings(sk), "FLANGE_T", JOIN, bodies=[pad], name="Collerette pavé")
    sk = sketch(comp, front, "Icône NFC")
    extrude(comp, nfc_icon(sk, "BOX_W / 2", "KEY_Y"), "ENGR_DEPTH", CUT, negative=True, bodies=[pad],
            name="Icône NFC")
    paint(pad, "Plastic - Matte (Black)", pla())


# ---------------------------------------------------------------- châssis

def build_chassis(comp):
    """Plaque derrière la dalle : accrochée en haut par trois languettes, plaquée en bas par quatre
    colonnes du capot, sans vis.

    Elle plaque la dalle, tient la carte driver par quatre pattes (le bord gauche de sa découpe
    retient la carte quand on enfonce la fiche USB-C, une butée quand on la retire), porte la batterie
    dans une cage à lèvres et tient le haut du PN532 par un pion.
    """
    face = plane(comp, "Z_PANEL_BACK")
    back = plane(comp, "Z_PANEL_BACK - CH_T")

    sk = sketch(comp, face, "Plaque")
    rect(sk, "P_X", "P_Y", "P_W", "P_H")
    for tx in CH_TABS:
        for x in (tx, f"BOX_W - {tx}") if tx == "CH_TAB_X" else (tx,):
            rect(sk, f"{x} - CH_TAB_W / 2", "P_Y + P_H - 1 mm", "CH_TAB_W", "1 mm + CH_TAB_L")
    body = new_body(comp, sk.profiles, "CH_T", "chassis", negative=True)

    # Fenêtres : il reste le cadre sur la bordure de la dalle, l'îlot de la batterie et ses barres.
    # Celle du haut laisse passer le pli de la nappe et son raccord.
    bat_l = "BAT_CX - BAT_W / 2 - BAT_END_CLR - BAT_WALL"
    bat_r = "BAT_CX + BAT_W / 2 + BAT_END_CLR + BAT_WALL"
    bot, top = "P_Y + CH_FRAME", "P_Y + P_H - CH_FRAME"
    top_r = "DB_Y - DB_CLR - TAB_BASE - CH_BAR"
    sk = sketch(comp, face, "Fenêtres")
    poly(sk, [("P_X + CH_FRAME", bot), (f"{bat_l} - CH_BAR", bot), (f"{bat_l} - CH_BAR", top), ("P_X + CH_FRAME", top)])
    poly(sk, [(f"{bat_r} + CH_BAR", bot), ("P_X + P_W - CH_FRAME", bot), ("P_X + P_W - CH_FRAME", top_r),
              (f"{bat_r} + CH_BAR", top_r)])
    under = "BAT_CY - BAT_H / 2 - BAT_CLR - BAT_WALL - CH_BAR"
    poly(sk, [(bat_l, bot), (bat_r, bot), (bat_r, under), (bat_l, under)])
    rect(sk, "BOX_W / 2 - FPC_WIN_W / 2", "P_Y + P_H - FPC_WIN_H", "FPC_WIN_W", "FPC_WIN_H + 1 mm")
    extrude(comp, sk.profiles, "CH_T + 1 mm", CUT, negative=True, bodies=[body], name="Fenêtres")

    sk = sketch(comp, face, "Découpe carte")
    rect(sk, "DB_X - DB_CLR", "DB_Y - DB_CLR", "BOX_W - DB_X", "DB_H + 2 * DB_CLR")
    extrude(comp, sk.profiles, "CH_T + 1 mm", CUT, negative=True, bodies=[body], name="Découpe carte")
    # Butée au bout de la carte, contre la paroi : en débranchant la fiche USB-C (8 à 20 N), la carte ne
    # glisse pas vers la droite et ne tire pas sur la nappe. Le XIAO et sa prise passent derrière.
    # Elle tient à la plaque par deux bras, au-dessus et au-dessous de la découpe.
    sk = sketch(comp, face, "Butée carte")
    stop_x = "DB_X + DB_W + DB_CLR"
    poly(sk, [("P_X + P_W - 2 mm", "DB_Y - DB_CLR - TAB_BASE"), ("BOX_W - T_WALL - CAV_CLR", "DB_Y - DB_CLR - TAB_BASE"),
              ("BOX_W - T_WALL - CAV_CLR", "DB_Y + DB_H + DB_CLR + TAB_BASE"),
              ("P_X + P_W - 2 mm", "DB_Y + DB_H + DB_CLR + TAB_BASE"), ("P_X + P_W - 2 mm", "DB_Y + DB_H + DB_CLR"),
              (stop_x, "DB_Y + DB_H + DB_CLR"), (stop_x, "DB_Y - DB_CLR"), ("P_X + P_W - 2 mm", "DB_Y - DB_CLR")])
    extrude(comp, sk.profiles, "CH_T", JOIN, negative=True, bodies=[body], name="Butée carte")

    # Pion qui tient le haut du PN532, sous la dalle : une cale jusqu'à sa face plate, puis le pion dans son
    # trou ; le capot l'appuie par derrière
    sk = sketch(comp, face, "Languette PN532")
    rect(sk, f"{PN_PIN_HOLE[0]} - PN_PIN_PAD_D / 2", "P_Y", "PN_PIN_PAD_D", f"{PN_PIN_HOLE[1]} - P_Y")
    extrude(comp, sk.profiles, "CH_T", JOIN, negative=True, bodies=[body], name="Languette PN532")
    sk = sketch(comp, face, "Cale PN532")
    circle(sk, *PN_PIN_HOLE, "PN_PIN_PAD_D")
    extrude(comp, sk.profiles, "Z_PANEL_BACK - (Z_PLATE - PN_STANDOFF)", JOIN, negative=True, bodies=[body],
            name="Cale PN532")
    sk = sketch(comp, plane(comp, "Z_PLATE - PN_STANDOFF"), "Pion PN532")
    circle(sk, *PN_PIN_HOLE, "PN_PIN_D")
    extrude(comp, sk.profiles, "PN_T + 0.5 mm", JOIN, negative=True, bodies=[body], name="Pion PN532")

    # Coins du haut coupés à 45° (plaque et haut de la butée) : les goussets des plots d'angle passent
    sk = sketch(comp, face, "Coins coupés")
    for cx in ("0 mm", "BOX_W"):
        corner_triangle(sk, cx, "BOX_H", "CH_NOTCH_T")
    extrude(comp, sk.profiles, "CH_T + 1 mm", CUT, negative=True, bodies=[body], name="Coins coupés")
    # Pattes sur les zones des quatre trous de la carte, libres de composants
    sk = sketch(comp, back, "Pattes carte")
    side_w = "TAB_BASE + DB_CLR + TAB_OVER"
    for u in ("DB_HOLE_U1", "DB_HOLE_U2"):
        tx = f"DB_X + DB_W - {u}"
        rect(sk, f"{tx} - TAB_W / 2", "DB_Y - DB_CLR - TAB_BASE", "TAB_W", side_w)
        rect(sk, f"{tx} - TAB_W / 2", "DB_Y + DB_H - TAB_OVER", "TAB_W", side_w)
    extrude(comp, sk.profiles, "TAB_T", JOIN, negative=True, bodies=[body], name="Pattes carte")

    # Cage de la batterie : deux parois à lèvre sur les grands côtés, une butée à gauche,
    # deux butées d'angle à droite entre lesquelles sortent les fils
    bx0, by0, by1 = "BAT_CX - BAT_W / 2 - BAT_END_CLR", "BAT_CY - BAT_H / 2 - BAT_CLR", "BAT_CY + BAT_H / 2 + BAT_CLR"
    wx = "BAT_CX - BAT_WALL_L / 2"
    sk = sketch(comp, back, "Cage batterie")
    cage_walls(sk)
    extrude(comp, sk.profiles, "BAT_T + BAT_T_CLR + BAT_LIP_T", JOIN, negative=True, bodies=[body],
            name="Cage batterie")
    sk = sketch(comp, plane(comp, "Z_PANEL_BACK - CH_T - BAT_T - BAT_T_CLR"), "Lèvres batterie")
    rect(sk, wx, f"{by1} - BAT_LIP", "BAT_WALL_L", "BAT_LIP + BAT_WALL")
    rect(sk, wx, f"{by0} - BAT_WALL", "BAT_WALL_L", "BAT_WALL + BAT_LIP")
    extrude(comp, sk.profiles, "BAT_LIP_T", JOIN, negative=True, bodies=[body], name="Lèvres batterie")

    paint(body, "Plastic - Matte (Black)", pla())
    return body


def cage_walls(sk, lips=False):
    """Parois de la cage de la batterie : deux longues sur les grands côtés, une butée à gauche, deux
    butées d'angle à droite entre lesquelles sortent les fils. Avec lips, les longues parois prennent
    aussi la largeur de leur lèvre (dessous de la cage, où s'appuie le capot)."""
    bx0, bx1 = "BAT_CX - BAT_W / 2 - BAT_END_CLR", "BAT_CX + BAT_W / 2 + BAT_END_CLR"
    by0, by1 = "BAT_CY - BAT_H / 2 - BAT_CLR", "BAT_CY + BAT_H / 2 + BAT_CLR"
    wx, lip = "BAT_CX - BAT_WALL_L / 2", "BAT_WALL + BAT_LIP" if lips else "BAT_WALL"
    rect(sk, wx, f"{by1} - BAT_LIP" if lips else by1, "BAT_WALL_L", lip)
    rect(sk, wx, f"{by0} - BAT_WALL", "BAT_WALL_L", lip)
    rect(sk, f"{bx0} - BAT_WALL", "BAT_CY - BAT_WALL_L / 2", "BAT_WALL", "BAT_WALL_L")
    rect(sk, bx1, f"{by1} - BAT_STOP_L", "BAT_WALL", "BAT_STOP_L")
    rect(sk, bx1, by0, "BAT_WALL", "BAT_STOP_L")


# ---------------------------------------------------------------- capot

def build_capot(comp):
    """Plaque arrière, vissée aux quatre coins de la façade, têtes noyées. Elle plaque le bas du châssis
    et le haut du PN532, et porte sur la cage de la batterie. Trous de serrure pour le mur ; six aimants
    collés à fleur du dos pour un frigo, dont les deux du bas tiennent aussi le boîtier sur le socle."""
    xy = comp.xYConstructionPlane
    top = plane(comp, "T_COVER")

    sk = sketch(comp, xy, "Plaque")
    rect(sk, "LIP + GAP", "LIP + GAP", "BOX_W - 2 * (LIP + GAP)", "BOX_H - 2 * (LIP + GAP)")
    body = new_body(comp, sk.profiles, "T_COVER", "capot")
    fillet(comp, vertical_edges(body), "BOX_R - LIP - GAP", "Coins")
    chamfer(comp, [planar_face(body, -1, 0)], "BASE_CH", "Chanfrein de pose")

    sk = sketch(comp, top, "Plots des vis")
    for x, y in CORNERS:
        circle(sk, x, y, "CORNER_PAD_D")
    extrude(comp, sk.profiles, "PAD", JOIN, bodies=[body], name="Plots des vis")
    sk = sketch(comp, xy, "Vis capot")
    for x, y in CORNERS:
        circle(sk, x, y, "SCREW_D")
    extrude(comp, sk.profiles, "Z_PAD", CUT, bodies=[body], name="Vis capot")
    sk = sketch(comp, xy, "Lamages")
    for x, y in CORNERS:
        circle(sk, x, y, "HEAD_D")
    extrude(comp, sk.profiles, "HEAD_DEPTH", CUT, bodies=[body], name="Lamages")

    # Appuis sous la cage de la batterie : le milieu du capot porte sur le châssis
    sk = sketch(comp, top, "Appuis cage")
    cage_walls(sk, lips=True)
    extrude(comp, sk.profiles, "CAGE_Z - COVER_REST_CLR - T_COVER", JOIN, bodies=[body], name="Appuis cage")

    # Colonnes qui plaquent le bas du châssis, et la dalle avec lui, contre la façade
    sk = sketch(comp, top, "Appuis châssis")
    for x, y in CH_RESTS:
        circle(sk, x, y, "CH_REST_D")
    extrude(comp, sk.profiles, "Z_PANEL_BACK - CH_T - T_COVER", JOIN, bodies=[body], name="Appuis châssis")

    # Appui derrière le haut du PN532, en face du pion du châssis
    sk = sketch(comp, top, "Appui PN532")
    ring = circle(sk, *PN_PIN_HOLE, "PN_PIN_PAD_D")
    circle(sk, *PN_PIN_HOLE, "PN_PIN_D + 0.6 mm", center=ring.centerSketchPoint)
    extrude(comp, rings(sk), "Z_PLATE - PN_STANDOFF - PN_T - COVER_REST_CLR - T_COVER", JOIN, bodies=[body],
            name="Appui PN532")

    # Aimants collés à fleur du dos, renforcés côté intérieur
    sk = sketch(comp, top, "Renforts aimants")
    for x, y in BACK_MAGNETS:
        circle(sk, x, y, "MAG_D + 2.4 mm")
    extrude(comp, sk.profiles, "MAG_T + MAG_PAD_H - T_COVER", JOIN, bodies=[body], name="Renforts aimants")
    sk = sketch(comp, xy, "Logements aimants")
    for x, y in BACK_MAGNETS:
        circle(sk, x, y, "MAG_D")
    extrude(comp, sk.profiles, "MAG_T", CUT, bodies=[body], name="Logements aimants")

    sk = sketch(comp, xy, "Fixation murale")
    for kx in ("BOX_W / 2 - KH_DX", "BOX_W / 2 + KH_DX"):
        circle(sk, kx, "KH_Y", "KH_D")
        rect(sk, f"{kx} - KH_SLOT / 2", "KH_Y", "KH_SLOT", "KH_LEN")
        circle(sk, kx, "KH_Y + KH_LEN", "KH_SLOT")
    extrude(comp, sk.profiles, "T_COVER", CUT, bodies=[body], name="Fixation murale")

    paint(body, "Plastic - Matte (White)", pla())
    return body


# ---------------------------------------------------------------- socle

def build_socle(comp):
    """Profilé fin, à la manière d'une tôle pliée : semelle, dossier incliné de TILT, petite lèvre avant.

    Le boîtier pose son arête arrière basse dans l'angle de la semelle et du dossier, le dos contre
    le dossier ; la lèvre arrête son pied. Les deux aimants collés dans le dossier attirent les deux
    du bas du capot. S'imprime semelle sur le plateau, sans support : le dossier et la lèvre penchent
    de TILT seulement. Sur les plans des esquisses, x d'esquisse = -z.
    """
    def yz(y, z):
        return neg(z), y

    half, slab = "SOCLE_T / 2", "SOCLE_T / cos(TILT)"
    lip_y = "REST_Y - (BOX_D + SLOT_CLR) / cos(TILT)"
    sk = sketch(comp, plane(comp, "SOCLE_X", comp.yZConstructionPlane), "Profil")
    poly(sk, [yz("0 mm", "0 mm"), yz("SOCLE_D", "0 mm"), yz("SOCLE_D", "SOCLE_T"), yz("0 mm", "SOCLE_T")])
    rest_y0, rest_y1 = "REST_Y - SOCLE_T / 2 * tan(TILT)", "REST_Y + REST_L * sin(TILT)"
    rest_top = "SOCLE_T + REST_L * cos(TILT)"
    poly(sk, [yz(rest_y0, half), yz(rest_y1, rest_top), yz(f"{rest_y1} + {slab}", rest_top),
              yz(f"{rest_y0} + {slab}", half)])
    lip_y0, lip_y1 = f"{lip_y} - SOCLE_T / 2 * tan(TILT)", f"{lip_y} + LIP_L * sin(TILT)"
    lip_top = "SOCLE_T + LIP_L * cos(TILT)"
    poly(sk, [yz(lip_y0, half), yz(lip_y1, lip_top), yz(f"{lip_y1} - {slab}", lip_top),
              yz(f"{lip_y0} - {slab}", half)])
    body = new_body(comp, sk.profiles, "SOCLE_W", "socle")

    # Plis et arêtes du profil arrondis ; les bouts restent coupés net, comme un profilé
    folds = []
    for e in body.edges:
        if e.startVertex is None or e.endVertex is None:
            continue
        a, b = e.startVertex.geometry, e.endVertex.geometry
        if abs(a.y - b.y) < EPS and abs(a.z - b.z) < EPS and abs(a.x - b.x) > EPS and a.z > EPS:
            folds.append(e)
    fillet(comp, folds, "SOCLE_FR", "Plis")
    ends = [e for f in body.faces if f.geometry.surfaceType == adsk.core.SurfaceTypes.PlaneSurfaceType
            and abs(abs(f.evaluator.getNormalAtPoint(f.pointOnFace)[1].x) - 1) < EPS
            for e in f.edges if min(e.startVertex.geometry.z, e.endVertex.geometry.z) > EPS]
    fillet(comp, ends, "SOCLE_END_FR", "Bouts")
    chamfer(comp, [planar_face(body, -1, 0)], "BASE_CH", "Chanfrein de pose")

    # Logements ronds des deux aimants du socle, en face des aimants du bas du capot. Ouverts au dos du
    # dossier : l'aimant s'y colle contre une peau de SOCLE_SKIN (polarité : il doit attirer celui du
    # capot) et la face avant reste lisse. Dans le repère du dossier : s le long de la pente depuis son
    # pied, u dans son épaisseur vers l'arrière. On fait tourner une demi-section autour de l'axe.
    def at(s, u):
        y = f"REST_Y + ({s}) * sin(TILT) + ({u}) * cos(TILT)"
        z = f"SOCLE_T + ({s}) * cos(TILT) - ({u}) * sin(TILT)"
        return yz(y, z)

    s0, s1 = "MAG_LOW_Y", "MAG_LOW_Y + MAG_D / 2"
    rf = comp.features.revolveFeatures
    for i, dx in enumerate(("-", "+")):
        sk = sketch(comp, plane(comp, f"SOCLE_X + SOCLE_W / 2 {dx} MAG_LOW_DX", comp.yZConstructionPlane),
                    f"Aimant socle {i + 1}")
        axis = poly(sk, [at(s0, "SOCLE_SKIN"), at(s0, "SOCLE_T + 1 mm"), at(s1, "SOCLE_T + 1 mm"),
                         at(s1, "SOCLE_SKIN")])[0]
        inp = rf.createInput(sk.profiles.item(0), axis, CUT)
        inp.setAngleExtent(False, VI("360 deg"))
        inp.participantBodies = [body]
        rf.add(inp).name = f"Aimant socle {i + 1}"

    paint(body, "Plastic - Matte (White)", pla())
    return body


# ---------------------------------------------------------------- modèles 3D des cartes

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "modeles")

# Modèles des fabricants (voir ../modeles/LICENCES.md), posés sur les cotes du script : nom, fichier,
# directions des axes x, y, z du modèle dans le repère du boîtier, position de l'origine du modèle,
# sous-ensembles à retirer (préfixes), et partie du modèle à couper (axe du modèle, cote).
# Les cotes en mm sont relevées dans chaque modèle.
MODELS = [
    # Dalle : verre 170,4 x 111,4 x 1,19 centré sur l'origine, face affichée en +z, nappe vers -x.
    # La nappe du modèle est à plat : on la coupe au ras du verre (le pli et le raccord sont des maquettes).
    ("dalle", "dalle-7in5.step", ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
     ("P_X + P_W / 2", "P_Y + P_H / 2", "Z_PLATE - 1.2 mm"), (), ("x", "-55.75 mm")),
    # Carte driver : face composants en y = 0, bout côté XIAO en z = -20,08, bord de l'encoche en x = -9,02.
    # Son support femelle du XIAO est retiré : le XIAO est soudé sur les barrettes mâles.
    ("carte driver", "carte-driver.step", ((0, 1, 0), (0, 0, -1), (-1, 0, 0)),
     ("DB_X + DB_W - 20.08 mm", "DB_Y + 9.02 mm", "DB_Z"), ("xiao header pins",), None),
    # XIAO : dessous en y = -0,25, prise USB-C en +x (bout du circuit en x = 12,28), axe en z = -6,11
    ("xiao", "xiao-esp32s3.step", ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
     ("DB_X + DB_W + XIAO_OVER - 12.28 mm", "USB_CY + 6.11 mm", "DB_Z - XIAO_GAP - 0.25 mm"), (), None),
    # PN532 : composants en +z sur un circuit de 0,41 (x de -40,69 à 1,99, y de -20,19 à 20,19), barrette I2C
    # en x = -34,3 : tourné d'un quart de tour, elle passe en haut. Le circuit du modèle est retiré (le vrai
    # fait PN_T : une maquette le remplace, contre le plot) ; l'objet « CE » flotte sous la carte.
    ("pn532", "pn532.step", ((0, -1, 0), (-1, 0, 0), (0, 0, -1)),
     ("PN_X + 20.21 mm", "PN_Y + 1.99 mm", "Z_PLATE - PN_STANDOFF - PN_T + 0.411 mm"),
     ("Board", "CE", "TopSilkscreen", "BottomSilkscreen", "Designator"), None),
    # TTP223 : composants en +z sur un circuit de 0,5 (face composants en z = 0,5), zone tactile centrée
    # en x = -1,17, barrette en +x. Son circuit est retiré : il est faux (0,5 mm au lieu de 1 mesuré) et
    # bloque le calcul d'interférences ; une maquette à la bonne épaisseur le remplace.
    ("touche gauche", "ttp223.step", ((1, 0, 0), (0, -1, 0), (0, 0, -1)),
     ("KEY_X + TT_PAD_DX", "KEY_Y", "Z_PLATE - TT_PCB + 0.5 mm"), ("Деталь",), None),
    ("touche droite", "ttp223.step", ((-1, 0, 0), (0, 1, 0), (0, 0, -1)),
     ("BOX_W - KEY_X - TT_PAD_DX", "KEY_Y", "Z_PLATE - TT_PCB + 0.5 mm"), ("Деталь",), None),
]


def build_modeles(comp):
    """Importe les modèles réels des cartes. Ils sont posés d'après les paramètres au moment du
    build et ne suivent pas une modification ensuite : relancer le script."""
    im = adsk.core.Application.get().importManager
    for name, path, axes, origin, drop, cut in MODELS:
        m = adsk.core.Matrix3D.create()
        m.setWithCoordinateSystem(P3(*(ev(e) for e in origin)), *(adsk.core.Vector3D.create(*a) for a in axes))
        holder = comp.occurrences.addNewComponent(m)
        holder.component.name = name
        im.importToTarget(im.createSTEPImportOptions(os.path.join(MODELS_DIR, path)), holder.component)
        if drop:
            for o in [o for o in holder.component.allOccurrences if o.name.startswith(drop)]:
                if o.isValid:
                    o.deleteMe()
        if cut:
            axis, at = cut
            i, at = "xyz".index(axis), ev(at)
            for c in [o.component for o in holder.component.allOccurrences]:
                for body in [b for b in c.bRepBodies
                             if b.boundingBox.minPoint.asArray()[i] < at < b.boundingBox.maxPoint.asArray()[i]]:
                    inp = c.constructionPlanes.createInput()
                    inp.setByOffset((c.yZConstructionPlane, c.xZConstructionPlane, c.xYConstructionPlane)[i],
                                    adsk.core.ValueInput.createByReal(at))
                    c.features.splitBodyFeatures.add(
                        c.features.splitBodyFeatures.createInput(body, c.constructionPlanes.add(inp), True))
                    for piece in [b for b in c.bRepBodies if b.boundingBox.maxPoint.asArray()[i] < at + 1e-5]:
                        c.features.removeFeatures.add(piece)
        for c in [holder.component] + [o.component for o in holder.component.allOccurrences]:
            for pl in c.constructionPlanes:
                pl.isLightBulbOn = False


# ---------------------------------------------------------------- maquettes des composants

def build_composants(comp):
    """Ce qui n'a pas de modèle : circuits des TTP223, barrettes coudées et Dupont, buzzer, batterie,
    raccord de nappe, visserie et aimants de la commande, fiche USB-C (cachée) pour contrôler son passage.
    Une maquette dont le nom commence par celui d'un modèle fait partie de ce module."""
    def box(name, x, y, w, h, z, t, color):
        sk = sketch(comp, plane(comp, z), name)
        rect(sk, x, y, w, h)
        paint(new_body(comp, sk.profiles, t, name), color)

    def cyl(name, x, y, d, z, t, color):
        sk = sketch(comp, plane(comp, z), name)
        circle(sk, x, y, d)
        paint(new_body(comp, sk.profiles, t, name), color)

    # PN532 : circuit percé de ses deux trous, barrette I2C coudée vers le haut et ses Dupont couchés
    # derrière la dalle ; les queues de la barrette dépassent devant
    pn_back = "Z_PLATE - PN_STANDOFF - PN_T"
    sk = sketch(comp, plane(comp, pn_back), "pn532 circuit")
    rect(sk, "PN_X", "PN_Y", "PN_W", "PN_H")
    for x, y in PN_HOLES:
        circle(sk, x, y, "3.05 mm")
    paint(new_body(comp, [p for p in sk.profiles if p.profileLoops.count > 1], "PN_T", "pn532 circuit"),
          "Plastic - Matte (Red)")
    hx, hw = "PN_X + PN_HDR_X - 1.4 mm", "4 * 2.54 mm + 0.3 mm"
    box("pn532 barrette", hx, "PN_Y + PN_HDR_Y - 1.27 mm", hw, "2.54 mm", f"{pn_back} - HDR_BODY", "HDR_BODY",
        "Plastic - Matte (Black)")
    box("pn532 dupont", hx, "PN_Y + PN_HDR_Y + 1.27 mm", hw, "DUPONT_L + WIRE_BEND",
        f"{pn_back} - 1.27 mm - DUPONT_T / 2", "DUPONT_T", "Plastic - Matte (Black)")
    box("pn532 queues", hx, "PN_Y + PN_HDR_Y - 0.5 mm", hw, "1 mm", "Z_PLATE - PN_STANDOFF", "2 mm",
        "Plastic - Matte (Gray)")

    # TTP223 : circuit, barrette coudée au dos, ses soudures côté zone tactile, Dupont vers le centre
    tt_back = "Z_PLATE - TT_PCB"
    for name, kx, side in zip(("touche gauche", "touche droite"), TT_CENTERS, (1, -1)):
        box(f"{name} circuit", f"{kx} - TT_W / 2", "KEY_Y - TT_H / 2", "TT_W", "TT_H", tt_back, "TT_PCB",
            "Plastic - Matte (Red)")
        pin = f"{kx} + TT_W / 2 - 1.19 mm" if side > 0 else f"{kx} - TT_W / 2 + 1.19 mm"
        box(f"{name} barrette", f"{pin} - 1.27 mm", "KEY_Y - 3.9 mm", "2.54 mm", "7.8 mm",
            f"{tt_back} - HDR_BODY", "HDR_BODY", "Plastic - Matte (Black)")
        box(f"{name} soudures", f"{pin} - 1 mm", "KEY_Y - 3.6 mm", "2 mm", "7.2 mm", "Z_PLATE", "0.9 mm",
            "Plastic - Matte (Gray)")
        dx = f"{pin} + 1.27 mm" if side > 0 else f"{pin} - 1.27 mm - DUPONT_L - WIRE_BEND"
        box(f"{name} dupont", dx, "KEY_Y - 3.9 mm", "DUPONT_L + WIRE_BEND", "7.8 mm",
            f"{tt_back} - 1.27 mm - DUPONT_T / 2", "DUPONT_T", "Plastic - Matte (Black)")

    cyl("buzzer", "BUZ_X", "BUZ_Y", "BUZ_D", "Z_PLATE - BUZ_H", "BUZ_H", "Plastic - Matte (Black)")

    # Barrettes mâles 1 x 7 entre la carte driver et le XIAO (rangées à 15,24 mm, pas de 2,54)
    xiao_end = "DB_X + DB_W + XIAO_OVER"
    for i, dy in enumerate(("-7.62 mm", "7.62 mm")):
        box(f"barrette xiao {i + 1}", f"{xiao_end} - 19.43 mm", f"USB_CY + ({dy}) - 1.27 mm", "17.78 mm", "2.54 mm",
            "DB_Z - XIAO_GAP", "XIAO_GAP", "Plastic - Matte (Black)")
    box("raccord nappe", "BOX_W / 2 - 8 mm", "P_Y + P_H - 20 mm", "16 mm", "8 mm", "Z_PANEL_BACK - 3 mm", "3 mm",
        "Plastic - Matte (White)")

    # Surmoulage d'une fiche courante, 12 x 6,5 mm : le passage doit le laisser venir jusqu'à la prise.
    # Sur ce plan, x d'esquisse = -z.
    sk = sketch(comp, plane(comp, f"{xiao_end} + USB_OVER", comp.yZConstructionPlane), "fiche usb-c")
    rrect(sk, "-(USB_Z + 3.25 mm)", "USB_CY - 6 mm", "6.5 mm", "12 mm", "1.5 mm")
    plug = new_body(comp, sk.profiles, "20 mm", "fiche usb-c")
    paint(plug, "Plastic - Matte (Gray)")
    plug.isLightBulbOn = False

    # Visserie de la commande : inserts laiton M2 x 3 (Ø 3,6) et vis M2 x 5 à tête cylindrique (Ø 3,8 x 1,6)
    def insert(name, x, y, z):
        sk = sketch(comp, plane(comp, z), name)
        outer = circle(sk, x, y, "3.6 mm")
        circle(sk, x, y, "2 mm", center=outer.centerSketchPoint)
        paint(new_body(comp, rings(sk), "3 mm", name), "Brass - Polished")

    def screw(name, x, y, z):
        """Tête contre le plan z, côté capot ; tige de 5 mm vers l'avant."""
        sk = sketch(comp, plane(comp, z), name)
        circle(sk, x, y, "3.8 mm")
        head = new_body(comp, sk.profiles, "1.6 mm", name, negative=True)
        sk = sketch(comp, plane(comp, z), f"{name} tige")
        circle(sk, x, y, "2 mm")
        extrude(comp, sk.profiles, "5 mm", JOIN, bodies=[head], name=f"{name} tige")
        paint(head, "Steel - Satin")

    insert("insert pn532", *PN_SCREW_HOLE, "Z_PLATE - PN_STANDOFF")
    screw("vis pn532", *PN_SCREW_HOLE, pn_back)
    for i, (x, y) in enumerate(CORNERS):
        insert(f"insert capot {i + 1}", x, y, "Z_PAD")
        screw(f"vis capot {i + 1}", x, y, "HEAD_DEPTH")

    box("batterie", "BAT_CX - BAT_W / 2", "BAT_CY - BAT_H / 2", "BAT_W", "BAT_H",
        "Z_PANEL_BACK - CH_T - BAT_T", "BAT_T", "Plastic - Matte (Yellow)")
    for i, (x, y) in enumerate(BACK_MAGNETS):
        cyl(f"aimant {i + 1}", x, y, "10 mm", "0 mm", "MAG_T", "Stainless Steel - Polished")  # néodyme nickelé


# ---------------------------------------------------------------- écran, pour les rendus

SCREEN_IMAGE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                            "apps", "mate", "__snapshots__", "stock.png")


def build_ecran(comp):
    """L'accueil de l'OS (instantané 800 x 480 de device/apps/mate) en décalque sur la zone affichée,
    sur une pellicule posée juste devant le verre du modèle de la dalle."""
    sk = sketch(comp, plane(comp, "Z_PLATE - 0.009 mm"), "Écran")
    rect(sk, *AA)
    film = new_body(comp, sk.profiles, "0.005 mm", "écran")
    paint(film, "Plastic - Matte (White)")
    z = ev("Z_PLATE - 0.004 mm")
    center = P3(ev("AA_X + AA_W / 2"), ev("AA_Y + AA_H / 2"), z)
    # Copie temporaire : au rendu, Fusion écrit une version retournée à côté de l'image
    import shutil
    import tempfile
    image = os.path.join(tempfile.gettempdir(), "matecrew-ecran.png")
    shutil.copyfile(SCREEN_IMAGE, image)
    inp = comp.decals.createInput(image, [planar_face(film, 1, z)], center)
    inp.isChainFaces = False
    # La longueur des axes donne la taille du décalque (1 cm pour une longueur de 1)
    m = adsk.core.Matrix3D.create()
    m.setWithCoordinateSystem(center, adsk.core.Vector3D.create(ev("AA_W"), 0, 0),
                              adsk.core.Vector3D.create(0, ev("AA_H"), 0), adsk.core.Vector3D.create(0, 0, 1))
    inp.transform = m
    comp.decals.add(inp).name = "Accueil de l'OS"


# ---------------------------------------------------------------- contrôles

PARTS = ("facade", "cadre", "chassis", "capot", "socle")


def interferences(names):
    """Interférences entre les pièces, les maquettes et les modèles des composants nommés. Les corps
    d'un même composant ou d'un même modèle ne se comparent pas entre eux ; les inserts entrent à
    chaud, en force, par principe ; les simples appuis ne comptent pas."""
    root = _design.rootComponent
    group = {}
    for o in root.allOccurrences:
        path = o.fullPathName.split("+")
        if path[0] == "modeles:1" and len(path) > 1:
            group[o.component.id] = path[1].rsplit(":", 1)[0]
    tops = {f"{n}:1" for n in names}
    bodies = [b for o in root.allOccurrences if o.fullPathName.split("+")[0] in tops for b in o.bRepBodies]

    def module(b):
        c = b.parentComponent
        if c.id in group:
            return group[c.id]
        if c.name == "composants":
            return next((m[0] for m in MODELS if b.name.startswith(m[0] + " ")), b.name)
        return f"{c.id}/{b.name}"  # pièces imprimées : chaque corps est une pièce (cadre, pastilles, pavé)

    def label(b):
        c = b.parentComponent
        return f"{group[c.id]} ({c.name[:24]})" if c.id in group else b.name

    out = []
    for r in _design.analyzeInterference(_design.createInterferenceInput(oc(bodies))):
        a, b = r.entityOne, r.entityTwo
        if module(a) == module(b) or a.name.startswith("insert") or b.name.startswith("insert"):
            continue
        if r.interferenceBody.volume < 5e-6:  # moins de 0,005 mm3 : un appui (tête de vis, verre de l'écran)
            continue
        out.append(f"{label(a)} / {label(b)} : {r.interferenceBody.volume * 1000:.2f} mm3")
    return out


def unhealthy():
    tl = _design.timeline
    ok = adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState
    return [f"{tl.item(i).name} : {tl.item(i).errorOrWarningMessage}"
            for i in range(tl.count) if not tl.item(i).isGroup and tl.item(i).healthState != ok]


def split_parts():
    """Pièces imprimées en plusieurs morceaux : un îlot qui flotte ne se voit pas dans les interférences."""
    root = _design.rootComponent
    out = [f"{b.name} : {b.lumps.count} morceaux" for n in PARTS
           for b in root.occurrences.itemByName(f"{n}:1").component.bRepBodies if b.lumps.count != 1]
    return out + [f"{n} : corps en trop {b.name}" for n in PARTS
                  for b in root.occurrences.itemByName(f"{n}:1").component.bRepBodies
                  if not (b.name == n or (n == "cadre" and b.name in ("pastille gauche", "pastille droite", "pavé nfc")))]


def loose_sketches():
    return [f"{o.component.name} / {s.name}" for o in _design.rootComponent.occurrences
            for s in o.component.sketches if not s.isFullyConstrained]


def volumes():
    """Volume (cm3) et masse en PLA plein (g) de chaque pièce imprimée."""
    root = _design.rootComponent
    out = {}
    for n in PARTS:
        for b in root.occurrences.itemByName(f"{n}:1").component.bRepBodies:
            out[b.name] = f"{b.volume:.1f} cm3, {b.physicalProperties.mass * 1000:.0f} g"
    return out


# ---------------------------------------------------------------- rendu

DEVICE_PARTS = ("facade", "cadre", "chassis", "capot", "composants", "modeles", "ecran")


def pose_on_stand(on=True):
    """Pose le boîtier sur son socle (dos contre le dossier, pied dans le pli), ou le remet à sa place."""
    design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    m = adsk.core.Matrix3D.create()
    if on:
        t = design.unitsManager.evaluateExpression("TILT", "rad")
        s0 = ev("1 mm")
        origin = P3(ev("SOCLE_X + SOCLE_W / 2 - BOX_W / 2"), ev("REST_Y") + s0 * math.sin(t),
                    ev("SOCLE_T") + s0 * math.cos(t))
        m.setWithCoordinateSystem(origin, adsk.core.Vector3D.create(1, 0, 0),
                                  adsk.core.Vector3D.create(0, math.sin(t), math.cos(t)),
                                  adsk.core.Vector3D.create(0, -math.cos(t), math.sin(t)))
    for name in DEVICE_PARTS:
        occ = design.rootComponent.occurrences.itemByName(f"{name}:1")
        if occ:
            occ.transform2 = m


def pose_upright():
    """Pose le boîtier debout sur sa tranche du bas, dos vers +y, à la place du socle (vue de dos)."""
    design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    m = adsk.core.Matrix3D.create()
    m.setWithCoordinateSystem(P3(ev("SOCLE_X + SOCLE_W / 2 - BOX_W / 2"), ev("REST_Y"), 0),
                              adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 0, 1),
                              adsk.core.Vector3D.create(0, -1, 0))
    for name in DEVICE_PARTS:
        occ = design.rootComponent.occurrences.itemByName(f"{name}:1")
        if occ:
            occ.transform2 = m


def render(path, quality=75, width=1600, height=1000, eye=(-220, -420, 160), target_z=78, light=0):
    """Rendu local, vu de trois quarts, ombre au sol. Lancer pose_on_stand() (ou pose_upright() pour
    le dos) avant ; le fichier apparaît quand le rendu est fini (une à quelques minutes)."""
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    rm = design.renderManager
    scene = rm.sceneSettings
    scene.backgroundEnvironment = rm.renderEnvironments.itemByName("Photobooth")  # éclairage
    scene.backgroundSolidColor = adsk.core.Color.create(244, 244, 242, 255)  # fond uni
    scene.lightAngle = math.radians(light)  # 180 : lumière dans le dos du boîtier, pour la vue de dos
    scene.isGroundDisplayed = True
    scene.isGroundFlattened = True
    scene.isGroundReflections = False
    rendering = rm.rendering
    rendering.aspectRatio = adsk.fusion.RenderAspectRatios.CustomRenderAspectRatio
    rendering.resolutionWidth = width
    rendering.resolutionHeight = height
    rendering.renderQuality = quality
    cam = app.activeViewport.camera
    cam.cameraType = adsk.core.CameraTypes.PerspectiveCameraType
    target = P3(ev("SOCLE_X + SOCLE_W / 2"), ev("REST_Y"), ev(f"{target_z} mm"))
    cam.target = target
    cam.eye = P3(target.x + ev(f"{eye[0]} mm"), target.y + ev(f"{eye[1]} mm"), target.z + ev(f"{eye[2]} mm"))
    cam.upVector = adsk.core.Vector3D.create(0, 0, 1)
    cam.perspectiveAngle = math.radians(28)
    return rendering.startLocalRender(path, cam)


# ---------------------------------------------------------------- entrée

def setup(reuse=False):
    """Nouveau document, avec les paramètres utilisateur. reuse : vide plutôt le document actif s'il
    vient de ce script (enregistré dans Fusion, il garde ainsi l'historique de ses versions)."""
    global _design
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    if reuse and design and design.attributes.itemByName(*DESIGN_TAG):
        _design = design
        for occ in list(design.rootComponent.occurrences):
            occ.deleteMe()
        params = design.userParameters
        while params.count:  # un paramètre ne s'efface qu'une fois ceux qui en dépendent effacés
            left = params.count
            for i in reversed(range(params.count)):
                try:
                    params.item(i).deleteMe()
                except RuntimeError:
                    pass
            if params.count == left:
                raise RuntimeError("paramètres impossibles à effacer")
    else:
        app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        _design = adsk.fusion.Design.cast(app.activeProduct)
        _design.designType = adsk.fusion.DesignTypes.ParametricDesignType
        _design.fusionUnitsManager.distanceDisplayUnits = adsk.fusion.DistanceUnits.MillimeterDistanceUnits
        _design.attributes.add(*DESIGN_TAG, "1")
    _planes.clear()
    _fixed.clear()

    # Deux passes : les expressions renvoient à des paramètres définis plus bas
    params = _design.userParameters
    for name, _, comment, *unit in PARAMS:
        params.add(name, VI("1 deg" if unit else "1 mm"), unit[0] if unit else "mm", comment)
    for name, expr, *_ in PARAMS:
        params.itemByName(name).expression = expr


def build_parts(names):
    """Construit les pièces nommées dans le document actif (une par composant)."""
    global _design
    _design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    builders = {"facade": build_facade, "cadre": build_cadre, "chassis": build_chassis,
                "capot": build_capot, "socle": build_socle, "composants": build_composants,
                "modeles": build_modeles, "ecran": build_ecran}
    root = _design.rootComponent
    for name in names:
        occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        occ.component.name = name
        builders[name](occ.component)
    return {"erreurs": unhealthy()}


def build(check=True):
    setup()
    build_parts(["facade", "cadre", "chassis", "capot", "socle", "composants", "modeles", "ecran"])
    adsk.core.Application.get().activeViewport.fit()
    return check_design() if check else {"erreurs": unhealthy(), "volumes cm3": volumes()}


def check_design():
    """Erreurs de la timeline, esquisses pas entièrement contraintes, interférences, volumes."""
    global _design
    _design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    return {
        "erreurs": unhealthy(),
        "esquisses non contraintes": loose_sketches(),
        "pièces en plusieurs morceaux": split_parts(),
        "interferences": interferences(("facade", "cadre", "chassis", "capot", "composants", "modeles", "ecran")),
        "volumes cm3": volumes(),
    }


# Pièces imprimées face avant sur le plateau ; les autres gardent leur dos sur le plateau (capot : face
# extérieure ; socle : semelle ; pièces noires : collerette dessous, face visible en dernière couche).
PRINT_FLIP = ("facade", "chassis")


def flip_stl(path):
    """Retourne un STL binaire autour de x (face avant sur le plateau) et le pose en z = 0."""
    import struct
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 80)[0]
    tris = [list(struct.unpack_from("<12fH", data, 84 + 50 * i)) for i in range(n)]
    for t in tris:
        for k in range(0, 12, 3):
            t[k + 1], t[k + 2] = -t[k + 1], -t[k + 2]
    lo = [min(t[k + a] for t in tris for k in range(3, 12, 3)) for a in range(3)]
    out = bytearray(data[:84])
    for t in tris:
        for k in range(3, 12, 3):
            for a in range(3):
                t[k + a] -= lo[a]
        out += struct.pack("<12fH", *t)
    with open(path, "wb") as f:
        f.write(out)


def export(out_dir):
    """Écrit dans out_dir les STL des pièces dans leur sens d'impression, boitier-matecrew.step et
    boitier-matecrew.f3d. À lancer avant build_parts(["modeles"]) : les modèles des fabricants restent
    dans ../modeles et ne sont pas recopiés."""
    design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    em = design.exportManager
    root = design.rootComponent
    written = []
    for name in PARTS:
        for body in root.occurrences.itemByName(f"{name}:1").component.bRepBodies:
            path = os.path.join(out_dir, f"{body.name.replace(' ', '-')}.stl")
            opts = em.createSTLExportOptions(body, path)
            opts.isBinaryFormat = True
            opts.meshRefinement = adsk.fusion.MeshRefinementSettings.MeshRefinementHigh
            em.execute(opts)
            if name in PRINT_FLIP:
                flip_stl(path)
            written.append(path)
    for opts in (em.createSTEPExportOptions(os.path.join(out_dir, "boitier-matecrew.step"), root),
                 em.createFusionArchiveExportOptions(os.path.join(out_dir, "boitier-matecrew.f3d"), root)):
        em.execute(opts)
        written.append(opts.filename)
    return written


def run(_context):
    build()
