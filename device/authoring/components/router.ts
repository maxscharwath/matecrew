import { bind } from "../jsx-runtime";
import type { Action, Element, Node, RouteElement } from "../types";

/** Screens share app-level resources/state; mounted route selection and its stack live in Rust. */
export function Route({
  name,
  children,
}: {
  name: string;
  children: Element;
}): RouteElement {
  if (children.kind === "route" || children.kind === "chartSeries")
    throw new Error("A route needs a screen or component");
  return {
    kind: "route",
    name,
    root: children.kind === "screen" ? children.root : children,
  };
}
type Children = Element | Children[] | null | undefined | false;
export function Router({
  initial,
  width,
  height,
  children,
}: {
  initial: string;
  width: number;
  height: number;
  children: Children;
}): Node {
  function collect(child: Children): { name: string; root: Node }[] {
    if (!child) return [];
    if (Array.isArray(child)) return child.flatMap(collect);
    if (child.kind !== "route")
      throw new Error("Router accepts Route children");
    return [{ name: child.name, root: child.root }];
  }
  return {
    kind: "router",
    rect: { x: 0, y: 0, width, height },
    initial,
    routes: collect(children),
  };
}
export function useRouter<Name extends string = string>() {
  return {
    current: bind("$navigation.current"),
    canGoBack: bind("$navigation.canGoBack", false),
    push: (route: Name): Action => ({
      kind: "navigate",
      operation: "push",
      route,
    }),
    replace: (route: Name): Action => ({
      kind: "navigate",
      operation: "replace",
      route,
    }),
    reset: (route: Name): Action => ({
      kind: "navigate",
      operation: "reset",
      route,
    }),
    back: (): Action => ({ kind: "navigate", operation: "back" }),
  };
}
