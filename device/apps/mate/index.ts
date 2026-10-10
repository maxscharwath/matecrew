/** maté: the terminal's built-in screens, one per journey step. The host supplies `view.*` and handles `emit`. */
export { setup, connecting, connected, link, linked, error, claim } from "./screens/onboarding";
export { badge, pick, leave, taken, summary } from "./screens/consumption";
export { update } from "./screens/update";
export { about } from "./screens/about";
export {
  dashboard,
  dashboardOne,
  dashboardTwo,
  catalogue,
  empty,
  preparation,
  served,
} from "./screens/dashboard";
