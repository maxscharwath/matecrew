/** `dui build [app...]`: compile apps from device.config.ts and write their bytecode. */
import { relative } from "node:path";
import { writeIfChanged } from "../compiler";
import { appNames, compileApp, loadProject, type Artifact, type Output } from "./project";

export async function build(args: string[]): Promise<void> {
  const project = await loadProject();
  const artifacts: Artifact[] = [];
  const outputs: Output[] = [];
  for (const name of appNames(project, args)) {
    const result = await compileApp(project, name);
    artifacts.push(...result.artifacts);
    outputs.push(...result.outputs);
  }
  for (const output of outputs) await writeIfChanged(output.path, output.data);
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
  for (const row of rows)
    console.log(
      row
        .map((cell, column) =>
          column >= 1 && column <= 3
            ? cell.padStart(widths![column])
            : column === row.length - 1
              ? cell
              : cell.padEnd(widths![column]),
        )
        .join("  "),
    );
  const total = artifacts.reduce((sum, artifact) => sum + artifact.bytes.length, 0);
  const raw = artifacts.reduce((sum, artifact) => sum + artifact.raw, 0);
  console.log(`${artifacts.length} scenes, ${total} bytes (${raw} uncompressed, -${Math.round((1 - total / raw) * 100)} %)`);
}
