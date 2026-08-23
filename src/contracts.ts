// [Input] Consume the checked-in Runtime-owned release manifest.
// [Output] Define stable internal shapes for diagnostics and supervised CLI launches.
// [Pos] Runtime implementation contract only; the unchanged Agent SDK never parses this schema.

export interface ReleaseManifest {
  schemaVersion: "ink-claude-cli-envelope/v1";
  runtime: {
    name: string;
    version: string;
    entrypoint: string;
    integration: {
      environment: "CLAUDE_CODE_CLI_PATH";
      sdkOption: "ClaudeAgentOptions.cli_path";
      sdkVersion: "0.2.140";
      sdkModified: false;
    };
  };
  core: {
    package: "@anthropic-ai/claude-code";
    version: string;
    delivery: "external-not-bundled";
    loadingReduction: 0;
  };
  protocol: {
    name: "claude-code-stream-json";
    version: 1;
    semantics: string;
  };
  commands: { headless: string; management: string[] };
  capabilityEvidence: string;
  mcpVersionsRegressed: string[];
  trustBoundary: string;
  [key: string]: unknown;
}

export interface LaunchResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}
