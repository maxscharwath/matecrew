-- The sounds a terminal plays, set from its console's settings, comma-separated: the boot melody
-- (also when a key wakes it from deep sleep), keys, badges and takes, errors, notifications.
ALTER TABLE "Device" ADD COLUMN "sounds" TEXT NOT NULL DEFAULT 'boot,key,badge,error,notification';
