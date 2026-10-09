// Boîtier e-ink matécrew — modèle paramétrique (OpenSCAD 2021+)
// Unités : mm.
// Repère : x vers la droite et y vers le haut vus de face ; z = 0 sur la face
// extérieure du capot (dos), z = D sur la face avant.
//
// Pièces à exporter (variable part) :
//   "facade"  façade + parois, posée face avant sur le plateau
//   "capot"   capot arrière, face extérieure sur le plateau
//   "socle"   socle de bureau incliné à 15°
//   "assemblage", "ouvert"  vues de contrôle avec les composants
part = "assemblage";

/* [Boîtier] */
W = 200;              // largeur extérieure
H = 165;              // hauteur extérieure
D = 15;               // épaisseur (support femelle de la carte driver retiré, XIAO soudé dessus)
R = 8;                // rayon des coins
CH = 1.0;             // chanfrein de l'arête avant
T_WALL = 2.4;         // parois latérales
T_FRONT = 2.0;        // façade (devant le lecteur NFC et les zones tactiles)
T_COVER = 2.0;        // capot
LIP = 1.2;            // lèvre extérieure autour du capot
GAP = 0.15;           // jeu capot / feuillure
PAD = 1.2;            // plots des aimants sous le capot
Z_PLATE = D - T_FRONT;    // face intérieure de la façade
Z_PAD = T_COVER + PAD;    // dessus des plots du capot

/* [Dalle e-ink 7,5" 800 x 480 (fiche Waveshare 7.5inch e-Paper V2)] */
// Montée nappe en haut : la bordure large (9,78 mm) est en haut, l'étroite (3,5 mm) en bas.
P_W = 170.2;  P_H = 111.2;  P_T = 1.18;
P_X = (W - P_W) / 2;
P_Y = 45;                         // bas de la dalle
AA_W = 163.2;  AA_H = 97.92;      // zone affichée
AA_X = P_X + 3.5;
AA_Y = P_Y + 3.5;
CLR = 0.25;                       // jeu autour de la dalle
WIN_CH = 0.8;                     // chanfrein de la fenêtre
Z_PANEL_BACK = Z_PLATE - P_T;

/* [Lecteur NFC PN532 V3, 43 x 40 mm] */
PN_W = 43;  PN_H = 40;  PN_T = 3.5;
PN_X = W / 2 - PN_W / 2;  PN_Y = 3.2;
PN_STANDOFF = 5;                  // hauteur des plots à inserts
PN_HOLE_INSET = 3.0;              // À VÉRIFIER sur le module reçu
PN_C = [PN_X + PN_W / 2, PN_Y + PN_H / 2];

/* [Touches tactiles TTP223, 15 x 10 mm] */
TT_W = 15;  TT_H = 10;  TT_T = 2.5;
KEY_Y = 36;                       // juste sous l'écran
KEY_L = [45, KEY_Y];              // action gauche
KEY_R = [W - 45, KEY_Y];          // action droite

/* [Buzzer piézo passif Ø 16 x 4 mm] */
BUZ_C = [25, 22];
BUZ_D = 16;

/* [Carte driver + XIAO ESP32-S3 — dimensions À MESURER à réception] */
// La carte est plaquée contre le dos de la dalle, XIAO tourné vers le capot,
// prise USB-C contre la paroi du haut. Le XIAO est soudé sur la carte avec
// l'entretoise de ses barrettes (2,5 mm) : place pour les fils sous le XIAO.
DB_W = 45;  DB_H = 32;  DB_T = 1.6;
DB_X = W / 2 - DB_W / 2;
DB_Y = H - T_WALL - 0.6 - DB_H;
DB_Z = Z_PANEL_BACK - 0.05 - DB_T;   // face composants de la carte
XIAO_W = 17.8;  XIAO_H = 21;  XIAO_T = 1.2;  USB_T = 3.2;  XIAO_GAP = 2.5;
USB_X = W / 2;
USB_Z = DB_Z - XIAO_GAP - XIAO_T - USB_T / 2;   // centre de la prise USB-C
USB_W = 9.8;  USB_H = 3.8;

