import { definePreviews } from "@matecrew/device-ui/preview";

const stock = {
  office: { name: "Lausanne" },
  items: [{ name: "Maté Classic", stock: 36 }],
  screen: { chart: { series: [[48, 45, 46, 39, 36]], max: 50 } },
};

export const previews = definePreviews({
  empty: { description: "Before the first sync" },
  stock: { cache: { stock } },
  help: { cache: { stock }, description: "After pressing Aide", events: [{ kind: "input", name: "right" }] },
});
