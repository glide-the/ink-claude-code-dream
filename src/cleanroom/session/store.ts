// [Input] Validated config/cwd roots, SDK session-id/resume/fork selectors, and message records.
// [Output] Dream/SDK-readable private JSONL transcripts plus restored provider history.
// [Pos] Clean-room session identity and transcript persistence implementation.
// [Sync] 2026-08-24: persist public Claude transcript message envelopes with UUID parent chains.

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, link, lstat, open, rm } from "node:fs/promises";
import path from "node:path";
import { prepareProjectTranscriptDirectory } from "./paths.ts";

const PRIVATE_FILE_MODE = 0o600;
const MAX_RECORD_BYTES = 1_048_576;
const MAX_TRANSCRIPT_BYTES = 67_108_864;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SessionMessage {
  content: unknown;
  role: "assistant" | "user";
}

interface TranscriptMessageRecord {
  cwd: string;
  message: SessionMessage;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  type: SessionMessage["role"];
  uuid: string;
}

export interface SessionSelection {
  configDir: string;
  cwd: string;
  forkSession?: boolean;
  generateId?: () => string;
  resume?: string;
  sessionId?: string;
}

function fileFlags(base: number): number {
  return base | (fsConstants.O_NOFOLLOW ?? 0);
}

function encodeRecord(record: TranscriptMessageRecord): Buffer {
  if (
    !record ||
    (record.type !== "user" && record.type !== "assistant") ||
    !record.message ||
    record.message.role !== record.type ||
    typeof record.uuid !== "string" ||
    typeof record.sessionId !== "string"
  ) {
    throw new Error("transcript records must be user or assistant messages");
  }
  const encoded = JSON.stringify(record);
  if (encoded === undefined) throw new Error("transcript record is not JSON serializable");
  const bytes = Buffer.from(`${encoded}\n`, "utf8");
  if (bytes.byteLength > MAX_RECORD_BYTES) {
    throw new Error("transcript record exceeds the 1 MiB limit");
  }
  return bytes;
}

function decodeTranscript(bytes: Buffer): TranscriptMessageRecord[] {
  if (bytes.byteLength === 0) return [];
  if (bytes.at(-1) !== 0x0a) throw new Error("transcript contains an incomplete JSONL record");
  const records: TranscriptMessageRecord[] = [];
  for (const line of bytes.toString("utf8").split("\n")) {
    if (!line) continue;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      throw new Error("transcript contains invalid JSONL");
    }
    if (
      !decoded ||
      typeof decoded !== "object" ||
      ((decoded as TranscriptMessageRecord).type !== "user" &&
        (decoded as TranscriptMessageRecord).type !== "assistant") ||
      !(decoded as TranscriptMessageRecord).message ||
      (decoded as TranscriptMessageRecord).message.role !==
        (decoded as TranscriptMessageRecord).type ||
      typeof (decoded as TranscriptMessageRecord).uuid !== "string"
    ) {
      throw new Error("transcript contains an invalid message record");
    }
    records.push(decoded as TranscriptMessageRecord);
  }
  return records;
}

