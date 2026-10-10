/** @jsxImportSource ../../authoring */
import {
  Screen,
  Card,
  Text,
  Chart,
  Image,
  Group,
  When,
} from "../../authoring/jsx-runtime";
import { ShoppingShippingBoxIcon } from "../../authoring/icons/streamline-pixel";
import { Chrome, Keys, data } from "./shared";

function History() {
  return (
    <Group x={16} y={147} width={368} height={58}>
      <Text width={298} height={16} font="caption" value={data("chartLabel")} />
      <Text
        x={302}
        width={66}
        height={16}
        font="caption"
        align="right"
        value={data("more")}
      />
      {[0, 1, 2].map((i) => (
        <Chart
          x={28}
          y={23}
          width={340}
          height={34}
          value={data(`chart.series.${i}`, [])}
          max={data("chart.max", 1)}
          stroke={(["solid", "dotted", "dashed"] as const)[i]}
          axes={i === 0}
        />
      ))}
      <Text
        y={23}
        width={24}
        height={16}
        font="caption"
        value={data("chart.max", 0)}
      />
    </Group>
  );
}

/** Product art stays on white; the quantity is the single high-contrast focal point. */
function PrimaryStock({ x = 16, index = 0 }: { x?: number; index?: number }) {
  return (
    <Group x={x} y={38} width={180} height={102}>
      <Image
        y={3}
        width={24}
        height={24}
        value={data(`items.${index}.bits`, [])}
      />
      <Text
        x={36}
        y={2}
        width={140}
        height={36}
        font="body"
        maxLines={2}
        value={data(`items.${index}.name`)}
      />
      <Card
        y={44} width={176} height={54} inverted
        radius={6} borderWidth={0} background="ink"
        shadow={{ x: 2, y: 2, opacity: 35 }}
      >
        <Text
          x={12}
          y={13}
          width={88}
          height={32}
          font="display"
          inverted
          value={data(`items.${index}.stock`)}
        />
        <Text
          x={106}
          y={20}
          width={62}
          height={16}
          font="caption"
          inverted
          value="en stock"
        />
        <When
          x={102}
          y={17}
          width={68}
          height={20}
          value={data(`items.${index}.low`, false)}
        >
          <Card width={68} height={20} inverted radius={2} borderWidth={0} background="ink">
            <Text
              x={4}
              y={3}
              width={62}
              height={16}
              font="caption"
              inverted
              value="Stock bas"
            />
          </Card>
        </When>
      </Card>
    </Group>
  );
}

function SecondaryStock({ index, y }: { index: number; y: number }) {
  return (
    <Group x={216} y={y} width={168} height={40}>
      <Image
        y={2}
        width={24}
        height={24}
        value={data(`items.${index}.bits`, [])}
      />
      <Text
        x={36}
        width={88}
        height={30}
        font="caption"
        maxLines={2}
        value={data(`items.${index}.name`)}
      />
      <Text
        x={128}
        y={1}
        width={40}
        height={24}
        font="title"
        align="right"
        value={data(`items.${index}.stock`)}
      />
      <When
        x={36}
        y={25}
        width={120}
        height={14}
        value={data(`items.${index}.low`, false)}
      >
        <Text width={120} height={14} font="caption" value="Stock bas" />
      </When>
    </Group>
  );
}

export function dashboard() {
  return (
    <Screen width={400} height={240}>
      <Chrome />
      <PrimaryStock />
      <SecondaryStock index={1} y={40} />
      <Card x={216} y={86} width={168} height={1} radius={0} borderWidth={0} background="ink" opacity={35} />
      <SecondaryStock index={2} y={97} />
      <History />
      <Keys />
    </Screen>
  );
}

export function dashboardTwo() {
  return (
    <Screen width={400} height={240}>
      <Chrome />
      <PrimaryStock />
      <PrimaryStock x={208} index={1} />
      <History />
      <Keys />
    </Screen>
  );
}