// Pas d'interrupteur : arrêt et redémarrage par appui long sur les deux touches,
// dernier recours par le bouton R du XIAO, capot ouvert.

/* [Batterie LiPo 2000 mAh 503290, 90 x 32 x 4,8 mm] */
BAT_W = 90;  BAT_H = 32;  BAT_T = 4.8;
BAT_C = [W / 2, 97];

/* [Aimants néodyme 10 x 1,6 mm] */
MAG_D = 10.3;  MAG_T = 1.6;  MAG_DEPTH = 1.8;
BOSS = 14.5;                      // côté des plots d'angle
MAG_OFF = 8.45;                   // centre de l'aimant depuis l'angle extérieur
MAG_POS = [[MAG_OFF, MAG_OFF], [W - MAG_OFF, MAG_OFF],
           [MAG_OFF, H - MAG_OFF], [W - MAG_OFF, H - MAG_OFF]];

/* [Inserts laiton M2 x 3 mm (Ø 3,6)] */
INS_HOLE = 3.2;
BOSS_D = 6.0;

$fn = 64;
EPS = 0.01;

// ---------------------------------------------------------------- 2D
module rr(w, h, r) { offset(r = r) offset(delta = -r) square([w, h]); }
module rr_c(w, h, r) { translate([-w / 2, -h / 2]) rr(w, h, r); }
module outline(o = 0) { translate([o, o]) rr(W - 2 * o, H - 2 * o, max(R - o, 0.5)); }
module ring(d, w) { difference() { circle(d = d); circle(d = d - 2 * w); } }
module arc(r, w, a = 48) {
  L = 3 * (r + w);
  intersection() {
    ring(2 * r + w, w);
    polygon([[0, 0], [L * cos(-a), L * sin(-a)], [1.5 * L, 0], [L * cos(a), L * sin(a)]]);
  }
}
module contactless() {        // symbole sans contact : 3 ondes vers la droite
  translate([-7, 0]) { for (r = [4, 7.5, 11]) arc(r, 1.0); circle(d = 2.2); }
}

// ---------------------------------------------------------------- façade
module shell_outer() {
  hull() {
    translate([0, 0, 0.6]) linear_extrude(D - CH - 0.6) outline(0);
    linear_extrude(EPS) outline(0.6);
    translate([0, 0, D - EPS]) linear_extrude(EPS) outline(CH);
  }
}

module corner_bosses() {
  intersection() {
    translate([0, 0, Z_PAD]) linear_extrude(Z_PLATE - Z_PAD + EPS) outline(0);
    union() for (p = MAG_POS)
      translate([p[0] < W / 2 ? 0 : W - BOSS, p[1] < H / 2 ? 0 : H - BOSS, 0]) cube([BOSS, BOSS, D]);
  }
}

module panel_ribs() {
  x0 = P_X - CLR;  y0 = P_Y - CLR;  w = P_W + 2 * CLR;  h = P_H + 2 * CLR;  rw = 1.0;
  translate([0, 0, Z_PLATE - 1.6]) linear_extrude(1.6 + EPS) {
    translate([x0 - rw, y0 - rw]) square([w + 2 * rw, rw]);      // bas
    translate([x0 - rw, y0 - rw]) square([rw, h + 2 * rw]);      // gauche
    translate([x0 + w, y0 - rw]) square([rw, h + 2 * rw]);       // droite
    translate([x0 - rw, y0 + h]) square([30, rw]);               // haut, côtés seulement :
    translate([x0 + w + rw - 30, y0 + h]) square([30, rw]);      // la nappe passe au milieu
  }
}

