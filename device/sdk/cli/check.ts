/** `dui check`: compile in memory and fail if committed bytecode or generated sources are stale. */
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { appNames, compileApp, loadProject, type Output } from "./project";

export async function check(args: string[]): Promise<void> {
  const project = await loadProject();
  const results = await Promise.all(appNames(project, args).map((name) => compileApp(project, name)));
  const outputs = results.flatMap((result) => result.outputs);
  const current = await Promise.all(outputs.map(upToDate));
  const stale = outputs
    .filter((_, i) => !current[i])
    .map((output) => relative(project.root, output.path));
  if (stale.length) {
    console.error(`Out of date (run \`dui build\`):\n  ${stale.join("\n  ")}`);
    process.exitCode = 1;
  } else console.log(`${outputs.length} generated files up to date`);
}

/** Whether the file on disk holds exactly the output's bytes. */
async function upToDate(output: Output): Promise<boolean> {
  const expected =
    typeof output.data === "string"
      ? Buffer.from(output.data, "utf8")
      : Buffer.from(output.data);
  const actual = await readFile(output.path).catch(() => null);
  return actual?.equals(expected) ?? false;
}
