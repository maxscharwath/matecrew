/** `dui build [app...]`: compile apps from device.config.ts and write their bytecode. */
import { relative } from "node:path";
import { writeIfChanged } from "../compiler";
import { appNames, compileApp, loadProject, type Artifact, type Output } from "./project";

export async function build(args: string[]): Promise<void> {
  const project = await loadProject();
  // Every app compiles before anything is written, so a failure never leaves a partial build.
  const results = await Promise.all(appNames(project, args).map((name) => compileApp(project, name)));
  const artifacts: Artifact[] = results.flatMap((result) => result.artifacts);
  const outputs: Output[] = results.flatMap((result) => result.outputs);
  await Promise.all(outputs.map((output) => writeIfChanged(output.path, output.data)));
  report(project.root, artifacts);
}

export function report(root: string, artifacts: Artifact[]): void {
  const rows = artifacts.map((artifact) => [
    artifact.screen ? `${artifact.app}/${artifact.screen}` : artifact.app,
    `${artifact.bytes.length} B`,
    `${artifact.raw} B raw`,
    `${artifact.nodes} nodes`,
    relative(root, artifact.paths[0]),
  ]);
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  // Sizes align right, the path (last column) runs free, the rest align left.
  const pad = (cell: string, column: number, last: boolean) => {
    if (column >= 1 && column <= 3) return cell.padStart(widths![column]);
    return last ? cell : cell.padEnd(widths![column]);
  };
  for (const row of rows)
    console.log(row.map((cell, column) => pad(cell, column, column === row.length - 1)).join("  "));
  const total = artifacts.reduce((sum, artifact) => sum + artifact.bytes.length, 0);
  const raw = artifacts.reduce((sum, artifact) => sum + artifact.raw, 0);
  console.log(`${artifacts.length} scenes, ${total} bytes (${raw} uncompressed, -${Math.round((1 - total / raw) * 100)} %)`);
}