function pn_holes() = [for (i = [0, 1], j = [0, 1])
  [PN_X + PN_HOLE_INSET + i * (PN_W - 2 * PN_HOLE_INSET), PN_Y + PN_HOLE_INSET + j * (PN_H - 2 * PN_HOLE_INSET)]];

module pn_bosses() {
  for (p = pn_holes()) translate([p[0], p[1], Z_PLATE - PN_STANDOFF]) cylinder(d = BOSS_D, h = PN_STANDOFF + EPS);
}
module pn_holes_cut() {
  for (p = pn_holes()) translate([p[0], p[1], Z_PLATE - PN_STANDOFF - 1]) cylinder(d = INS_HOLE, h = PN_STANDOFF + 1 - EPS);
}

module tt_frame(c) {
  translate([c[0], c[1], Z_PLATE - 1.2]) linear_extrude(1.2 + EPS)
    difference() { rr_c(TT_W + 0.4 + 1.6, TT_H + 0.4 + 1.6, 0.8); rr_c(TT_W + 0.4, TT_H + 0.4, 0.2); }
}

module buzzer_ring() {
  translate([BUZ_C[0], BUZ_C[1], Z_PLATE - 1.5]) linear_extrude(1.5 + EPS) ring(BUZ_D + 0.4 + 2, 1);
}

module window_cut() {
  translate([AA_X, AA_Y, Z_PLATE - 1]) cube([AA_W, AA_H, T_FRONT + 2]);
  hull() {
    translate([AA_X, AA_Y, D - WIN_CH]) cube([AA_W, AA_H, EPS]);
    translate([AA_X - WIN_CH, AA_Y - WIN_CH, D]) cube([AA_W + 2 * WIN_CH, AA_H + 2 * WIN_CH, 1]);
  }
}

module engravings() {
  translate([0, 0, D - 0.5]) linear_extrude(1) {
    translate(PN_C) difference() { rr_c(46, 34, 6); rr_c(44.4, 32.4, 5.2); }   // zone badge
    translate(PN_C) contactless();
    translate(KEY_L) ring(16, 0.8);                                           // touches
    translate(KEY_R) ring(16, 0.8);
  }
}

module top_wall_slot(x, z, w, h) {
  translate([x, H - T_WALL - 1, z]) rotate([-90, 0, 0]) linear_extrude(T_WALL + 2) rr_c(w, h, min(w, h) / 2 - 0.1);
}

module finger_notch() {     // encoche d'ouverture du capot, tranche du bas
  translate([W / 2 - 9, -1.1, -1]) cube([18, LIP + 1.2, 1 + T_COVER - 0.4]);
}

module magnet_pockets_shell() {
  for (p = MAG_POS) translate([p[0], p[1], Z_PAD - EPS]) cylinder(d = MAG_D, h = MAG_DEPTH);
}

module facade() {
  difference() {
    union() {
      difference() {
        shell_outer();
        translate([0, 0, -1]) linear_extrude(Z_PLATE + 1) outline(T_WALL);   // cavité
        translate([0, 0, -1]) linear_extrude(T_COVER + 1) outline(LIP);      // feuillure du capot
      }
      corner_bosses();
      panel_ribs();
      pn_bosses();
      tt_frame(KEY_L);
      tt_frame(KEY_R);
      buzzer_ring();
    }
    window_cut();
    engravings();
    top_wall_slot(USB_X, USB_Z, USB_W, USB_H);          // USB-C, seule ouverture de la tranche
    finger_notch();
    magnet_pockets_shell();
    pn_holes_cut();
  }
}

// ---------------------------------------------------------------- capot
module keyhole() {
  circle(d = 7.5);
  translate([-1.8, 0]) square([3.6, 7]);
  translate([0, 7]) circle(d = 3.6);
}

