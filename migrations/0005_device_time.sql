-- How a terminal shows the time, set from its console's settings: "24" (14:05) or "12" (2:05 PM),
-- and its own time zone for the times it shows and its office hours (null: its office's).
ALTER TABLE "Device" ADD COLUMN "timeFormat" TEXT NOT NULL DEFAULT '24';
ALTER TABLE "Device" ADD COLUMN "timezone" TEXT;
-- The date beside the clock on its main screens.
ALTER TABLE "Device" ADD COLUMN "showDate" BOOLEAN NOT NULL DEFAULT true;
