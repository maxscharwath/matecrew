/** @jsxImportSource @matecrew/device-ui */
/**
 * A take, from the key to the confirmation: badge, choose, done. One decision per screen,
 * the expected key in ink.
 */
import {
  HStack,
  VStack,
  Label,
  H1,
  Lead,
  Num,
  Alert,
  AlertTitle,
  AlertDescription,
  cond,
  or,
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@matecrew/device-ui";
import { CircleCheckBigIcon, DoorOpenIcon, RefrigeratorIcon } from "@matecrew/device-ui/icons/lucide";
import { BadgeOverReader } from "../art";
import { Avatar, Frame, PageDots, Picture, useT, view } from "./shared";

/**
 * After a key (it also wakes the terminal, whose reader sleeps with it): the badge goes on the
 * reader, right under the middle of the screen, then the menu opens. With
 * `account`, the right key: the badge whose account to show (`account.tsx`); with `purchases`,
 * it was held: the badge whose purchases to list (`purchases.tsx`).
 */
export function badge() {
  const t = useT();
  const account = view("account", false);
  const purchases = view("purchases", false);
  const mine = or(account, purchases);
  return (
    <Frame
      title={cond(purchases, t("purchases.title"), cond(account, t("account.title"), view("title")))}
      left={cond(mine, t("account.dismiss"), view("left"))}
      right={cond(mine, t("account.dismiss"), view("right"))}
      keys
      reader
      align="center"
      justify="center"
      gap={8}
    >
      <BadgeOverReader width={240} height={200} />
      <H1 align="center">{t("badge.heading")}</H1>
      <Lead align="center">{cond(purchases, t("purchases.badgeHint"), cond(account, t("account.badgeHint"), t("badge.hint")))}</Lead>
    </Frame>
  );
}

/**
 * After a badge: whose it is, and what each key does. The left key takes (the picker), the right
 * one shows the account, or serves the preparation ("Servi").
 */
export function menu() {
  const t = useT();
  return (
    <Frame title={view("title")} keys primary="left" align="center" justify="center" gap={16}>
      <Avatar person="person" size={128} />
      <H1 align="center">{t("menu.heading", { name: view("first") })}</H1>
      <Lead align="center">{t("menu.hint")}</Lead>
    </Frame>
  );
}

/** Choose what to take; the left key steps through the items, the right one takes this one. */
export function pick() {
  const t = useT();
  return (
    <Frame title={view("title")} keys primary="right" gap={12}>
      <HStack gap={36} height="fill" align="center">
        <Picture value={view("picture", [])} size={168} />
        <VStack gap={12} width="fill">
          <Label>{t("pick.label", { position: view("status") })}</Label>
          <H1 fit lines={2}>{view("item")}</H1>
          <HStack gap={12} align="center">
            <Num size="md">{view("stock")}</Num>
            <Lead>{t("pick.inStock")}</Lead>
          </HStack>
        </VStack>
      </HStack>
      <HStack justify="center" width="fill">
        <PageDots index={view("index", 0)} count={view("count", 0)} />
      </HStack>
    </Frame>
  );
}

/** Nothing for me: step through the items again, or leave. */
export function leave() {
  const t = useT();
  return (
    <Frame title={view("title")} keys primary="right">
      <Empty>
        <EmptyMedia size={144}><DoorOpenIcon size={72} strokeWidth={4} /></EmptyMedia>
        <EmptyTitle>{t("leave.heading")}</EmptyTitle>
        <EmptyDescription>{t("leave.text")}</EmptyDescription>
      </Empty>
    </Frame>
  );
}

/** Done: what (its picture beside the tick), cheers to whom, and a can to put in the fridge. */
export function taken() {
  const t = useT();
  return (
    <Frame title={view("item")} gap={20}>
      <Empty>
        <HStack gap={24} align="center">
          <Picture value={view("picture", [])} size={112} />
          <EmptyMedia variant="ink" size={112}><CircleCheckBigIcon size={56} strokeWidth={4} /></EmptyMedia>
        </HStack>
        <H1 align="center">{t("taken.heading", { name: view("first") })}</H1>
      </Empty>
      <Alert>
        <RefrigeratorIcon size={56} strokeWidth={3} />
        <AlertTitle>{t("taken.fridge")}</AlertTitle>
        <AlertDescription>{t("taken.fridgeHint")}</AlertDescription>
      </Alert>
    </Frame>
  );
}

