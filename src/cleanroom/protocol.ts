// [Input] SDK JSONL frames, clean-room session/extensions/MCP/tools services, and Anthropic Messages SSE events.
// [Output] Python-SDK-compatible lifecycle frames with durable resume, bounded tool turns, and MCP/OAuth management.
// [Pos] Single clean-room protocol state machine; feature modules are injected through narrow public APIs.
// [Sync] 2026-08-24: expose bounded initialization-stage diagnostics without leaking underlying errors.
// [Sync] 2026-08-28: route every provider turn through the authoritative Messages request builder.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages";
import type { RuntimeOptions } from "./argv.ts";
import {
  buildMessageRequest,
  resolveMessageRequestParameters,
  type MessageRequestParameters,
} from "./request.ts";
import {
  loadSkillCatalog,
  normalizeHookConfiguration,
  selectHookCallbackIds,
  type HookConfiguration,
  type SkillCatalog,
} from "./extensions/index.ts";
import {
  createMcpRegistryFromArgv,
  ListMcpResourcesTool,
  McpRegistry,
  ReadMcpResourceTool,
  type McpRegistryEntry,
} from "./mcp/index.ts";
import type { SandboxAdapter } from "./sandbox/sandbox.ts";
import { AnthropicSandboxAdapter } from "./sandbox/production.ts";
import {
  openSession,
  type SessionTranscript,
  validateClaudeCodeTmpdir,
} from "./session/index.ts";
import {
  loadRuntimeSettings,
  ProviderAuthentication,
  ProviderCredentialHelperError,
} from "./settings/index.ts";
import { CLEANROOM_TOOL_DEFINITIONS, isCleanroomToolName } from "./tools/definitions.ts";
import { dispatchCleanroomTool } from "./tools/dispatch.ts";
import {
  SdkPermissionChannel,
  ToolPermissionPolicy,
  type CleanroomPermissionMode,
} from "./tools/permissions.ts";
import { WorkspaceBoundary } from "./tools/workspace.ts";

type JsonObject = Record<string, unknown>;

interface ActiveTurn {
  controller: AbortController;
  promise: Promise<void>;
}

interface PendingRuntimeControl {
  reject: (error: Error) => void;
  resolve: (response: JsonObject) => void;
  timeout: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
}

export interface CleanroomProtocolDependencies {
  allowUntrustedSandboxForTests?: boolean;
  sandbox?: SandboxAdapter;
}

export type CleanroomInitializationStage =
  | "mcp"
  | "provider-auth"
  | "sandbox"
  | "session"
  | "tmpdir"
  | "workspace";

export class CleanroomInitializationError extends Error {
  readonly detail: string | undefined;
  readonly stage: CleanroomInitializationStage;

  constructor(stage: CleanroomInitializationStage, detail?: string) {
    super("Runtime initialization failed");
    this.name = "CleanroomInitializationError";
    this.stage = stage;
    this.detail = detail;
  }
}

async function initializeStage<T>(
  stage: CleanroomInitializationStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const detail = error instanceof ProviderCredentialHelperError
      ? `helper-${error.reason}`
      : undefined;
    throw new CleanroomInitializationError(stage, detail);
  }
}

interface MessageAccumulator {
  content: JsonObject[];
  id: string;
  model: string;
  role: "assistant";
  stop_reason: string | null;
  stop_sequence: string | null;
  type: "message";
  usage: JsonObject;
}

const EMPTY_SKILL_CATALOG: SkillCatalog = Object.freeze({
  content: Object.freeze({}),
  definitions: Object.freeze([]),
});

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeStatus(error: unknown): number | undefined {
  if (!isObject(error)) return undefined;
  const status = error.status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

function safeMcpEntries(entries: readonly McpRegistryEntry[]): JsonObject[] {
  return entries.map((entry) => ({
    name: entry.name,
    status: entry.status,
    type: entry.type,
    ...(entry.serverInfo ? { serverInfo: { ...entry.serverInfo } } : {}),
    tools: entry.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(isObject(tool.annotations) ? { annotations: { ...tool.annotations } } : {}),
    })),
    resources: entry.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      ...(resource.description ? { description: resource.description } : {}),
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    })),
    prompts: entry.prompts.map((prompt) => ({
      name: prompt.name,
      ...(prompt.description ? { description: prompt.description } : {}),
    })),
    ...(safeOAuth(entry.oauth) ? { oauth: safeOAuth(entry.oauth) } : {}),
    ...(entry.status === "failed" ? { error: "MCP server connection failed" } : {}),
    ...(entry.status === "needs-auth" ? { error: "MCP server authentication required" } : {}),
  }));
}

