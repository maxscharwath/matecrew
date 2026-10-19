/** maté: the terminal's built-in screens, one per journey step. The host supplies `view.*` and handles `emit`. */
export { setup, setupLater, connecting, connected, link, linked, error, claim } from "./screens/onboarding";
export { badge, pick, leave, taken } from "./screens/consumption";
export { accountLoading, account } from "./screens/account";
export { failure } from "./screens/failure";
export { update } from "./screens/update";
export { sleep } from "./screens/sleep";
export { about } from "./screens/about";
export { purchases } from "./screens/purchases";
export {
  dashboard,
  dashboardOne,
  dashboardTwo,
  catalogueFour,
  catalogue,
  empty,
  preparation,
  served,
} from "./screens/dashboard";
