/** @jsxImportSource ../../authoring */
import { Screen, Card, Text, Image } from "../../authoring/jsx-runtime";
import { Chrome, Footer, Keys, data } from "./shared";
export const pick = () => (
  <Screen width={400} height={240}>
    <Chrome />
    <Card x={8} y={38} width={384} height={162}>
      <Image x={16} y={26} width={96} height={96} value={data("image")} />
      <Text
        x={132}
        y={20}
        width={236}
        height={60}
        font="title"
        maxLines={2}
        value={data("item")}
      />
      <Text
        x={132}
        y={88}
        width={236}
        height={46}
        font="display"
        value={data("stock")}
      />
      <Text
        x={132}
        y={134}
        width={236}
        height={24}
        font="caption"
        value={data("stockHint", "en stock")}
      />
    </Card>
    <Keys />
  </Screen>
);
export const taken = () => (
  <Screen width={400} height={240}>
    <Chrome />
    <Card x={8} y={38} width={384} height={162}>
      <Image x={16} y={26} width={96} height={96} value={data("image")} />
      <Text
        x={132}
        y={20}
        width={236}
        height={60}
        font="title"
        maxLines={2}
        value={data("heading")}
      />
      <Text
        x={132}
        y={96}
        width={236}
        height={60}
        maxLines={2}
        value={data("item")}
      />
    </Card>
    <Footer />
  </Screen>
);
export const summary = () => (
  <Screen width={400} height={240}>
    <Chrome />
    <Text
      x={8}
      y={42}
      width={384}
      height={34}
      font="title"
      align="center"
      value={data("name")}
    />
    {["today", "week", "month"].map((key, i) => (
      <Card x={2 * (4 + i * 65)} y={86} width={124} height={110}>
        <Text
          x={8}
          y={18}
          width={108}
          height={46}
          font="display"
          align="center"
          value={data(key)}
        />
        <Text
          x={6}
          y={74}
          width={112}
          height={24}
          font="caption"
          align="center"
          value={["Aujourd'hui", "Semaine", "Mois"][i]}
        />
      </Card>
    ))}
    <Footer />
  </Screen>
);
