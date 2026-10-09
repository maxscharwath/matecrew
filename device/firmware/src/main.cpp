#include <Arduino.h>
#include <SPI.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSans12pt7b.h>

// ePaper Driver Board for XIAO: RST D0, CS D1, BUSY D2, DC D3, SCK D8, MOSI D10.
// MISO is left out on purpose: D9 is reserved for the right touch key.
static const int PIN_EPD_RST = D0;
static const int PIN_EPD_CS = D1;
static const int PIN_EPD_BUSY = D2;
static const int PIN_EPD_DC = D3;

GxEPD2_BW<GxEPD2_750_T7, GxEPD2_750_T7::HEIGHT> display(
    GxEPD2_750_T7(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

// Key centres on the 800 px wide panel, from the enclosure model.
static const int KEY_LEFT_X = 130;
static const int KEY_RIGHT_X = 670;

static void drawCentered(const char *text, int cx, int baseline) {
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(text, 0, 0, &x1, &y1, &w, &h);
  display.setCursor(cx - (int)w / 2 - x1, baseline);
  display.print(text);
}

static void drawTestScreen() {
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);

    display.setFont(&FreeSansBold24pt7b);
    display.setCursor(30, 60);
    display.print("matecrew");
    display.fillRect(30, 80, 740, 3, GxEPD_BLACK);

    display.setFont(&FreeSans12pt7b);
    display.setCursor(30, 140);
    display.print("Banc d'essai : XIAO ESP32-S3 + ecran 7,5\"");
    display.setCursor(30, 180);
    display.printf("%d x %d px", display.width(), display.height());

    display.fillRect(30, 400, 740, 2, GxEPD_BLACK);
    display.setFont(&FreeSansBold12pt7b);
    drawCentered("Prendre un mate", KEY_LEFT_X, 440);
    drawCentered("Rendre un mate", KEY_RIGHT_X, 440);
    display.fillTriangle(KEY_LEFT_X - 8, 452, KEY_LEFT_X + 8, 452, KEY_LEFT_X, 462, GxEPD_BLACK);
    display.fillTriangle(KEY_RIGHT_X - 8, 452, KEY_RIGHT_X + 8, 452, KEY_RIGHT_X, 462, GxEPD_BLACK);
  } while (display.nextPage());
}

void setup() {
  Serial.begin(115200);
  delay(3000);
  Serial.println("matecrew device: display test");

  SPI.begin(SCK, -1, MOSI, PIN_EPD_CS);
  display.init(115200, true, 2, false);

  uint32_t start = millis();
  drawTestScreen();
  Serial.printf("full refresh: %lu ms\n", (unsigned long)(millis() - start));

  display.hibernate();
  Serial.println("display hibernated");
}

void loop() {
  delay(1000);
}
