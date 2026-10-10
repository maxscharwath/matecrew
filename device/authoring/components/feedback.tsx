/** @jsxImportSource .. */
import { Group, Card, Text, type Element } from "../jsx-runtime";
import type { IconComponent } from "../icons/factory";
export function FeedbackCard({
  icon: Artwork,
  title,
  detail,
}: {
  icon: IconComponent;
  title: unknown;
  detail: unknown;
}): Element {
  return (
    <Group x={16} y={40} width={368} height={160}>
      <Artwork x={12} y={44} size={48} />
      <Card x={84} y={24} width={1} height={100} inverted />
      <Text
        x={104}
        y={28}
        width={264}
        height={52}
        font="title"
        maxLines={2}
        value={title}
      />
      <Text
        x={104}
        y={86}
        width={264}
        height={48}
        maxLines={2}
        value={detail}
      />
    </Group>
  );
}
