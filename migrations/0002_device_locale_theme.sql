-- A terminal's own language and screen theme, set from its console's settings; null follows the
-- office's language and the site's default theme.
ALTER TABLE "Device" ADD COLUMN "locale" TEXT;
ALTER TABLE "Device" ADD COLUMN "theme" TEXT;
