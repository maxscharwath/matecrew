#!/usr/bin/env bash
# Flashes the last debug build with this project's partition table (two app
# slots, see partitions.csv) and its own bootloader: espflash's bundled one
# cannot roll a failed update back. Extra arguments go to espflash, for
# instance --monitor, or --before no-reset when esptool already put the chip
# in download mode.
set -euo pipefail
cd "$(dirname "$0")"
target=$(cargo metadata --format-version 1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')/xtensa-esp32s3-espidf/debug
bootloader=$(ls -t "$target"/build/esp-idf-sys-*/out/build/bootloader/bootloader.bin | head -1)
exec espflash flash --partition-table partitions.csv --bootloader "$bootloader" "$@" "$target/matecrew-device"