function safeOAuth(oauth: McpRegistryEntry["oauth"]): JsonObject | undefined {
  if (!oauth || typeof oauth.state !== "string" || oauth.state.length < 16 || oauth.state.length > 512) {
    return undefined;
  }
  try {
    const url = new URL(oauth.authorizationUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return { authorizationUrl: url.href, state: oauth.state };
  } catch {
    return undefined;
  }
}

function splitToolRules(values: readonly string[]): string[] {
  return values.flatMap((value) => value.split(",").map((rule) => rule.trim()).filter(Boolean));
}

function matchesToolRule(toolName: string, rule: string): boolean {
  const normalized = rule.trim();
  if (normalized === toolName || normalized === `${toolName}(*)`) return true;
  if (normalized.endsWith("*") && toolName.startsWith(normalized.slice(0, -1))) return true;
  return normalized.startsWith(`${toolName}(`) && normalized.endsWith(")");
}

function permissionMode(value: string): CleanroomPermissionMode {
  if (["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"].includes(value)) {
    return value as CleanroomPermissionMode;
  }
  throw new Error("unsupported permission mode");
}

function toolUseBlocks(content: readonly JsonObject[]): JsonObject[] {
  return content.filter(
    (block) =>
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string" &&
      isObject(block.input),
  );
}

function mergeUsage(total: JsonObject, current: JsonObject): JsonObject {
  const merged = { ...total };
  for (const [name, value] of Object.entries(current)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      merged[name] = (typeof merged[name] === "number" ? (merged[name] as number) : 0) + value;
    } else if (!(name in merged)) {
      merged[name] = value;
    }
  }
  return merged;
}

function skillNamesFromAllowedTools(values: readonly string[]): string[] {
  const names = new Set<string>();
  for (const value of values) {
    for (const rule of value.split(",")) {
      const match = /^Skill\(([^)]+)\)$/.exec(rule.trim());
      if (match) names.add(match[1]);
    }
  }
  return [...names];
}

function initializeSkillNames(request: JsonObject, options: RuntimeOptions): string[] {
  if (request.skills === undefined || request.skills === null) {
    return skillNamesFromAllowedTools(options.allowedTools);
  }
  if (!Array.isArray(request.skills) || request.skills.some((name) => typeof name !== "string")) {
    throw new Error("initialize skills must be an array of names");
  }
  return [...new Set(request.skills as string[])];
}

function normalizeUserContent(content: unknown): string | JsonObject[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw new Error("user message content must be a string or content-block array");
  }
  const blocks = content.filter(isObject);
  if (blocks.length !== content.length) {
    throw new Error("user message contains an invalid content block");
  }
  return blocks;
}

