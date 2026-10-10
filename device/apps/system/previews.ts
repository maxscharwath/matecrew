import { definePreviews } from "@matecrew/device-ui/preview";

const stages = ["Réveil du système", "Connexion au réseau", "Chargement des apps", "Tout est prêt"];
const progress = [12, 38, 72, 100];

/** Boot stages as `ui::boot` drives them, and the notification layer with a toast. */
export const previews = definePreviews({
  ...Object.fromEntries(
    stages.map((stage, i) => [
      `boot-${i}`,
      {
        screen: "boot",
        data: { boot: { title: "matécrew", progress: progress[i], stage, step: `0${i + 1} / 04` } },
      },
    ]),
  ),
  notification: {
    screen: "notification",
    description: "System toast over any screen",
    events: [{ kind: "notify", message: "Synchronisation terminée" }],
  },
});
