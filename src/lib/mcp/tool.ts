import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  actorIdFromAuth,
  loadActor,
  McpToolError,
  type McpActor,
} from "@/lib/mcp/context";

/**
 * Registration helper for MateCrew's MCP tools.
 *
 * It owns the three things every tool would otherwise repeat: turning the
 * verified bearer token into a MateCrew actor, JSON-encoding the result, and
 * converting a thrown `McpToolError` into a tool error the model can read and
 * act on (rather than a transport-level failure).
 */

export interface ToolContext {
  actor: McpActor;
}

interface ToolSpec<S extends z.ZodRawShape> {
  name: string;
  /** Human-readable label shown in client UIs. */
  title: string;
  description: string;
  inputSchema: S;
  /** True when the tool only reads — lets clients skip confirmation prompts. */
  readOnly?: boolean;
  /** True when the tool can remove or overwrite data a user cares about. */
  destructive?: boolean;
  /** True when repeating the call with the same args changes nothing further. */
  idempotent?: boolean;
}

export function defineTool<S extends z.ZodRawShape>(
  server: McpServer,
  spec: ToolSpec<S>,
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>,
): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: z.object(spec.inputSchema),
      annotations: {
        title: spec.title,
        readOnlyHint: spec.readOnly ?? false,
        destructiveHint: spec.destructive ?? false,
        idempotentHint: spec.idempotent ?? false,
        // Every tool talks only to MateCrew's own database.
        openWorldHint: false,
      },
    },
    async (
      args: z.infer<z.ZodObject<S>>,
      ctx: ServerContext,
    ): Promise<CallToolResult> => {
      try {
        const actor = await loadActor(actorIdFromAuth(ctx.http?.authInfo));
        const result = await run(args, { actor });
        return { content: [{ type: "text", text: encode(result) }] };
      } catch (error) {
        if (error instanceof McpToolError) {
          return toolError(error.message);
        }
        // Anything else is a bug or an outage. Keep the details in the server
        // logs — an internal message could leak schema or connection strings.
        console.error(`[mcp] tool ${spec.name} failed`, error);
        return toolError(
          "MateCrew hit an unexpected error handling that request. Try again, and tell the user to check the app if it keeps failing.",
        );
      }
    },
  );
}

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function encode(value: unknown): string {
  // `undefined` at the top level stringifies to undefined, not "null".
  return JSON.stringify(value, replacer) ?? "null";
}

/**
 * Makes Prisma values JSON-friendly: `Decimal` becomes a number (money here is
 * already rounded to cents, so float representation is not a concern), and
 * everything else falls through. `Date` needs no case — `toJSON` already yields
 * an ISO string.
 */
function replacer(_key: string, value: unknown): unknown {
  return isDecimal(value) ? value.toNumber() : value;
}

function isDecimal(value: unknown): value is { toNumber(): number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  );
}