function textFromContent(content: JsonObject[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

function emptyMessage(model: string): MessageAccumulator {
  return {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    content: [],
    model,
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function applyStreamEvent(message: MessageAccumulator, event: JsonObject): void {
  switch (event.type) {
    case "message_start": {
      if (!isObject(event.message)) break;
      const started = event.message;
      if (typeof started.id === "string") message.id = started.id;
      if (typeof started.model === "string") message.model = started.model;
      if (Array.isArray(started.content)) {
        message.content = started.content.filter(isObject);
      }
      if (isObject(started.usage)) message.usage = { ...started.usage };
      break;
    }
    case "content_block_start": {
      if (typeof event.index !== "number" || !isObject(event.content_block)) break;
      message.content[event.index] = { ...event.content_block };
      break;
    }
    case "content_block_delta": {
      if (typeof event.index !== "number" || !isObject(event.delta)) break;
      const block = message.content[event.index];
      if (!block) break;
      const delta = event.delta;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        block.text = `${typeof block.text === "string" ? block.text : ""}${delta.text}`;
      } else if (
        delta.type === "thinking_delta" &&
        typeof delta.thinking === "string"
      ) {
        block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${delta.thinking}`;
      } else if (
        delta.type === "signature_delta" &&
        typeof delta.signature === "string"
      ) {
        block.signature = `${typeof block.signature === "string" ? block.signature : ""}${delta.signature}`;
      } else if (
        delta.type === "input_json_delta" &&
        typeof delta.partial_json === "string"
      ) {
        const partial = `${typeof block.__partialInputJson === "string" ? block.__partialInputJson : ""}${delta.partial_json}`;
        block.__partialInputJson = partial;
        try {
          const parsed: unknown = JSON.parse(partial);
          if (isObject(parsed)) block.input = parsed;
        } catch {
          // Partial JSON is expected until content_block_stop.
        }
      }
      break;
    }
    case "content_block_stop": {
      if (typeof event.index !== "number") break;
      const block = message.content[event.index];
      if (!block || typeof block.__partialInputJson !== "string") break;
      try {
        const parsed: unknown = JSON.parse(block.__partialInputJson);
        if (!isObject(parsed)) throw new Error("tool input must be an object");
        block.input = parsed;
      } finally {
        delete block.__partialInputJson;
      }
      break;
    }
    case "message_delta": {
      if (isObject(event.delta)) {
        if (typeof event.delta.stop_reason === "string") {
          message.stop_reason = event.delta.stop_reason;
        }
        if (typeof event.delta.stop_sequence === "string") {
          message.stop_sequence = event.delta.stop_sequence;
        }
      }
      if (isObject(event.usage)) message.usage = { ...message.usage, ...event.usage };
      break;
    }
  }
}

export class CleanroomProtocol {
  readonly sessionId: string;
  private activeTurn: ActiveTurn | undefined;
  private readonly history: Array<{ role: "user" | "assistant"; content: unknown }>;
  private hookConfiguration: HookConfiguration = Object.freeze({});
  private initialized = false;
  private readonly mcpRegistry: McpRegistry;
  private outputTail: Promise<void> = Promise.resolve();
  private readonly pendingRuntimeControls = new Map<string, PendingRuntimeControl>();
  private readonly permissionChannel: SdkPermissionChannel;
  private readonly permissionPolicy: ToolPermissionPolicy;
  private readonly protocolDependencies: CleanroomProtocolDependencies;
  private readonly providerAuthentication: ProviderAuthentication;
  private readonly requestParameters: MessageRequestParameters;
  private skillCatalog: SkillCatalog = EMPTY_SKILL_CATALOG;
  private readonly tmpdirValidated: boolean;
  private readonly transcript: SessionTranscript | undefined;
  private turnTail: Promise<void> = Promise.resolve();
  private readonly workspace: WorkspaceBoundary;

  private constructor(
    private readonly options: RuntimeOptions,
    dependencies: {
      history: Array<{ role: "user" | "assistant"; content: unknown }>;
      mcpRegistry: McpRegistry;
      providerAuthentication: ProviderAuthentication;
      requestParameters: MessageRequestParameters;
      sessionId: string;
      tmpdirValidated: boolean;
      transcript?: SessionTranscript;
      workspace: WorkspaceBoundary;
      protocolDependencies?: CleanroomProtocolDependencies;
    },
  ) {
    this.sessionId = dependencies.sessionId;
    this.history = dependencies.history;
    this.mcpRegistry = dependencies.mcpRegistry;
    this.providerAuthentication = dependencies.providerAuthentication;
    this.requestParameters = dependencies.requestParameters;
    this.tmpdirValidated = dependencies.tmpdirValidated;
    this.transcript = dependencies.transcript;
    this.workspace = dependencies.workspace;
    this.protocolDependencies = dependencies.protocolDependencies ?? {};
    this.permissionChannel = new SdkPermissionChannel({ emit: (frame) => this.emit(frame) });
    this.permissionPolicy = new ToolPermissionPolicy({
      mode: permissionMode(options.permissionMode),
      allowedTools: splitToolRules(options.allowedTools),
      disallowedTools: splitToolRules(options.disallowedTools),
      prompter: this.permissionChannel,
    });
  }

  static async create(
    options: RuntimeOptions,
    argv: string[],
    protocolDependencies: CleanroomProtocolDependencies = {},
  ): Promise<CleanroomProtocol> {
    if (options.sessionId && options.resume) {
      throw new Error("--session-id and --resume are mutually exclusive");
    }
    if (options.forkSession && !options.resume) {
      throw new Error("--fork-session requires --resume");
    }

    const cwd = process.cwd();
    const providerRuntime = await initializeStage("provider-auth", async () => {
      const settings = await loadRuntimeSettings(options.settings, cwd);
      const authentication = new ProviderAuthentication(settings);
      await authentication.prepare();
      return {
        authentication,
        requestParameters: resolveMessageRequestParameters({
          cliEffort: options.effort,
          environment: process.env,
          model: options.model,
          settingsEffort: settings.effortLevel,
        }),
      };
    });
    let tmpdirValidated = false;
    if (process.env.CLAUDE_CODE_TMPDIR) {
      await initializeStage("tmpdir", async () => {
        await validateClaudeCodeTmpdir({
          cwd,
          tmpdir: process.env.CLAUDE_CODE_TMPDIR!,
        });
      });
      tmpdirValidated = true;
    }

    let history: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    let sessionId = options.sessionId || randomUUID();
    let transcript: SessionTranscript | undefined;
    const configDir = process.env.CLAUDE_CONFIG_DIR;
    if (configDir) {
      const opened = await initializeStage("session", async () => {
        return await openSession({
          configDir,
          cwd,
          forkSession: options.forkSession,
          resume: options.resume,
          sessionId: options.sessionId,
        });
      });
      history = opened.history.map(({ role, content }) => ({ role, content }));
      sessionId = opened.transcript.id;
      transcript = opened.transcript;
    } else if (options.resume || options.forkSession) {
      throw new Error("resume requires an explicit CLAUDE_CONFIG_DIR");
    }

    const oauthConfigDir = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR || configDir;
    const oauthRedirectUrl =
      process.env.CLAUDE_CODE_MCP_OAUTH_REDIRECT_URL ||
      process.env.INK_CLAUDE_MCP_OAUTH_REDIRECT_URL ||
      "http://127.0.0.1:54545/callback";
    const mcpRegistry = await initializeStage("mcp", async () => {
      const registry = await createMcpRegistryFromArgv(argv, {
        clientName: "ink-claude-code-dream",
        clientVersion: "0.1.4",
        cwd,
        ...(oauthConfigDir
          ? {
              projectedOAuthIdentity: {
                configDir: oauthConfigDir,
                redirectUrl: oauthRedirectUrl,
              },
            }
          : {}),
      });
      await registry.connectAll();
      return registry;
    });
    const workspace = await initializeStage("workspace", async () => {
      return await WorkspaceBoundary.create(cwd);
    });
    let sandbox = protocolDependencies.sandbox;
    if (!sandbox && tmpdirValidated && process.env.CLAUDE_CODE_TMPDIR) {
      try {
        sandbox = await initializeStage("sandbox", async () => {
          return await AnthropicSandboxAdapter.create({
            workspaceRoot: workspace.root,
            tmpdir: process.env.CLAUDE_CODE_TMPDIR!,
          });
        });
      } catch (error) {
        await mcpRegistry.close().catch(() => undefined);
        throw error;
      }
    }
    return new CleanroomProtocol(options, {
      history,
      mcpRegistry,
      providerAuthentication: providerRuntime.authentication,
      requestParameters: providerRuntime.requestParameters,
      sessionId,
      tmpdirValidated,
      workspace,
      protocolDependencies: {
        ...protocolDependencies,
        ...(sandbox ? { sandbox } : {}),
      },
      ...(transcript ? { transcript } : {}),
    });
  }

  async handleFrame(frame: unknown): Promise<void> {
    if (!isObject(frame) || typeof frame.type !== "string") {
      throw new Error("stdin frame must be a JSON object with a type");
    }
    if (frame.type === "control_request") {
      await this.handleControlRequest(frame);
      return;
    }
    if (frame.type === "user") {
      this.queueUserFrame(frame);
      return;
    }
    if (frame.type === "control_response") {
      if (this.permissionChannel.handleControlResponse(frame)) return;
      if (this.handleRuntimeControlResponse(frame)) return;
      return;
    }
    if (frame.type === "control_cancel_request") {
      const requestId = frame.request_id;
      if (typeof requestId === "string" && this.cancelRuntimeControl(requestId)) return;
      this.abortActiveTurn();
      return;
    }
    throw new Error(`unsupported stdin frame type: ${frame.type}`);
  }

  async drain(): Promise<void> {
    await this.turnTail;
    await this.outputTail;
  }

  async close(): Promise<void> {
    this.abortActiveTurn();
    this.permissionChannel.cancelAll();
    this.cancelRuntimeControls("Runtime closed");
    await this.drain();
    await Promise.all([
      this.mcpRegistry.close(),
      this.protocolDependencies.sandbox?.close?.(),
    ]);
  }

  abortActiveTurn(): void {
    this.activeTurn?.controller.abort();
  }

  private emit(frame: JsonObject): Promise<void> {
    const line = `${JSON.stringify(frame)}\n`;
    this.outputTail = this.outputTail.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const onError = (error: Error): void => {
            process.stdout.off("error", onError);
            reject(error);
          };
          process.stdout.once("error", onError);
          const done = (): void => {
            process.stdout.off("error", onError);
            resolve();
          };
          if (process.stdout.write(line)) done();
          else process.stdout.once("drain", done);
        }),
    );
    return this.outputTail;
  }

  private requestSdkControl(request: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
    if (signal?.aborted) return Promise.reject(new Error("SDK control request was cancelled"));
    const requestId = `runtime_${randomUUID()}`;
    return new Promise<JsonObject>((resolve, reject) => {
      const pending: PendingRuntimeControl = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.cancelRuntimeControl(requestId);
          void this.emit({ type: "control_cancel_request", request_id: requestId });
          reject(new Error("SDK control response timed out"));
        }, 60_000),
        signal,
      };
      if (signal) {
        pending.onAbort = () => {
          if (!this.cancelRuntimeControl(requestId)) return;
          void this.emit({ type: "control_cancel_request", request_id: requestId });
          reject(new Error("SDK control request was cancelled"));
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pendingRuntimeControls.set(requestId, pending);
      void this.emit({ type: "control_request", request_id: requestId, request }).catch((error) => {
        if (!this.cancelRuntimeControl(requestId)) return;
        reject(error instanceof Error ? error : new Error("SDK control request failed"));
      });
    });
  }

  private handleRuntimeControlResponse(frame: JsonObject): boolean {
    if (!isObject(frame.response) || typeof frame.response.request_id !== "string") return false;
    const pending = this.pendingRuntimeControls.get(frame.response.request_id);
    if (!pending) return false;
    this.clearRuntimeControl(frame.response.request_id, pending);
    if (frame.response.subtype === "success" && isObject(frame.response.response)) {
      pending.resolve(frame.response.response);
    } else {
      pending.reject(new Error("SDK control callback failed"));
    }
    return true;
  }

  private cancelRuntimeControl(requestId: string): boolean {
    const pending = this.pendingRuntimeControls.get(requestId);
    if (!pending) return false;
    this.clearRuntimeControl(requestId, pending);
    pending.reject(new Error("SDK control request was cancelled"));
    return true;
  }

  private cancelRuntimeControls(reason: string): void {
    for (const [requestId, pending] of this.pendingRuntimeControls) {
      this.clearRuntimeControl(requestId, pending);
      pending.reject(new Error(reason));
    }
  }

  private clearRuntimeControl(requestId: string, pending: PendingRuntimeControl): void {
    clearTimeout(pending.timeout);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    this.pendingRuntimeControls.delete(requestId);
  }

  private async handleControlRequest(frame: JsonObject): Promise<void> {
    const requestId = frame.request_id;
    const request = frame.request;
    if (typeof requestId !== "string" || !isObject(request)) {
      throw new Error("control_request requires request_id and request");
    }
    try {
      const subtype = request.subtype;
      if (subtype === "initialize") {
        if (!this.initialized) {
          await this.prepareExtensions(request);
        }
        await this.emitControlSuccess(requestId, {
          commands: [],
          output_style: "default",
          available_output_styles: [],
          models: [
            {
              value: this.options.model,
              displayName: this.options.model,
              description: "",
            },
          ],
          account: null,
          skills: this.skillCatalog.definitions,
          mcpServers: safeMcpEntries(this.mcpRegistry.status()),
        });
        if (!this.initialized) {
          this.initialized = true;
          await this.emitSystemInit();
        }
        return;
      }
      if (subtype === "interrupt") {
        this.abortActiveTurn();
        await this.emitControlSuccess(requestId, {});
        return;
      }
      if (subtype === "set_permission_mode") {
        if (typeof request.mode !== "string") throw new Error("invalid permission mode");
        this.permissionPolicy.setMode(permissionMode(request.mode));
        await this.emitControlSuccess(requestId, {});
        return;
      }
      if (subtype === "mcp_status") {
        await this.emitControlSuccess(requestId, {
          mcpServers: safeMcpEntries(this.mcpRegistry.status()),
        });
        return;
      }
      if (subtype === "mcp_toggle") {
        if (typeof request.serverName !== "string" || typeof request.enabled !== "boolean") {
          throw new Error("invalid MCP toggle request");
        }
        await this.mcpRegistry.toggle(request.serverName, request.enabled);
        await this.emitControlSuccess(requestId, {});
        return;
      }
      if (subtype === "mcp_reconnect") {
        if (typeof request.serverName !== "string") {
          throw new Error("invalid MCP reconnect request");
        }
        await this.mcpRegistry.reconnect(request.serverName);
        await this.emitControlSuccess(requestId, {});
        return;
      }
      if (subtype === "mcp_finish_auth") {
        if (
          typeof request.serverName !== "string" ||
          typeof request.code !== "string" ||
          typeof request.state !== "string"
        ) {
          throw new Error("invalid MCP OAuth callback");
        }
        const entry = await this.mcpRegistry.finishAuth(request.serverName, {
          code: request.code,
          state: request.state,
        });
        await this.emitControlSuccess(requestId, {
          mcpServer: safeMcpEntries([entry])[0],
        });
        return;
      }
      if (subtype === "mcp_logout") {
        if (typeof request.serverName !== "string") {
          throw new Error("invalid MCP OAuth logout request");
        }
        const entry = await this.mcpRegistry.logoutOAuth(request.serverName);
        await this.emitControlSuccess(requestId, {
          mcpServer: safeMcpEntries([entry])[0],
        });
        return;
      }
      await this.emitControlError(requestId, "unsupported control request");
    } catch {
      await this.emitControlError(requestId, "control request failed");
    }
  }

  private emitControlError(requestId: string, error: string): Promise<void> {
    return this.emit({
      type: "control_response",
      response: {
        subtype: "error",
        request_id: requestId,
        error,
      },
    });
  }

  private emitControlSuccess(requestId: string, response: JsonObject): Promise<void> {
    return this.emit({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    });
  }

  private async prepareExtensions(request: JsonObject): Promise<void> {
    this.hookConfiguration = normalizeHookConfiguration(request.hooks);
    this.skillCatalog = await loadSkillCatalog({
      allowedSkills: initializeSkillNames(request, this.options),
      cwd: process.cwd(),
      pluginDirectories: this.options.pluginDirectories,
    });
  }

  private emitSystemInit(): Promise<void> {
    const mcpServers = safeMcpEntries(this.mcpRegistry.status());
    return this.emit({
      type: "system",
      subtype: "init",
      cwd: process.cwd(),
      session_id: this.sessionId,
      tools: this.modelToolDefinitions().map((tool) => tool.name),
      mcp_servers: mcpServers,
      skills: this.skillCatalog.definitions,
      hooks: Object.keys(this.hookConfiguration),
      claude_code_tmpdir_validated: this.tmpdirValidated,
      model: this.options.model,
      permissionMode: this.options.permissionMode,
      apiKeySource: this.providerAuthentication.source(),
      claude_code_version: "2.1.241",
      output_style: "default",
      uuid: randomUUID(),
    });
  }

  private queueUserFrame(frame: JsonObject): void {
    const promise = this.turnTail.then(() => this.executeTurn(frame));
    this.turnTail = promise.catch(async (error: unknown) => {
      const status = safeStatus(error);
      await this.emitResult({
        durationMs: 0,
        durationApiMs: 0,
        isError: true,
        result: status ? `Provider request failed (HTTP ${status})` : "Provider request failed",
        stopReason: null,
        terminalReason: "api_error",
        usage: {},
        ...(status ? { apiErrorStatus: status } : {}),
      });
    });
  }

  private async systemPrompt(): Promise<string | undefined> {
    const parts: string[] = [];
    if (this.options.systemPromptFile) {
      parts.push(await readFile(this.options.systemPromptFile, "utf8"));
    }
    if (this.options.systemPrompt) parts.push(this.options.systemPrompt);
    parts.push(...this.options.appendSystemPrompt.filter(Boolean));
    const joined = parts.join("\n\n");
    return joined || undefined;
  }

  private modelToolDefinitions(): JsonObject[] {
    const definitions: JsonObject[] = CLEANROOM_TOOL_DEFINITIONS.map((definition) => ({
      ...definition,
      input_schema: { ...definition.input_schema },
    }));
    definitions.push(...this.mcpRegistry.modelTools().map((tool) => ({ ...tool })));
    if (this.mcpRegistry.listResources().length > 0) {
      definitions.push(
        { ...new ListMcpResourcesTool(this.mcpRegistry).definition },
        { ...new ReadMcpResourceTool(this.mcpRegistry).definition },
      );
    }
    if (this.skillCatalog.definitions.length > 0) {
      definitions.push({
        name: "Skill",
        description: "Load one explicitly allowed project or plugin Skill when it is needed.",
        input_schema: {
          type: "object",
          properties: {
            skill: {
              type: "string",
              enum: this.skillCatalog.definitions.map(({ name }) => name),
            },
          },
          required: ["skill"],
          additionalProperties: false,
        },
      });
    }
    const explicitlySelected = this.options.tools;
    const disallowed = splitToolRules(this.options.disallowedTools);
    return definitions.filter((definition) => {
      const name = definition.name;
      if (typeof name !== "string") return false;
      if (explicitlySelected && !explicitlySelected.some((rule) => matchesToolRule(name, rule))) {
        return false;
      }
      return !disallowed.some((rule) => matchesToolRule(name, rule));
    });
  }

  private async runToolHooks(input: {
    event: "PreToolUse" | "PostToolUse";
    toolInput: JsonObject;
    toolName: string;
    toolResult?: unknown;
    toolUseId: string;
    signal: AbortSignal;
  }): Promise<{
    denied?: string;
    permissionGranted?: boolean;
    toolInput: JsonObject;
    toolResult?: unknown;
  }> {
    let toolInput = input.toolInput;
    let toolResult = input.toolResult;
    let permissionGranted = false;
    for (const callbackId of selectHookCallbackIds(
      this.hookConfiguration,
      input.event,
      input.toolName,
    )) {
      const response = await this.requestSdkControl(
        {
          subtype: "hook_callback",
          callback_id: callbackId,
          tool_use_id: input.toolUseId,
          input: {
            session_id: this.sessionId,
            cwd: this.workspace.root,
            hook_event_name: input.event,
            tool_name: input.toolName,
            tool_input: toolInput,
            tool_use_id: input.toolUseId,
            ...(input.event === "PostToolUse" ? { tool_response: toolResult } : {}),
          },
        },
        input.signal,
      );
      if (response.continue === false || response.decision === "block") {
        return { denied: "Tool use was blocked by an SDK hook", toolInput, toolResult };
      }
      const hookOutput = response.hookSpecificOutput;
      if (!isObject(hookOutput)) continue;
      if (input.event === "PreToolUse") {
        if (hookOutput.permissionDecision === "deny") {
          return { denied: "Tool use was denied by an SDK hook", toolInput, toolResult };
        }
        if (hookOutput.permissionDecision === "allow") permissionGranted = true;
        if (isObject(hookOutput.updatedInput)) toolInput = hookOutput.updatedInput;
      } else if (hookOutput.updatedMCPToolOutput !== undefined) {
        toolResult = hookOutput.updatedMCPToolOutput;
      }
    }
    return {
      toolInput,
      toolResult,
      ...(permissionGranted ? { permissionGranted: true } : {}),
    };
  }

  private async executeToolUse(block: JsonObject, signal: AbortSignal): Promise<JsonObject> {
    const toolUseId = block.id as string;
    const toolName = block.name as string;
    const originalInput = block.input as JsonObject;
    let before: Awaited<ReturnType<CleanroomProtocol["runToolHooks"]>>;
    try {
      before = await this.runToolHooks({
        event: "PreToolUse",
        toolInput: originalInput,
        toolName,
        toolUseId,
        signal,
      });
    } catch {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "SDK hook callback failed",
        is_error: true,
      };
    }
    if (before.denied) {
      return {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: before.denied,
        is_error: true,
      };
    }

    let approvedInput = before.toolInput;
    if (!isCleanroomToolName(toolName) && before.permissionGranted !== true) {
      const permission = await this.permissionPolicy.authorize({
        toolName,
        input: approvedInput,
        toolUseId,
        signal,
      });
      if (permission.behavior === "deny") {
        return {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: permission.message || `${toolName} was denied`,
          is_error: true,
        };
      }
      approvedInput = permission.updatedInput;
    }

    let content: unknown;
    let isError = false;
    if (isCleanroomToolName(toolName)) {
      const result = await dispatchCleanroomTool(toolName, before.toolInput, toolUseId, {
        workspace: this.workspace,
        permissions: this.permissionPolicy,
        ...(before.permissionGranted === true ? { permissionGranted: true } : {}),
        signal,
        ...(this.protocolDependencies.sandbox
          ? { sandbox: this.protocolDependencies.sandbox }
          : {}),
        ...(this.protocolDependencies.allowUntrustedSandboxForTests === true
          ? { allowUntrustedSandboxForTests: true }
          : {}),
        ...(this.transcript
          ? { stateDirectory: this.transcript.file.slice(0, -".jsonl".length) }
          : {}),
      });
      content = result.content;
      isError = result.isError;
    } else if (toolName === "ListMcpResourcesTool") {
      content = (await new ListMcpResourcesTool(this.mcpRegistry).execute(
        approvedInput as { server?: string },
      )).content[0]?.text ?? "{}";
    } else if (toolName === "ReadMcpResourceTool") {
      const server = approvedInput.server;
      const uri = approvedInput.uri;
      if (typeof server !== "string" || typeof uri !== "string") {
        content = "ReadMcpResourceTool requires server and uri";
        isError = true;
      } else {
        content = (await new ReadMcpResourceTool(this.mcpRegistry).execute({ server, uri }))
          .content[0]?.text ?? "{}";
      }
    } else if (toolName === "Skill") {
      const skillName = approvedInput.skill;
      const skill = typeof skillName === "string" ? this.skillCatalog.content[skillName] : undefined;
      if (!skill) {
        content = "Requested Skill is not explicitly allowed";
        isError = true;
      } else {
        content = skill.markdown;
      }
    } else {
      try {
        const result = await this.mcpRegistry.callModelTool(toolName, approvedInput);
        content = JSON.stringify(result);
        isError = result.isError === true;
      } catch {
        content = "MCP tool call failed";
        isError = true;
      }
    }

    try {
      const after = await this.runToolHooks({
        event: "PostToolUse",
        toolInput: before.toolInput,
        toolName,
        toolResult: content,
        toolUseId,
        signal,
      });
      if (after.denied) {
        content = after.denied;
        isError = true;
      } else if (after.toolResult !== undefined && after.toolResult !== content) {
        content = typeof after.toolResult === "string"
          ? after.toolResult
          : JSON.stringify(after.toolResult);
      }
    } catch {
      content = "SDK hook callback failed";
      isError = true;
    }
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: typeof content === "string" ? content : JSON.stringify(content),
      ...(isError ? { is_error: true } : {}),
    };
  }

  private async executeTurn(frame: JsonObject): Promise<void> {
    if (!this.initialized) {
      this.initialized = true;
      await this.emitSystemInit();
    }
    if (!isObject(frame.message) || frame.message.role !== "user") {
      throw new Error("user frame requires message.role=user");
    }
    const userContent = normalizeUserContent(frame.message.content);
    const requestMessages = [
      ...this.history,
      { role: "user" as const, content: userContent },
    ];
    const turnRecords: Array<{ role: "user" | "assistant"; content: unknown }> = [
      { role: "user", content: userContent },
    ];
    const startedAt = performance.now();
    const controller = new AbortController();

    const run = (async (): Promise<void> => {
      let apiDurationMs = 0;
      let finalAccumulator = emptyMessage(this.options.model);
      let finalAssistantEmitted = false;
      let totalUsage: JsonObject = {};
      let turns = 0;
      try {
        const system = await this.systemPrompt();
        while (turns < this.options.maxTurns) {
          turns += 1;
          const accumulator = emptyMessage(this.options.model);
          finalAccumulator = accumulator;
          finalAssistantEmitted = false;
          const apiStartedAt = performance.now();
          const providerClient = await this.providerAuthentication.client();
          const stream = await providerClient.messages.create(
            buildMessageRequest({
              model: this.options.model,
              messages: requestMessages,
              parameters: this.requestParameters,
              system,
              tools: this.modelToolDefinitions(),
            }) as unknown as MessageCreateParamsStreaming,
            { signal: controller.signal },
          );
          const abortProviderStream = (): void => stream.controller.abort();
          controller.signal.addEventListener("abort", abortProviderStream, { once: true });
          try {
            for await (const rawEvent of stream) {
              const event = rawEvent as unknown as JsonObject;
              applyStreamEvent(accumulator, event);
              if (this.options.includePartialMessages) {
                await this.emit({
                  type: "stream_event",
                  uuid: randomUUID(),
                  session_id: this.sessionId,
                  event,
                  parent_tool_use_id: null,
                });
              }
            }
          } finally {
            controller.signal.removeEventListener("abort", abortProviderStream);
          }
          apiDurationMs += performance.now() - apiStartedAt;
          totalUsage = mergeUsage(totalUsage, accumulator.usage);

          // Some fetch implementations end an aborted response iterator cleanly
          // instead of throwing AbortError. The controller remains authoritative.
          if (controller.signal.aborted) break;

          await this.emitAssistant(accumulator);
          finalAssistantEmitted = true;
          requestMessages.push({ role: "assistant", content: accumulator.content });
          turnRecords.push({ role: "assistant", content: accumulator.content });
          const uses = toolUseBlocks(accumulator.content);
          if (uses.length === 0) {
            await this.persistTurn(turnRecords);
            const finishedAt = performance.now();
            await this.emitResult({
              durationMs: finishedAt - startedAt,
              durationApiMs: apiDurationMs,
              isError: false,
              numTurns: turns,
              result: textFromContent(accumulator.content),
              stopReason: accumulator.stop_reason,
              terminalReason: "completed",
              usage: totalUsage,
            });
            return;
          }

          if (turns >= this.options.maxTurns) {
            const finishedAt = performance.now();
            await this.emitResult({
              durationMs: finishedAt - startedAt,
              durationApiMs: apiDurationMs,
              isError: true,
              numTurns: turns,
              result: "Maximum tool turns reached",
              stopReason: accumulator.stop_reason,
              terminalReason: "max_turns",
              usage: totalUsage,
            });
            return;
          }

          const results: JsonObject[] = [];
          for (const use of uses) {
            if (controller.signal.aborted) break;
            results.push(await this.executeToolUse(use, controller.signal));
          }
          if (controller.signal.aborted) break;
          requestMessages.push({ role: "user", content: results });
          turnRecords.push({ role: "user", content: results });
          await this.emit({
            type: "user",
            message: { role: "user", content: results },
            parent_tool_use_id: null,
            session_id: this.sessionId,
            uuid: randomUUID(),
          });
        }

        const finishedAt = performance.now();
        if (
          finalAccumulator.content.length > 0 &&
          controller.signal.aborted &&
          !finalAssistantEmitted
        ) {
          // The partial assistant frame is useful to SDK consumers, but tool
          // results and callback payloads remain private to the provider loop.
          await this.emitAssistant(finalAccumulator);
        }
        await this.emitResult({
          durationMs: finishedAt - startedAt,
          durationApiMs: apiDurationMs,
          isError: false,
          numTurns: turns,
          result: textFromContent(finalAccumulator.content),
          stopReason: null,
          terminalReason: "aborted_streaming",
          usage: totalUsage,
        });
      } catch (error) {
        const finishedAt = performance.now();
        if (controller.signal.aborted) {
          if (finalAccumulator.content.length > 0 && !finalAssistantEmitted) {
            await this.emitAssistant(finalAccumulator);
          }
          await this.emitResult({
            durationMs: finishedAt - startedAt,
            durationApiMs: apiDurationMs,
            isError: false,
            numTurns: turns,
            result: textFromContent(finalAccumulator.content),
            stopReason: null,
            terminalReason: "aborted_streaming",
            usage: totalUsage,
          });
          return;
        }
        throw error;
      }
    })();

    this.activeTurn = { controller, promise: run };
    try {
      await run;
    } finally {
      if (this.activeTurn?.promise === run) this.activeTurn = undefined;
    }
  }

  private async persistTurn(
    records: readonly { role: "user" | "assistant"; content: unknown }[],
  ): Promise<void> {
    if (this.transcript) {
      for (const record of records) {
        await this.transcript.appendMessage(record.role, record.content);
      }
    }
    this.history.push(...records);
  }

  private emitAssistant(message: MessageAccumulator): Promise<void> {
    return this.emit({
      type: "assistant",
      message,
      parent_tool_use_id: null,
      session_id: this.sessionId,
      uuid: randomUUID(),
    });
  }

  private emitResult(input: {
    apiErrorStatus?: number;
    durationApiMs: number;
    durationMs: number;
    isError: boolean;
    numTurns?: number;
    result: string;
    stopReason: string | null;
    terminalReason: string;
    usage: JsonObject;
  }): Promise<void> {
    return this.emit({
      type: "result",
      subtype: "success",
      duration_ms: Math.max(0, Math.round(input.durationMs)),
      duration_api_ms: Math.max(0, Math.round(input.durationApiMs)),
      is_error: input.isError,
      num_turns: input.numTurns ?? 1,
      session_id: this.sessionId,
      stop_reason: input.stopReason,
      result: input.result,
      usage: input.usage,
      errors: [],
      uuid: randomUUID(),
      terminal_reason: input.terminalReason,
      ...(input.apiErrorStatus ? { api_error_status: input.apiErrorStatus } : {}),
    });
  }
}
