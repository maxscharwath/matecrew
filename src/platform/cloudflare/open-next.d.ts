/**
 * The modules `opennextjs-cloudflare build` generates in .open-next, as the
 * worker entry (./worker.ts) uses them. wrangler.jsonc `alias` maps these
 * names to the generated files when it bundles the Worker.
 */
declare module "#open-next/worker" {
  const worker: { fetch: ExportedHandlerFetchHandler<CloudflareEnv> };
  export default worker;
}

declare module "#open-next/init" {
  /** Runs `handler` with the Cloudflare context OpenNext's `getCloudflareContext()` reads. */
  export function runWithCloudflareRequestContext<T>(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
    handler: () => Promise<T>,
  ): Promise<T>;
}
