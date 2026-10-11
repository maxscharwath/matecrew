-- A terminal's office hours, set from its console's settings: inside them it sleeps between uses
-- with the stock on its screen, outside them it shows its night screen until it opens. Local
-- times ("HH:MM", office timezone) on the days listed (0 = Sunday ... 6 = Saturday).
ALTER TABLE "Device" ADD COLUMN "openFrom" TEXT NOT NULL DEFAULT '07:30';
ALTER TABLE "Device" ADD COLUMN "openUntil" TEXT NOT NULL DEFAULT '19:00';
ALTER TABLE "Device" ADD COLUMN "openDays" TEXT NOT NULL DEFAULT '1,2,3,4,5';
