/**
 * Stands in for the `server-only` package in the worker entry bundle
 * (wrangler.jsonc `alias`). Next resolves `server-only` with the
 * `react-server` condition; wrangler does not, and the package's default
 * export throws on import. Everything in that bundle runs on the server.
 */
export {};