async function requirePrivateRegularFile(file: string): Promise<void> {
  const status = await lstat(file).catch(() => undefined);
  if (!status?.isFile() || status.isSymbolicLink()) {
    throw new Error("session transcript must be a real regular file");
  }
  if ((status.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new Error("session transcript permissions must be 0600");
  }
}

async function writeExactly(handle: Awaited<ReturnType<typeof open>>, bytes: Buffer): Promise<void> {
  const result = await handle.write(bytes, 0, bytes.byteLength, null);
  if (result.bytesWritten !== bytes.byteLength) {
    throw new Error("short transcript write");
  }
}

function transcriptRecords(
  id: string,
  cwd: string,
  messages: readonly SessionMessage[],
): TranscriptMessageRecord[] {
  let parentUuid: string | null = null;
  return messages.map((message) => {
    const uuid = randomUUID();
    const record: TranscriptMessageRecord = {
      type: message.role,
      uuid,
      parentUuid,
      sessionId: id,
      timestamp: new Date().toISOString(),
      cwd,
      message: structuredClone(message),
    };
    parentUuid = uuid;
    return record;
  });
}

async function createExclusive(
  file: string,
  records: readonly TranscriptMessageRecord[],
): Promise<void> {
  const bytes = Buffer.concat(records.map(encodeRecord));
  if (bytes.byteLength > MAX_TRANSCRIPT_BYTES) {
    throw new Error("transcript exceeds the 64 MiB limit");
  }
  const temporary = path.join(
    path.dirname(file),
    `.session-${process.pid}-${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      fileFlags(fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY),
      PRIVATE_FILE_MODE,
    );
    await chmod(temporary, PRIVATE_FILE_MODE);
    if (bytes.byteLength > 0) await writeExactly(handle, bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new Error("session transcript already exists");
      throw error;
    });
    await requirePrivateRegularFile(file);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

export function validateSessionId(value: string): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value !== value.normalize("NFC") ||
    !UUID_PATTERN.test(value)
  ) {
    throw new Error("session id must be a canonical UUID");
  }
  return value.toLowerCase();
}

export class SessionTranscript {
  readonly file: string;
  readonly id: string;
  private readonly cwd: string;
  private operationTail: Promise<void> = Promise.resolve();

  private lastUuid: string | null;

  constructor(
    id: string,
    file: string,
    cwd: string,
    lastUuid: string | null = null,
  ) {
    this.id = id;
    this.file = file;
    this.cwd = cwd;
    this.lastUuid = lastUuid;
  }

  appendMessage(role: SessionMessage["role"], content: unknown): Promise<void> {
    return this.append({ role, content });
  }

  append(record: SessionMessage): Promise<void> {
    return this.serialize(async () => {
      const uuid = randomUUID();
      const stored: TranscriptMessageRecord = {
        type: record.role,
        uuid,
        parentUuid: this.lastUuid,
        sessionId: this.id,
        timestamp: new Date().toISOString(),
        cwd: this.cwd,
        message: structuredClone(record),
      };
      const bytes = encodeRecord(stored);
      await requirePrivateRegularFile(this.file);
      const handle = await open(
        this.file,
        fileFlags(fsConstants.O_APPEND | fsConstants.O_WRONLY),
      );
      try {
        const status = await handle.stat();
        if (!status.isFile() || status.size + bytes.byteLength > MAX_TRANSCRIPT_BYTES) {
          throw new Error("transcript exceeds the 64 MiB limit");
        }
        await writeExactly(handle, bytes);
        await handle.sync();
        this.lastUuid = uuid;
      } finally {
        await handle.close();
      }
    });
  }

  readMessages(): Promise<SessionMessage[]> {
    return this.serialize(async () => {
      await requirePrivateRegularFile(this.file);
      const handle = await open(this.file, fileFlags(fsConstants.O_RDONLY));
      try {
        const status = await handle.stat();
        if (!status.isFile() || status.size > MAX_TRANSCRIPT_BYTES) {
          throw new Error("transcript exceeds the 64 MiB limit");
        }
        const snapshot = Buffer.alloc(status.size);
        let offset = 0;
        while (offset < snapshot.byteLength) {
          const { bytesRead } = await handle.read(
            snapshot,
            offset,
            snapshot.byteLength - offset,
            offset,
          );
          if (bytesRead === 0) throw new Error("transcript changed during snapshot read");
          offset += bytesRead;
        }
        return decodeTranscript(snapshot).map((record) => structuredClone(record.message));
      } finally {
        await handle.close();
      }
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

async function unusedSessionId(
  directory: string,
  generateId: () => string,
  excluded?: string,
): Promise<string> {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = validateSessionId(generateId());
    if (candidate === excluded) continue;
    const status = await lstat(path.join(directory, `${candidate}.jsonl`)).catch(() => undefined);
    if (!status) return candidate;
  }
  throw new Error("could not allocate a unique session id");
}

export async function openSession(selection: SessionSelection): Promise<{
  history: SessionMessage[];
  transcript: SessionTranscript;
}> {
  if (selection.sessionId && selection.resume) {
    throw new Error("--session-id and --resume are mutually exclusive");
  }
  if (selection.sessionId && selection.forkSession) {
    throw new Error("--fork-session cannot be combined with --session-id");
  }
  const directory = await prepareProjectTranscriptDirectory(selection);
  const generateId = selection.generateId ?? randomUUID;

  if (selection.resume) {
    const resumedId = validateSessionId(selection.resume);
    const resumedFile = path.join(directory, `${resumedId}.jsonl`);
    const stored = await readStoredTranscript(resumedFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error(`session ${resumedId} does not exist`);
      throw error;
    });
    const resumed = new SessionTranscript(
      resumedId,
      resumedFile,
      selection.cwd,
      stored.at(-1)?.uuid ?? null,
    );
    const history = stored.map((record) => structuredClone(record.message));
    if (!selection.forkSession) return { history, transcript: resumed };

    const forkedId = await unusedSessionId(directory, generateId, resumedId);
    const forkedFile = path.join(directory, `${forkedId}.jsonl`);
    const forkedRecords = transcriptRecords(forkedId, selection.cwd, history);
    await createExclusive(forkedFile, forkedRecords);
    return {
      history: structuredClone(history),
      transcript: new SessionTranscript(
        forkedId,
        forkedFile,
        selection.cwd,
        forkedRecords.at(-1)?.uuid ?? null,
      ),
    };
  }

  const id = selection.sessionId
    ? validateSessionId(selection.sessionId)
    : await unusedSessionId(directory, generateId);
  const file = path.join(directory, `${id}.jsonl`);
  await createExclusive(file, []);
  return { history: [], transcript: new SessionTranscript(id, file, selection.cwd) };
}

async function readStoredTranscript(file: string): Promise<TranscriptMessageRecord[]> {
  await requirePrivateRegularFile(file);
  const handle = await open(file, fileFlags(fsConstants.O_RDONLY));
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.size > MAX_TRANSCRIPT_BYTES) {
      throw new Error("transcript exceeds the 64 MiB limit");
    }
    const snapshot = Buffer.alloc(status.size);
    let offset = 0;
    while (offset < snapshot.byteLength) {
      const { bytesRead } = await handle.read(snapshot, offset, snapshot.byteLength - offset, offset);
      if (bytesRead === 0) throw new Error("transcript changed during snapshot read");
      offset += bytesRead;
    }
    return decodeTranscript(snapshot);
  } finally {
    await handle.close();
  }
}
