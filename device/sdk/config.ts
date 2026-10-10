/** `device.config.ts`: the apps a project builds, and where their bytecode goes. Paths are relative to the config file. */
export type AppConfig = {
  /** TSX/TS module. A routed app exports its root component as `default`. */
  entry: string;
  /** Compile every named export as its own screen into `out/<name>.dui` (the host picks one per state). */
  screens?: boolean;
  /** Output `.dui` file, or a directory for `screens` apps. Several paths write identical copies. */
  out: string | string[];
  /** For `screens` apps: a generated Rust registry that `include_bytes!` each screen. */
  rust?: string;
  /** Module exporting `previews` (see `definePreviews`), or a JSON object of previews. Defaults to one per scene. */
  previews?: string;
};
export type DeviceConfig = { apps: Record<string, AppConfig> };

export function defineConfig(config: DeviceConfig): DeviceConfig {
  return config;
}
