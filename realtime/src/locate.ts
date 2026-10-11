/**
 * Where a terminal's relay lives: one Durable Object per terminal (`Device.id`), in the EU like the
 * site's D1 database and R2 bucket (its screens show names). The relay's Worker and the site
 * (src/platform/cloudflare/realtime.ts) both find it here, so they reach the same object.
 *
 * `wrangler dev` (workerd) has no jurisdictions and throws: locally, the plain namespace.
 */
export function terminalRelay<T extends Rpc.DurableObjectBranded | undefined>(
  namespace: DurableObjectNamespace<T>,
  deviceId: string,
): DurableObjectStub<T> {
  let scoped = namespace;
  try {
    scoped = namespace.jurisdiction("eu");
  } catch {
    // Local runtime only.
  }
  return scoped.getByName(deviceId);
}
