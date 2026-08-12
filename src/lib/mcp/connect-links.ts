import { getMcpResourceUrl } from "@/lib/base-url";

/**
 * One-click install links for the MateCrew MCP connector.
 *
 * claude.ai accepts an "install link" that opens its Add custom connector
 * dialog with the name and URL prefilled. It only prefills: the user still
 * reviews and confirms, then completes the OAuth sign-in against MateCrew. That
 * confirmation step is deliberate on Anthropic's side and cannot be skipped, so
 * this is the shortest path the platform allows — not a silent install.
 *
 * @see https://claude.com/docs/connectors/building/directory-vs-custom
 */

const CONNECTOR_NAME = "MateCrew";

export interface ConnectLinks {
  /** The MCP endpoint — what a client is ultimately pointed at. */
  serverUrl: string;
  /** Opens claude.ai with the Add custom connector dialog prefilled. */
  personalInstallUrl: string;
  /** Same, but the org-wide dialog — only usable by a Claude org admin. */
  organizationInstallUrl: string;
  /** Installs the Claude Code CLI itself (macOS, Linux, WSL). */
  claudeCodeInstall: string;
  /** Registers MateCrew for every project the user opens. */
  claudeCodeAdd: string;
  /** Shows the connection status, so a user can confirm it worked. */
  claudeCodeVerify: string;
}

export function getConnectLinks(): ConnectLinks {
  const serverUrl = getMcpResourceUrl();

  // URLSearchParams percent-encodes the URL, which the install link requires.
  const params = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: CONNECTOR_NAME,
    connectorUrl: serverUrl,
  });

  return {
    serverUrl,
    personalInstallUrl: `https://claude.ai/customize/connectors?${params}`,
    organizationInstallUrl: `https://claude.ai/admin-settings/connectors?${params}`,
    claudeCodeInstall: "curl -fsSL https://claude.ai/install.sh | bash",
    // `--scope user` rather than the default `local`, which would tie MateCrew
    // to whichever directory the command happened to be run in.
    claudeCodeAdd: `claude mcp add --scope user --transport http matecrew ${serverUrl}`,
    claudeCodeVerify: "claude mcp list",
  };
}
