/** @jsxImportSource @matecrew/device-ui */
/**
 * The person's purchases, from "Mon compte" (`account.tsx`) or the right key held then a badge
 * (the badge screen with `view.purchases`): a page of rows, the left key moves through them and
 * the way back to the account, the right key cancels the selected one after a second press
 * (`core::flow`, `Screen::Purchases`).
 */
import {
  HStack,
  VStack,
  Surface,
  H1,
  Lead,
  Large,
  Muted,
  Show,
  and,
  concat,
  cond,
  eq,
  lt,
  ne,
  not,
  type Children,
} from "@matecrew/device-ui";
import { ArrowLeftIcon, ChevronRightIcon, ReceiptIcon } from "@matecrew/device-ui/icons/lucide";
import { Frame, PageDots, Picture, useT, view } from "./shared";

/** Rows on a page: `flow::PURCHASES_PAGE`. */
const ROWS = 4;

const row = (index: number, field: string, fallback: unknown = "") => view(`rows.${index}.${field}`, fallback);

/** One purchase: its picture, what and when, and its price. */
function Purchase({ index }: Readonly<{ index: number }>) {
  return (
    <HStack gap={14} align="center" width="fill">
      <Picture value={row(index, "picture", [])} size={52} half />
      <VStack gap={2} width="fill">
        <Large lines={1} fit width="fill">{row(index, "item")}</Large>
        <Muted lines={1}>{row(index, "when")}</Muted>
      </VStack>
      <Large>{row(index, "price")}</Large>
    </HStack>
  );
}

/** A row, framed when it is the selected one: two nodes, so called as a function, not as JSX. */
function framed(selected: unknown, children: Children) {
  return [
    <Show key="selected" when={selected}>
      <Surface variant="outline" radius={14} width="fill" direction="row" align="center" gap={10} padding={[6, 12]}>
        <ChevronRightIcon size={24} />
        {children}
      </Surface>
    </Show>,
    <Show key="other" when={not(selected)}>
      <Surface variant="paper" radius={14} width="fill" direction="row" align="center" gap={10} padding={[6, 12, 6, 46]}>
        {children}
      </Surface>
    </Show>,
  ];
}

/** A page of the purchases, the way back after the last one. */
export function purchases() {
  const t = useT();
  const selected = view("selected", 0);
  const back = and(view("back", false), eq(selected, view("rowCount", 0)));
  return (
    <Frame
      title={concat(t("purchases.title"), " · ", view("name"))}
      keys
      left={cond(view("confirm", false), t("purchases.keep"), t("purchases.next"))}
      right={cond(back, t("purchases.leave"), cond(view("confirm", false), t("purchases.confirmCancel"), t("purchases.cancel")))}
      primary="right"
      gap={8}
    >
      <Show when={view("confirm", false)}>
        {/* The selected purchase, waiting for the second press. */}
        <HStack gap={32} height="fill" align="center">
          <Picture value={view("selectedPicture", [])} size={168} />
          <VStack gap={10} width="fill">
            <H1 fit lines={1} width="fill">{t("purchases.confirm")}</H1>
            <Large lines={1} fit width="fill">{view("selectedItem")}</Large>
            <Muted>{view("selectedWhen")}</Muted>
            <Lead>{t("purchases.confirmHint")}</Lead>
          </VStack>
        </HStack>
      </Show>
      <Show when={not(view("confirm", false))}>
        <VStack gap={6} height="fill" width="fill">
          <Show when={and(eq(view("rowCount", 0), 0), view("back", false), eq(view("page", 0), 0))}>
            <HStack gap={12} align="center" padding={[8, 12]}>
              <ReceiptIcon size={28} />
              <Lead>{t("purchases.empty")}</Lead>
            </HStack>
          </Show>
          {Array.from({ length: ROWS }, (_, index) => (
            <Show key={index} when={lt(index, view("rowCount", 0))}>
              {framed(eq(selected, index), <Purchase index={index} />)}
            </Show>
          ))}
          <Show when={view("back", false)}>
            {framed(
              back,
              <HStack gap={14} align="center" width="fill" height={52}>
                <ArrowLeftIcon size={28} />
                <Large>{t("purchases.back")}</Large>
              </HStack>,
            )}
          </Show>
        </VStack>
        <Show when={ne(view("pages", 1), 1)}>
          <HStack justify="center" width="fill">
            <PageDots index={view("page", 0)} count={view("pages", 1)} />
          </HStack>
        </Show>
      </Show>
    </Frame>
  );
}
