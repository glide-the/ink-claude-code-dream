// [Input] Tool request, permission mode/rules, and SDK control_response frames.
// [Output] Deterministic allow/deny decisions and SDK-compatible can_use_tool control requests.
// [Pos] Clean-room permission policy and bidirectional SDK permission bridge.
// [Sync] 2026-08-24: add fail-closed rule precedence, mode handling, timeout, and cancellation.

import { randomUUID } from "node:crypto";

type JsonObject = Record<string, unknown>;

export type CleanroomPermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk";

export interface PermissionDecisionAllow {
  behavior: "allow";
  updatedInput: JsonObject;
  updatedPermissions?: JsonObject[];
}

export interface PermissionDecisionDeny {
  behavior: "deny";
  message: string;
  interrupt?: boolean;
}

export type PermissionDecision = PermissionDecisionAllow | PermissionDecisionDeny;

export interface ToolPermissionRequest {
  toolName: string;
  input: JsonObject;
  toolUseId: string;
  signal?: AbortSignal;
  blockedPath?: string;
  decisionReason?: string;
  title?: string;
  displayName?: string;
  description?: string;
}

export interface PermissionPrompter {
  request(request: ToolPermissionRequest): Promise<PermissionDecision>;
}

export interface PermissionPolicyOptions {
  mode?: CleanroomPermissionMode;
  allowedTools?: readonly string[];
  disallowedTools?: readonly string[];
  prompter?: PermissionPrompter;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesWholeToolRule(toolName: string, rule: string): boolean {
  const normalized = rule.trim();
  if (normalized === toolName) return true;
  return normalized === `${toolName}(*)`;
}

function matchesDenyRule(toolName: string, rule: string): boolean {
  const normalized = rule.trim();
  return (
    matchesWholeToolRule(toolName, normalized) ||
    (normalized.startsWith(`${toolName}(`) && normalized.endsWith(")"))
  );
}

function deny(message: string): PermissionDecisionDeny {
  return { behavior: "deny", message };
}

const PLAN_READ_ONLY = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoRead", "TaskList", "TaskGet"]);
const EDIT_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoRead", "TaskList", "TaskGet", "Write", "Edit", "MultiEdit", "TodoWrite", "TaskCreate", "TaskUpdate"]);

export class ToolPermissionPolicy {
  private mode: CleanroomPermissionMode;
  private readonly allowedTools: readonly string[];
  private readonly disallowedTools: readonly string[];
  private readonly prompter: PermissionPrompter | undefined;

  constructor(options: PermissionPolicyOptions = {}) {
    this.mode = options.mode ?? "default";
    this.allowedTools = options.allowedTools ?? [];
    this.disallowedTools = options.disallowedTools ?? [];
    this.prompter = options.prompter;
  }

  setMode(mode: CleanroomPermissionMode): void {
    this.mode = mode;
  }

  async authorize(request: ToolPermissionRequest): Promise<PermissionDecision> {
    if (!request.toolUseId) return deny("tool_use_id is required for permission decisions");
    if (request.signal?.aborted) return deny("tool permission request was cancelled");

    if (this.disallowedTools.some((rule) => matchesDenyRule(request.toolName, rule))) {
      return deny(`${request.toolName} is explicitly disallowed`);
    }
    if (this.allowedTools.some((rule) => matchesWholeToolRule(request.toolName, rule))) {
      return { behavior: "allow", updatedInput: request.input };
    }
    if (this.mode === "bypassPermissions") {
      return { behavior: "allow", updatedInput: request.input };
    }
    if (this.mode === "plan") {
      return PLAN_READ_ONLY.has(request.toolName)
        ? { behavior: "allow", updatedInput: request.input }
        : deny(`${request.toolName} is unavailable in plan mode`);
    }
    if (this.mode === "acceptEdits" && EDIT_TOOLS.has(request.toolName)) {
      return { behavior: "allow", updatedInput: request.input };
    }
    if (this.mode === "dontAsk") {
      return deny(`${request.toolName} requires permission and dontAsk mode forbids prompting`);
    }
    if (!this.prompter) {
      return deny(`${request.toolName} requires permission but no SDK callback is connected`);
    }
    return await this.prompter.request(request);
  }
}

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
  originalInput: JsonObject;
}

