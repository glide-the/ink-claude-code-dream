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
      sdkVersion: "0.2.143";
      dreamObservedSdkVersion: "0.2.140";
      sdkModified: false;
    };
  };
  core: {
    package: "@anthropic-ai/claude-code";
    version: string;
    delivery: "external-not-bundled";
    execution: "unmodified-as-published";
    loadingReduction: 0;
  };
  protocol: {
    name: "claude-code-stream-json";
    version: 1;
    semantics: string;
  };
  commands: { headless: string; management: string[] };
  capabilityEvidence: string;
  contracts: {
    artifact: string;
    entrypointPolicy: string;
    runtimeData: string;
    bareProfile: string;
    licenses: string;
  };
  legalGate: {
    binary: "unmodified-as-published";
    authentication: "unaltered-opaque-pass-through";
    branding: "wrapper-is-not-Claude-Code";
  };
  mcpVersionsRegressed: string[];
  claudeCodeMcpChangelogVersions: string[];
  trustBoundary: string;
  [key: string]: unknown;
}

export interface LaunchResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}