export function dashboardOne() {
  return (
    <Screen width={400} height={240}>
      <Chrome />
      <Image
        x={16}
        y={57}
        width={24}
        height={24}
        value={data("items.0.bits", [])}
      />
      <Text
        x={56}
        y={43}
        width={204}
        height={44}
        font="title"
        maxLines={2}
        value={data("items.0.name")}
      />
      <Text
        x={56}
        y={101}
        width={204}
        height={16}
        font="caption"
        value="Disponible au bureau"
      />
      <Card
        x={280} y={40} width={104} height={74} inverted
        radius={6} borderWidth={0} background="ink"
        shadow={{ x: 2, y: 2, opacity: 35 }}
      >
        <Text
          x={12}
          y={12}
          width={80}
          height={32}
          font="display"
          align="center"
          inverted
          value={data("items.0.stock")}
        />
        <Text
          x={12}
          y={50}
          width={80}
          height={16}
          font="caption"
          align="center"
          inverted
          value="en stock"
        />
      </Card>
      <When
        x={280}
        y={119}
        width={104}
        height={16}
        value={data("items.0.low", false)}
      >
        <Text
          width={104}
          height={16}
          font="caption"
          align="center"
          value="Stock bas"
        />
      </When>
      <History />
      <Keys />
    </Screen>
  );
}

export function catalogue() {
  return (
    <Screen width={400} height={240}>
      <Chrome />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <When
          x={16 + (i % 2) * 192}
          y={38 + Math.floor(i / 2) * 34}
          width={176}
          height={28}
          value={data(`items.${i}.visible`, false)}
        >
          <Card width={176} height={28} radius={3} borderWidth={1} background="transparent">
            <Text
              x={10}
              y={6}
              width={126}
              height={18}
              value={data(`items.${i}.name`)}
            />
            <Text
              x={136}
              y={6}
              width={30}
              height={18}
              font="title"
              align="right"
              value={data(`items.${i}.stock`)}
            />
          </Card>
        </When>
      ))}
      <History />
      <Keys />
    </Screen>
  );
}

export function empty() {
  return (
    <Screen width={400} height={240}>
      <Chrome />
      <Card
        x={167} y={55} width={66} height={66}
        radius={8} borderWidth={1} background="paper"
        shadow={{ x: 2, y: 2, opacity: 35 }}
      />
      <ShoppingShippingBoxIcon x={179} y={67} size={42} />
      <Text
        x={16}
        y={127}
        width={368}
        height={22}
        font="title"
        align="center"
        value="Aucun article"
      />
      <Text
        x={16}
        y={155}
        width={368}
        height={18}
        font="caption"
        align="center"
        value="Le stock apparaîtra ici."
      />
      <Keys />
    </Screen>
  );
}

export function preparation() {
  return (
    <Screen width={400} height={240}>
      <Chrome />
      <Text
        x={16}
        y={41}
        width={368}
        height={22}
        font="title"
        value={data("preparation.title")}
      />
      <Text
        x={16}
        y={68}
        width={368}
        height={18}
        font="caption"
        value={data("preparation.total")}
      />
      <Text
        x={16}
        y={97}
        width={160}
        height={16}
        font="caption"
        value="ARTICLE"
      />
      <Text
        x={188}
        y={97}
        width={196}
        height={16}
        font="caption"
        value="POUR"
      />
      <Card x={16} y={114} width={368} height={1} radius={0} borderWidth={0} background="ink" opacity={35} />
      {[0, 1, 2, 3].map((i) => (
        <Group x={16} y={122 + i * 22} width={368} height={20}>
          <Text width={160} height={20} value={data(`prepRows.${i}.title`)} />
          <Text
            x={172}
            y={2}
            width={196}
            height={18}
            font="caption"
            value={data(`prepRows.${i}.names`)}
          />
        </Group>
      ))}
      <Keys />
    </Screen>
  );
}
