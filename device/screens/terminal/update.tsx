/** @jsxImportSource ../../authoring */
import { Screen, Card, Text, Progress } from "../../authoring/jsx-runtime";
import { Chrome, Footer, data } from "./shared";
export const update = () => (
  <Screen width={400} height={240}>
    <Chrome />
    <Card x={8} y={38} width={384} height={162}>
      <Text
        x={16}
        y={18}
        width={352}
        height={34}
        font="title"
        align="center"
        value={data("heading")}
      />
      <Progress
        x={24}
        y={64}
        width={336}
        height={32}
        value={data("percent", 0)}
      />
      <Text
        x={16}
        y={112}
        width={352}
        height={44}
        font="display"
        align="center"
        value={data("detail")}
      />
    </Card>
    <Footer />
  </Screen>
);
