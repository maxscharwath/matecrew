/** @jsxImportSource @matecrew/device-ui */
/**
 * What went wrong, said cleanly: a title, one sentence on what to do, then a small technical line
 * for whoever diagnoses it ("HTTP 503 · /api/device/account"). The host passes English keys, the
 * words are in ../messages.ts (`failure.*`).
 */
import { Badge, Empty, EmptyDescription, EmptyMedia, EmptyTitle, Show, concat, cond, eq } from "@matecrew/device-ui";
import { FileQuestionMarkIcon, IdCardIcon, ServerCrashIcon, WifiOffIcon } from "@matecrew/device-ui/icons/lucide";
import { Frame, useT, view } from "./shared";

/**
 * A failure, centred. `kind`: offline, site, unreadable or unknownBadge (`flow::Failure`).
 * `detail`: what the technical line names: wifi, timeout, connect, tls, dns or network for an
 * offline one, http (with `status`) or unreadable. `path`: the request that failed.
 */
export function Failure({ kind, detail, status, path }: Readonly<{ kind: unknown; detail: unknown; status?: unknown; path: unknown }>) {
  const t = useT();
  return (
    <Empty>
      <EmptyMedia size={104}>
        <Show when={eq(kind, "offline")}><WifiOffIcon size={52} strokeWidth={3} /></Show>
        <Show when={eq(kind, "site")}><ServerCrashIcon size={52} strokeWidth={3} /></Show>
        <Show when={eq(kind, "unreadable")}><FileQuestionMarkIcon size={52} strokeWidth={3} /></Show>
        <Show when={eq(kind, "unknownBadge")}><IdCardIcon size={52} strokeWidth={3} /></Show>
      </EmptyMedia>
      <EmptyTitle>{t("failure.title", { context: kind })}</EmptyTitle>
      <EmptyDescription>{t("failure.hint", { context: kind })}</EmptyDescription>
      <Badge variant="outline">{concat(t("failure.detail", { context: detail, status: status ?? "" }), " · ", path)}</Badge>
    </Empty>
  );
}

/**
 * The site gave no usable answer to `view.task` (account, purchases or cancel): the left key
 * tries again when `view.retry`, the right one closes.
 */
export function failure() {
  const t = useT();
  return (
    <Frame
      title={t("failure.task", { context: view("task") })}
      keys
      left={cond(view("retry", false), t("failure.retry"), t("failure.close"))}
      right={t("failure.close")}
    >
      <Failure kind={view("kind")} detail={view("detail")} status={view("status", "")} path={view("path")} />
    </Frame>
  );
}
