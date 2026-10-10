/** `dui bundle <app>` (internal): compile one app and its previews to JSON on stdout. `dui dev` runs it in a fresh process per change, so edited modules are never cached. */
import { appNames, compileApp, loadProject } from "./project";
import { loadPreviews } from "./previews";

export type Bundle = {
  app: string;
  screens: boolean;
  artifacts: { screen?: string; bytes: string; size: number; nodes: number }[];
  previews: Awaited<ReturnType<typeof loadPreviews>>;
};

export async function bundle(args: string[]): Promise<void> {
  const project = await loadProject();
  const [app] = appNames(project, args.slice(0, 1));
  const { artifacts } = await compileApp(project, app);
  const result: Bundle = {
    app,
    screens: !!project.config.apps[app].screens,
    artifacts: artifacts.map(({ screen, bytes, nodes }) => ({
      screen,
      bytes: Buffer.from(bytes).toString("base64"),
      size: bytes.length,
      nodes,
    })),
    previews: await loadPreviews(project, app, artifacts),
  };
  process.stdout.write(JSON.stringify(result));
}
