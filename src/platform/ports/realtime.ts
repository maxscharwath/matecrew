import type { CommandStatus, Presence } from "../../../realtime/src/protocol";
import type { DeviceCommand } from "@/lib/device/contract";

/**
 * The terminals' live channel (realtime/, a Durable Object per terminal): each terminal keeps
 * one WebSocket open and the consoles open theirs, so a command, a screen or "what you show
 * changed" goes at once instead of being polled for.
 *
 * Optional: a platform without it answers null everywhere, and terminals and consoles fall back
 * to the site's polling API (`/api/device/commands?wait=`, `/live`, `/frame`).
 */
export interface TerminalRelay {
  /** Where a terminal opens its socket, given in its state; null without a relay. */
  terminalUrl(): string | null;
  /** Where a console opens its socket for `userId`, with its one-time ticket; null without a relay. */
  console(deviceId: string, userId: string): Promise<{ url: string; ticket: string } | null>;
  /** Hands `command` to the terminal (now, or when it connects); null without a relay. */
  command(deviceId: string, command: DeviceCommand, by: string | null): Promise<CommandStatus | null>;
  /** What these terminals show changed at `at` (ms since 1970): the connected ones sync now. */
  changed(deviceIds: readonly string[], at: number): Promise<void>;
  /** Whether each terminal is connected, and its last status; null without a relay. */
  presence(deviceIds: readonly string[]): Promise<Map<string, Presence> | null>;
  /** Its last screen (packed 1 bit, 800 × 480) and when; undefined without a relay. */
  screen(deviceId: string): Promise<{ bits: Uint8Array; drawnAt: number } | null | undefined>;
}

/** For platforms without a relay. */
export const noRelay: TerminalRelay = {
  terminalUrl: () => null,
  console: async () => null,
  command: async () => null,
  changed: async () => undefined,
  presence: async () => null,
  screen: async () => undefined,
};
