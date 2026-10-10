/** @jsxImportSource ../runtime */
import { Modal, VStack, When, bind } from "../runtime/jsx-runtime";
import type { Element } from "../runtime/types";
import { BellIcon } from "../icons/lucide";
import { Key, Keys } from "./device";
import { Overlay, Surface } from "./surface";
import { H3, Large, Lead } from "./typography";

/**
 * Notifications and dialogs raised by `useToast` and `useDialog`, over the screen. Place once in
 * the `Screen`. A toast is an ink pill above the keys; a dialog dims the screen, asks its question
 * in a card and relabels both keys.
 */
export function OverlayHost(): Element {
  return (
    <Overlay>
      <When width="fill" height="fill" value={bind("$overlay.toast.visible", false)}>
        <VStack width="fill" height="fill" align="center" justify="end" padding={[0, 0, 80, 0]}>
          <Surface variant="ink" radius={32} direction="row" align="center" gap={16} padding={[18, 28]} width={560}>
            <BellIcon size={24} />
            <Large lines={1} width="fill">{bind("$overlay.toast.message", "")}</Large>
          </Surface>
        </VStack>
      </When>
      <Modal width="fill" height="fill" value={bind("$overlay.dialog.visible", false)}>
        <VStack width="fill" height="fill">
          <VStack width="fill" height="fill" align="center" justify="center">
            <Surface variant="outline" radius={24} width={560} gap={16} padding={40}>
              <H3>{bind("$overlay.dialog.title", "")}</H3>
              <Lead>{bind("$overlay.dialog.message", "")}</Lead>
            </Surface>
          </VStack>
          <Keys>
            <Key side="left" onPress={{ kind: "dialogChoice", confirm: false }}>{bind("$overlay.dialog.cancelLabel", "Annuler")}</Key>
            <Key side="right" primary onPress={{ kind: "dialogChoice", confirm: true }}>{bind("$overlay.dialog.confirmLabel", "Confirmer")}</Key>
          </Keys>
        </VStack>
      </Modal>
    </Overlay>
  );
}
