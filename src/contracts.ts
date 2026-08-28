// [Input] Consume the checked-in Runtime-owned release manifest.
// [Output] Define stable internal shapes for diagnostics and supervised CLI launches.
// [Pos] Runtime implementation contract only; Dream's locked SDK distribution never parses this schema.
// [Sync] 2026-08-24: align current Dream SDK observation with ink-claude-dream-agent-sdk 0.2.144.
// [Sync] 2026-08-26: pair Runtime 0.1.2 with downstream SDK 0.2.144.

export interface ReleaseManifest {
  schemaVersion: "ink-claude-cli-envelope/v1";
  runtime: {
    name: string;
    version: string;
    entrypoint: string;
    integration: {
      environment: "CLAUDE_CODE_CLI_PATH";
      sdkOption: "ClaudeAgentOptions.cli_path";
      sdkDistribution: "ink-claude-dream-agent-sdk";
      sdkVersion: "0.2.144";
      dreamObservedSdkVersion: "0.2.144";
      sdkModified: false;
    };
  };
  core: {
    package: "@anthropic-ai/claude-code";
    version: string;
    delivery: "external-not-bundled";
    execution: "unmodified-as-published";
    loadingReduction: 0;
    corePruned: false;
    productionEligible: false;
    blockingReasons: string[];
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
    pruningDecision: string;
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
