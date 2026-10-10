/** Board emulation shared by `dui dev` and the site's virtual terminal. */
export { VirtualGpio } from "./gpio";
export { VirtualBuzzer } from "./buzzer";
export { decorate } from "./status";
export {
  EmulatedBoard,
  changed,
  BUZZER_PIN,
  KEY_PINS,
  KEY_POLL_MS,
  REFRESH_MS,
  NFC,
  type BoardHost,
  type LogEntry,
  type Refresh,
} from "./board";

export { flipped, refreshPasses, worn, NEW_SCREEN_PERCENT, GHOST_PERCENT } from "./refresh";