// Équerres qui plaquent la carte driver contre la dalle et la centrent
module db_cradle() {
  c = 0.3;  leg = 5;  t = 1.2;
  x0 = DB_X - c;  y0 = DB_Y - c;  x1 = DB_X + DB_W + c;  y1 = DB_Y + DB_H + c;
  for (sx = [0, 1], sy = [0, 1]) {
    // appui 4 x 4 sous l'angle de la carte, jusqu'à sa face composants
    translate([sx ? x1 - 4 : x0, sy ? y1 - 4 : y0, T_COVER - EPS]) cube([4, 4, DB_Z - T_COVER + EPS]);
    // retour d'équerre qui la tient en place, sans toucher la dalle
    translate([0, 0, T_COVER - EPS]) linear_extrude(Z_PANEL_BACK - 0.3 - T_COVER + EPS) {
      translate([sx ? x1 - leg : x0 - t, sy ? y1 : y0 - t]) square([leg + t, t]);
      translate([sx ? x1 : x0 - t, sy ? y1 - leg : y0 - t]) square([t, leg + t]);
    }
  }
}

module capot() {
  difference() {
    union() {
      linear_extrude(T_COVER) outline(LIP + GAP);
      intersection() {                                   // plots des aimants
        for (p = MAG_POS) translate([p[0], p[1], T_COVER - EPS]) cylinder(d = 13, h = PAD + EPS);
        linear_extrude(D) outline(T_WALL + 0.2);
      }
      intersection() {                                   // berceau de la carte driver
        db_cradle();
        linear_extrude(D) outline(T_WALL + 0.2);
      }
      translate([BAT_C[0], BAT_C[1], T_COVER - EPS]) linear_extrude(1.5 + EPS)   // cadre de la batterie
        difference() { rr_c(BAT_W + 1 + 2, BAT_H + 1 + 2, 2); rr_c(BAT_W + 1, BAT_H + 1, 1); }
    }
    for (p = MAG_POS) translate([p[0], p[1], Z_PAD - MAG_DEPTH]) cylinder(d = MAG_D, h = MAG_DEPTH + 1);
    for (dx = [-50, 50]) translate([W / 2 + dx, H - 40, -1]) linear_extrude(T_COVER + 2) keyhole();   // fixation murale
  }
}

// ---------------------------------------------------------------- socle
SOCLE_W = 150;  SOCLE_D = 60;  SOCLE_H = 18;  TILT = 15;
module socle() {
  difference() {
    hull() {
      linear_extrude(SOCLE_H - 2) rr(SOCLE_W, SOCLE_D, 6);
      translate([2, 2, SOCLE_H - 2]) linear_extrude(2) rr(SOCLE_W - 4, SOCLE_D - 4, 4);
    }
    translate([-1, 14, 4]) rotate([-TILT, 0, 0]) cube([SOCLE_W + 2, D + 0.6, 60]);
    // lèvre avant basse (5 mm) : la zone badge reste dégagée
    translate([-1, 14, 4]) rotate([-TILT, 0, 0]) translate([0, -40, 5]) cube([SOCLE_W + 2, 40, 60]);
  }
}

