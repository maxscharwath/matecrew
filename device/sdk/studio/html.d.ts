/** Bun bundles HTML imports for `Bun.serve` routes. */
declare module "*.html" {
  const page: import("bun").HTMLBundle;
  export default page;
}
