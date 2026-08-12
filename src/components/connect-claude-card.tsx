"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Building2,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Info,
  Terminal,
  Unplug,
} from "lucide-react";
import { ClaudeLogo } from "@/components/claude-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { revokeMcpConnectionAction } from "@/app/profile/actions";

export interface ConnectClaudeConnection {
  readonly clientId: string;
  readonly clientName: string;
  readonly connectedAt: string;
}

interface Props {
  readonly serverUrl: string;
  readonly personalInstallUrl: string;
  readonly organizationInstallUrl: string;
  readonly claudeCodeInstall: string;
  readonly claudeCodeAdd: string;
  readonly claudeCodeVerify: string;
  readonly connections: readonly ConnectClaudeConnection[];
  /** Offices where this user is an admin — what the token would also unlock. */
  readonly adminOffices: readonly string[];
}

/**
 * Claude Code is the primary path here, not claude.ai.
 *
 * Adding a *custom* connector on claude.ai or Claude Desktop is governed by
 * Claude organisation policy, and many orgs (ours included) disable it — the
 * button simply leads to a dialog the user is not allowed to complete. The CLI
 * has no such restriction, so it is what the card leads with; the web route is
 * kept below for anyone whose org does permit it.
 */
export function ConnectClaudeCard({
  serverUrl,
  personalInstallUrl,
  organizationInstallUrl,
  claudeCodeInstall,
  claudeCodeAdd,
  claudeCodeVerify,
  connections,
  adminOffices,
}: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [showWeb, setShowWeb] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      // Clipboard needs a secure context; the value stays selectable on screen.
      toast.error(t("connectClaude.copyFailed"));
    }
  }

  function revoke(connection: ConnectClaudeConnection) {
    setRevoking(connection.clientId);
    startTransition(async () => {
      const result = await revokeMcpConnectionAction(connection.clientId);
      setRevoking(null);
      if (result.success) {
        toast.success(
          t("connectClaude.revoked", { client: connection.clientName }),
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    // `id` + scroll offset so /profile#claude lands on this section — the
    // anchor other pages and release notes can link straight to.
    <Card id="claude" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClaudeLogo className="h-4 w-4" brand />
          {t("connectClaude.title")}
        </CardTitle>
        <CardDescription>{t("connectClaude.subtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── Claude Code: the supported route ─────────────────────────── */}
        <div className="space-y-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Terminal className="h-4 w-4" />
              {t("connectClaude.cliTitle")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("connectClaude.cliIntro")}
            </p>
          </div>

          <ol className="space-y-4">
            <Step number={1} title={t("connectClaude.cliStep1")}>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("connectClaude.cliStep1Hint")}
              </p>
              <CommandLine
                value={claudeCodeInstall}
                copied={copied === "install"}
                onCopy={() => copy(claudeCodeInstall, "install")}
                copyLabel={t("connectClaude.copy")}
                copiedLabel={t("connectClaude.copied")}
              />
            </Step>

            <Step number={2} title={t("connectClaude.cliStep2")}>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("connectClaude.cliStep2Hint")}
              </p>
              <CommandLine
                value={claudeCodeAdd}
                copied={copied === "add"}
                onCopy={() => copy(claudeCodeAdd, "add")}
                copyLabel={t("connectClaude.copy")}
                copiedLabel={t("connectClaude.copied")}
              />
            </Step>

            <Step number={3} title={t("connectClaude.cliStep3")}>
              <p className="text-xs text-muted-foreground">
                {t("connectClaude.cliStep3Hint")}
              </p>
            </Step>

            <Step number={4} title={t("connectClaude.cliStep4")}>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("connectClaude.cliStep4Hint")}
              </p>
              <CommandLine
                value={claudeCodeVerify}
                copied={copied === "verify"}
                onCopy={() => copy(claudeCodeVerify, "verify")}
                copyLabel={t("connectClaude.copy")}
                copiedLabel={t("connectClaude.copied")}
              />
            </Step>
          </ol>

          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            {t("connectClaude.cliTryIt")}
          </p>

          <p className="text-sm text-muted-foreground">
            {adminOffices.length > 0
              ? t("connectClaude.scopeAdmin", {
                  offices: adminOffices.join(", "),
                })
              : t("connectClaude.scopeMember")}
          </p>
        </div>

        {/* ── Connected apps ───────────────────────────────────────────── */}
        {connections.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-medium">
                {t("connectClaude.connectedTitle")}
              </h3>
              <ul className="space-y-2">
                {connections.map((connection) => (
                  <li
                    key={connection.clientId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {connection.clientName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("connectClaude.connectedSince", {
                          date: connection.connectedAt,
                        })}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending && revoking === connection.clientId}
                      onClick={() => revoke(connection)}
                    >
                      <Unplug className="h-4 w-4" />
                      {t("connectClaude.revoke")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <Separator />

        {/* ── Claude web / Desktop: often blocked by org policy ────────── */}
        <div className="space-y-3">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium hover:underline"
            onClick={() => setShowWeb((v) => !v)}
            aria-expanded={showWeb}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showWeb ? "" : "-rotate-90"}`}
            />
            {t("connectClaude.webTitle")}
          </button>

          {showWeb && (
            <div className="space-y-4 pl-1">
              <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {t("connectClaude.webPolicyNote")}
              </p>

              <div className="space-y-2">
                <Button asChild variant="outline" size="sm">
                  {/* noreferrer alongside _blank: keeps the opened tab from
                      reaching back into this one via window.opener. */}
                  <a
                    href={personalInstallUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ClaudeLogo className="h-4 w-4" brand />
                    {t("connectClaude.addButton")}
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                  </a>
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("connectClaude.addHint")}
                </p>
              </div>

              <CopyRow
                label={t("connectClaude.serverUrlLabel")}
                hint={t("connectClaude.serverUrlHint")}
                value={serverUrl}
                copied={copied === "url"}
                onCopy={() => copy(serverUrl, "url")}
                copyLabel={t("connectClaude.copy")}
                copiedLabel={t("connectClaude.copied")}
              />

              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="h-4 w-4" />
                  {t("connectClaude.orgLabel")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("connectClaude.orgHint")}
                </p>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={organizationInstallUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ClaudeLogo className="h-4 w-4" brand />
                    {t("connectClaude.orgButton")}
                    <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Step({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}

function CommandLine({
  value,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  readonly value: string;
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly copyLabel: string;
  readonly copiedLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
        {value}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={onCopy}
        aria-label={copied ? copiedLabel : copyLabel}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function CopyRow({
  label,
  hint,
  value,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly copyLabel: string;
  readonly copiedLabel: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <CommandLine
        value={value}
        copied={copied}
        onCopy={onCopy}
        copyLabel={copyLabel}
        copiedLabel={copiedLabel}
      />
    </div>
  );
}
