/** Compile every screen before writing output, so a failed screen cannot leave a partial build. */
import { compileScreen } from "../device/authoring/jsx-runtime.ts";
import { encodeScene } from "../device/authoring/binary.ts";
import {
  rustScreenManifest,
  writeIfChanged,
} from "../device/authoring/build.ts";
import * as screens from "../device/apps/mate/index.ts";

const compiled = Object.entries(screens).map(([name, screen]) => {
  try {
    return { name, bytes: encodeScene(compileScreen(screen)) };
  } catch (error) {
    throw new Error(
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
});
for (const { name, bytes } of compiled) {
  await writeIfChanged(`device/screens/compiled/${name}.dui`, bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
await writeIfChanged(
  "device/ui/src/screens.rs",
  rustScreenManifest(compiled.map((screen) => screen.name)),
);
console.log(
  `Terminal screens: ${compiled.reduce((total, screen) => total + screen.bytes.length, 0)} bytes (binary, no JSON layouts)`,
);