// ---------------------------------------------------------------- composants (contrôle)
module panel() {
  color("#d9d6cc") translate([P_X, P_Y, Z_PANEL_BACK]) cube([P_W, P_H, P_T]);
  color("#f4f2ec") translate([AA_X, AA_Y, Z_PLATE - EPS]) cube([AA_W, AA_H, 0.05]);
}
module pn532() {
  color("#b3262d") translate([PN_X, PN_Y, Z_PLATE - PN_STANDOFF - 1.6]) cube([PN_W, PN_H, 1.6]);
  color("#222") translate([PN_X + PN_W - 14, PN_C[1] - 4, Z_PLATE - PN_STANDOFF - 1.6 - 1]) cube([7, 7, 1]);
}
module ttp223(c) { color("#c0392b") translate([c[0] - TT_W / 2, c[1] - TT_H / 2, Z_PLATE - TT_T]) cube([TT_W, TT_H, TT_T]); }
module buzzer() { color("#1b1b1b") translate([BUZ_C[0], BUZ_C[1], Z_PLATE - 4]) cylinder(d = BUZ_D, h = 4); }
module driver_xiao() {
  color("#1f6f5c") translate([DB_X, DB_Y, DB_Z]) cube([DB_W, DB_H, DB_T]);
  color("#2d4fa8") translate([W / 2 - XIAO_W / 2, H - T_WALL - 0.3 - XIAO_H, DB_Z - XIAO_GAP - XIAO_T]) cube([XIAO_W, XIAO_H, XIAO_T]);
  color("#b8b8b8") translate([W / 2 - 4.5, H - T_WALL - 0.3 - 7.4 + 0.6, USB_Z - USB_T / 2]) cube([9, 7.4, USB_T]);
}
module battery() { color("#8a8f98") translate([BAT_C[0] - BAT_W / 2, BAT_C[1] - BAT_H / 2, T_COVER + 0.2]) cube([BAT_W, BAT_H, BAT_T]); }
module shell_magnets() { color("#9aa3ad") for (p = MAG_POS) translate([p[0], p[1], Z_PAD]) cylinder(d = 10, h = MAG_T); }
module cover_magnets() { color("#9aa3ad") for (p = MAG_POS) translate([p[0], p[1], Z_PAD - MAG_T]) cylinder(d = 10, h = MAG_T); }
// Composants fixés à la façade / portés par le capot
module comp_facade() { panel(); pn532(); ttp223(KEY_L); ttp223(KEY_R); buzzer(); driver_xiao(); shell_magnets(); }
module comp_capot() { battery(); cover_magnets(); }

// Écran d'illustration (rendu seulement) : stock et libellés des deux touches
module screen_mock() {
  color("#1d1d1f") translate([0, 0, D - 0.02]) linear_extrude(0.03) {
    translate([AA_X + 8, AA_Y + AA_H - 16]) text("matécrew", size = 7, font = "DejaVu Sans:style=Bold");
    translate([AA_X + AA_W - 8, AA_Y + AA_H - 16]) text("08.10", size = 5, font = "DejaVu Sans", halign = "right");
    translate([AA_X + 8, AA_Y + AA_H - 22]) square([AA_W - 16, 0.5]);
    translate([AA_X + 8, AA_Y + 42]) text("24", size = 26, font = "DejaVu Sans:style=Bold");
    translate([AA_X + 52, AA_Y + 46]) text("matés en stock", size = 6, font = "DejaVu Sans");
    translate([AA_X + 8, AA_Y + 20]) square([AA_W - 16, 0.4]);
    translate([KEY_L[0], AA_Y + 8]) text("Prendre un maté", size = 4.6, font = "DejaVu Sans:style=Bold", halign = "center");
    translate([KEY_R[0], AA_Y + 8]) text("Rendre un maté", size = 4.6, font = "DejaVu Sans:style=Bold", halign = "center");
    for (k = [KEY_L, KEY_R]) translate([k[0], AA_Y + 3.5]) polygon([[-2.5, 1.8], [2.5, 1.8], [0, -0.8]]);
  }
}

// ---------------------------------------------------------------- sortie
SHELL_COLOR = "#2f3237";
module print_facade() { translate([0, H, D]) rotate([180, 0, 0]) facade(); }   // face avant sur le plateau

if (part == "facade") print_facade();
else if (part == "capot") capot();
else if (part == "socle") socle();
else if (part == "assemblage") {
  color(SHELL_COLOR) facade();
  color("#3a3d43") capot();
  panel();
  screen_mock();
}
else if (part == "ouvert") {               // façade retournée à gauche, capot à droite
  translate([-20, 0, D]) rotate([0, 180, 0]) { color(SHELL_COLOR) facade(); comp_facade(); }
  color("#3a3d43") capot();
  comp_capot();
}
