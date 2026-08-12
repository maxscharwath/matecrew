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
  readonly claudeCodeCommand: string;
  readonly connections: readonly ConnectClaudeConnection[];
  /** Offices where this user is an admin — what the token would also unlock. */
  readonly adminOffices: readonly string[];
}

export function ConnectClaudeCard({
  serverUrl,
  personalInstallUrl,
  organizationInstallUrl,
  claudeCodeCommand,
  connections,
  adminOffices,
}: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [showOther, setShowOther] = useState(false);
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClaudeLogo className="h-4 w-4" brand />
          {t("connectClaude.title")}
        </CardTitle>
        <CardDescription>{t("connectClaude.subtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Button asChild className="w-full sm:w-auto">
            {/* noreferrer alongside _blank: keeps the opened tab from reaching
                back into this one via window.opener. */}
            <a
              href={personalInstallUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {/* Inherits the button foreground rather than using the brand
                  colour, which would not meet contrast on the filled button. */}
              <ClaudeLogo className="h-4 w-4" />
              {t("connectClaude.addButton")}
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </a>
          </Button>
          {/* Spelled out because the flow crosses two sites: people otherwise
              stop at Claude's "Add" dialog and miss the sign-in that follows. */}
          <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
            <li>{t("connectClaude.step1")}</li>
            <li>{t("connectClaude.step2")}</li>
            <li>{t("connectClaude.step3")}</li>
            <li>{t("connectClaude.step4")}</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            {adminOffices.length > 0
              ? t("connectClaude.scopeAdmin", {
                  offices: adminOffices.join(", "),
                })
              : t("connectClaude.scopeMember")}
          </p>
        </div>

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

        <div className="space-y-3">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium hover:underline"
            onClick={() => setShowOther((v) => !v)}
            aria-expanded={showOther}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showOther ? "" : "-rotate-90"}`}
            />
            {t("connectClaude.otherWays")}
          </button>

          {showOther && (
            <div className="space-y-4 pl-1">
              <CopyRow
                label={t("connectClaude.serverUrlLabel")}
                hint={t("connectClaude.serverUrlHint")}
                value={serverUrl}
                copied={copied === "url"}
                onCopy={() => copy(serverUrl, "url")}
                copyLabel={t("connectClaude.copy")}
                copiedLabel={t("connectClaude.copied")}
              />

              <CopyRow
                icon={<Terminal className="h-4 w-4" />}
                label={t("connectClaude.claudeCodeLabel")}
                hint={t("connectClaude.claudeCodeHint")}
                value={claudeCodeCommand}
                copied={copied === "cli"}
                onCopy={() => copy(claudeCodeCommand, "cli")}
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

function CopyRow({
  icon,
  label,
  hint,
  value,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  readonly icon?: React.ReactNode;
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
      <p className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-nowrap">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={onCopy}
          aria-label={copyLabel}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">{copiedLabel}</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">{copyLabel}</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