export interface SdkPermissionChannelOptions {
  emit: (frame: JsonObject) => void | Promise<void>;
  timeoutMs?: number;
}

export class SdkPermissionChannel implements PermissionPrompter {
  private readonly options: SdkPermissionChannelOptions;
  private readonly pending = new Map<string, PendingPermission>();
  private readonly timeoutMs: number;

  constructor(options: SdkPermissionChannelOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("SDK permission timeout must be a positive integer");
    }
  }

  async request(request: ToolPermissionRequest): Promise<PermissionDecision> {
    if (request.signal?.aborted) return deny("tool permission request was cancelled");
    const requestId = `permission_${randomUUID()}`;
    const response = new Promise<PermissionDecision>((resolve, reject) => {
      const pending: PendingPermission = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.cancelSdkRequest(requestId);
          this.clearPending(requestId, pending);
          reject(new Error("SDK can_use_tool response timed out"));
        }, this.timeoutMs),
        signal: request.signal,
        originalInput: request.input,
      };
      if (request.signal) {
        pending.onAbort = () => {
          this.cancelSdkRequest(requestId);
          this.clearPending(requestId, pending);
          resolve(deny("tool permission request was cancelled"));
        };
        request.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pending.set(requestId, pending);
    });

    try {
      await this.options.emit({
        type: "control_request",
        request_id: requestId,
        request: {
          subtype: "can_use_tool",
          tool_name: request.toolName,
          input: request.input,
          permission_suggestions: [],
          blocked_path: request.blockedPath ?? null,
          ...(request.decisionReason ? { decision_reason: request.decisionReason } : {}),
          ...(request.title ? { title: request.title } : {}),
          ...(request.displayName ? { display_name: request.displayName } : {}),
          ...(request.description ? { description: request.description } : {}),
          tool_use_id: request.toolUseId,
        },
      });
    } catch (error: unknown) {
      this.rejectPending(requestId, error instanceof Error ? error : new Error(String(error)));
    }
    return await response;
  }

  handleControlResponse(frame: unknown): boolean {
    if (!isObject(frame) || frame.type !== "control_response" || !isObject(frame.response)) {
      return false;
    }
    const requestId = frame.response.request_id;
    if (typeof requestId !== "string") return false;
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.clearPending(requestId, pending);

    if (frame.response.subtype === "error") {
      pending.reject(new Error(String(frame.response.error ?? "SDK permission callback failed")));
      return true;
    }
    const response = frame.response.response;
    if (!isObject(response)) {
      pending.reject(new Error("SDK can_use_tool response is missing a decision"));
      return true;
    }
    if (response.behavior === "allow") {
      const updatedInput = isObject(response.updatedInput)
        ? response.updatedInput
        : pending.originalInput;
      pending.resolve({
        behavior: "allow",
        updatedInput,
        ...(Array.isArray(response.updatedPermissions)
          ? { updatedPermissions: response.updatedPermissions.filter(isObject) }
          : {}),
      });
      return true;
    }
    if (response.behavior === "deny") {
      pending.resolve({
        behavior: "deny",
        message: typeof response.message === "string" ? response.message : "Tool use denied",
        ...(response.interrupt === true ? { interrupt: true } : {}),
      });
      return true;
    }
    pending.reject(new Error("SDK can_use_tool returned an unsupported behavior"));
    return true;
  }

  cancelAll(reason = "SDK permission channel closed"): void {
    for (const [requestId, pending] of this.pending) {
      this.clearPending(requestId, pending);
      pending.reject(new Error(reason));
    }
  }

  private rejectPending(requestId: string, error: Error): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.clearPending(requestId, pending);
    pending.reject(error);
  }

  private clearPending(requestId: string, pending: PendingPermission): void {
    clearTimeout(pending.timeout);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    this.pending.delete(requestId);
  }

  private cancelSdkRequest(requestId: string): void {
    void Promise.resolve(
      this.options.emit({ type: "control_cancel_request", request_id: requestId }),
    ).catch(() => undefined);
  }
}
