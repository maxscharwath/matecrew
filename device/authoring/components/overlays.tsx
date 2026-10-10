/** @jsxImportSource .. */
import { Group, Card, Text, Button, When, Modal, bind } from "../jsx-runtime";
import { InterfaceEssentialAlertCircle1Icon } from "../icons/streamline-pixel";

/** Place once after the app content. Works with any viewport at least 200 × 120. */
export function OverlayHost({
  width = 400,
  height = 240,
}: {
  width?: number;
  height?: number;
}) {
  const cardWidth = Math.min(width - 24, 312);
  const cardHeight = Math.min(height - 48, 144);
  const x = Math.floor((width - cardWidth) / 2);
  const y = Math.floor((height - 26 - cardHeight) / 2);
  const compact = cardHeight < 130;
  const keyWidth = Math.min(140, Math.floor(width * 0.35));
  return (
    <Group width={width} height={height}>
      <When
        width={width}
        height={height}
        value={bind("$overlay.toast.visible", false)}
      >
        <Card x={x} y={height - 90} width={cardWidth} height={48}>
          <InterfaceEssentialAlertCircle1Icon x={12} y={13} />
          <Text
            x={43}
            y={8}
            width={cardWidth - 56}
            height={36}
            maxLines={2}
            value={bind("$overlay.toast.message", "")}
          />
        </Card>
      </When>
      <Modal
        width={width}
        height={height}
        value={bind("$overlay.dialog.visible", false)}
      >
        <Group width={width} height={height}>
          <Card x={x} y={y} width={cardWidth} height={cardHeight}>
            <Text
              x={16}
              y={compact ? 10 : 14}
              width={cardWidth - 32}
              height={compact ? 18 : 22}
              font="title"
              value={bind("$overlay.dialog.title", "")}
            />
            <Text
              x={16}
              y={compact ? 32 : 43}
              width={cardWidth - 32}
              height={compact ? 24 : 44}
              maxLines={2}
              value={bind("$overlay.dialog.message", "")}
            />
            {!compact && (
              <Group width={cardWidth} height={cardHeight}>
                <Button
                  x={16}
                  y={cardHeight - 42}
                  width={Math.floor((cardWidth - 40) / 2)}
                  height={28}
                  input="left"
                  label={bind("$overlay.dialog.cancelLabel", "Annuler")}
                  onPress={{ kind: "dialogChoice", confirm: false }}
                />
                <Button
                  x={Math.floor(cardWidth / 2) + 4}
                  y={cardHeight - 42}
                  width={Math.floor((cardWidth - 40) / 2)}
                  height={28}
                  input="right"
                  label={bind("$overlay.dialog.confirmLabel", "Confirmer")}
                  onPress={{ kind: "dialogChoice", confirm: true }}
                />
              </Group>
            )}
          </Card>
          <Button
            y={height - 26}
            width={keyWidth}
            height={26}
            variant="dock"
            input="left"
            label={bind("$overlay.dialog.cancelLabel", "Annuler")}
            onPress={{ kind: "dialogChoice", confirm: false }}
          />
          <Button
            x={width - keyWidth}
            y={height - 26}
            width={keyWidth}
            height={26}
            variant="dock"
            input="right"
            label={bind("$overlay.dialog.confirmLabel", "Confirmer")}
            onPress={{ kind: "dialogChoice", confirm: true }}
          />
        </Group>
      </Modal>
    </Group>
  );
}
