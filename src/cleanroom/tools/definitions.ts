// [Input] Anthropic Messages API tool-definition surface used by the clean-room model loop.
// [Output] Immutable JSON schemas for the minimum Dream Workspace/session tool set.
// [Pos] Declarative built-in tool inventory; execution and permissions live in separate modules.
// [Sync] 2026-08-24: add Dream-required MultiEdit/LS/notebook/todo/task/BashOutput tools.

export type CleanroomToolName =
  | "Read" | "Write" | "Edit" | "MultiEdit" | "Glob" | "Grep" | "LS"
  | "NotebookRead" | "TodoRead" | "TodoWrite"
  | "TaskCreate" | "TaskUpdate" | "TaskList" | "TaskGet"
  | "Bash" | "BashOutput";

export interface CleanroomToolDefinition {
  name: CleanroomToolName;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required: string[];
    additionalProperties: false;
  };
}

export const CLEANROOM_TOOL_DEFINITIONS: readonly CleanroomToolDefinition[] =
  Object.freeze([
    {
      name: "Read",
      description: "Read a UTF-8 text file inside the current Workspace.",
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          offset: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 10000 },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
    },
    {
      name: "Write",
      description: "Atomically write a UTF-8 text file inside the current Workspace.",
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          content: { type: "string" },
        },
        required: ["file_path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "Edit",
      description: "Atomically replace text in a UTF-8 Workspace file.",
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["file_path", "old_string", "new_string"],
        additionalProperties: false,
      },
    },
    {
      name: "Glob",
      description: "List Workspace paths matching a bounded glob pattern.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    {
      name: "Grep",
      description: "Search UTF-8 Workspace files with a JavaScript regular expression.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          glob: { type: "string" },
          head_limit: { type: "integer", minimum: 1, maximum: 10000 },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    {
      name: "Bash",
      description: "Run a bounded command from the canonical Workspace through a trusted sandbox.",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeout: { type: "integer", minimum: 1, maximum: 120000 },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    {
      name: "MultiEdit",
      description: "Apply an ordered set of exact text replacements to one Workspace file.",
      input_schema: { type: "object", properties: { file_path: { type: "string" }, edits: { type: "array" } }, required: ["file_path", "edits"], additionalProperties: false },
    },
    {
      name: "LS",
      description: "List one Workspace directory without following directory symlinks.",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: [], additionalProperties: false },
    },
    {
      name: "NotebookRead",
      description: "Read bounded source and outputs from a Workspace Jupyter notebook.",
      input_schema: { type: "object", properties: { notebook_path: { type: "string" } }, required: ["notebook_path"], additionalProperties: false },
    },
    {
      name: "TodoRead",
      description: "Read the current session's private todo list.",
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
    {
      name: "TodoWrite",
      description: "Replace the current session's private todo list.",
      input_schema: { type: "object", properties: { todos: { type: "array" } }, required: ["todos"], additionalProperties: false },
    },
    {
      name: "TaskCreate",
      description: "Create one durable task in the configured private task list.",
      input_schema: { type: "object", properties: { subject: { type: "string" }, description: { type: "string" }, activeForm: { type: "string" } }, required: ["subject"], additionalProperties: false },
    },
    {
      name: "TaskUpdate",
      description: "Update one durable task by id.",
      input_schema: { type: "object", properties: { taskId: { type: "string" }, status: { type: "string" }, subject: { type: "string" }, description: { type: "string" }, activeForm: { type: "string" }, owner: { type: "string" }, addBlockedBy: { type: "array" }, removeBlockedBy: { type: "array" } }, required: ["taskId"], additionalProperties: false },
    },
    {
      name: "TaskList",
      description: "List durable tasks in the configured private task list.",
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
    {
      name: "TaskGet",
      description: "Read one durable task by id.",
      input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"], additionalProperties: false },
    },
    {
      name: "BashOutput",
      description: "Read bounded output previously stored for a completed Bash tool call.",
      input_schema: { type: "object", properties: { bash_id: { type: "string" } }, required: ["bash_id"], additionalProperties: false },
    },
  ] satisfies CleanroomToolDefinition[]);

export const CLEANROOM_TOOL_NAMES = new Set<CleanroomToolName>(
  CLEANROOM_TOOL_DEFINITIONS.map((definition) => definition.name),
);

export function isCleanroomToolName(value: string): value is CleanroomToolName {
  return CLEANROOM_TOOL_NAMES.has(value as CleanroomToolName);
}
