/** `dui check`: compile in memory and fail if committed bytecode or generated sources are stale. */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { appNames, compileApp, loadProject } from "./project";

export async function check(args: string[]): Promise<void> {
  const project = await loadProject();
  const stale: string[] = [];
  let count = 0;
  for (const name of appNames(project, args)) {
    for (const output of (await compileApp(project, name)).outputs) {
      count++;
      const expected =
        typeof output.data === "string"
          ? Buffer.from(output.data, "utf8")
          : Buffer.from(output.data);
      const actual = await readFile(output.path).catch(() => null);
      if (!actual?.equals(expected)) stale.push(relative(project.root, output.path));
    }
  }
  if (stale.length) {
    console.error(`Out of date (run \`dui build\`):\n  ${stale.join("\n  ")}`);
    process.exitCode = 1;
  } else console.log(`${count} generated files up to date`);
}
