// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * Structured logger for SocratiCode MCP server.
 * Outputs JSON-structured log lines to stderr (stdout is reserved for MCP JSON-RPC).
 * Also forwards log entries as MCP notifications/message so hosts like Cline
 * can display them in their UI.
 *
 * When SOCRATICODE_LOG_FILE is set to an absolute path, all log entries are
 * also appended to that file — useful for debugging when the MCP host doesn't
 * surface log notifications.
 */

import { appendFileSync } from "node:fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** MCP spec levels — "warning" is the spec spelling (our "warn"). */
type McpLogLevel = "debug" | "info" | "warning" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const envLevel = process.env.SOCRATICODE_LOG_LEVEL?.toLowerCase();
const currentLevel: LogLevel = envLevel && Object.hasOwn(LOG_LEVELS, envLevel)
  ? (envLevel as LogLevel)
  : "info";
const logFilePath: string | undefined = process.env.SOCRATICODE_LOG_FILE || undefined;

// Write a separator so you can tell where each server session begins
if (logFilePath) {
  try {
    appendFileSync(logFilePath, `\n--- SocratiCode session started at ${new Date().toISOString()} ---\n`);
  } catch {
    // Can't write — will be caught again when we try to append.
  }
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    data: message,
    ...context,
  };
  return JSON.stringify(entry);
}

/** Maps our log levels to the MCP spec level names. */
function toMcpLevel(level: LogLevel): McpLogLevel {
  return level === "warn" ? "warning" : level;
}

// ---------------------------------------------------------------------------
// MCP notification sender — registered by index.ts after the server is created.
// When set, each log call also sends a notifications/message to the MCP client
// (e.g. Cline), making log output visible in the host's UI.
// ---------------------------------------------------------------------------
type LogSenderFn = (params: { level: McpLogLevel; logger: string; data: string }) => void;
let _mcpLogSender: LogSenderFn | null = null;

/**
 * Register a function that forwards log entries as MCP notifications/message.
 * Called once from index.ts immediately after `new McpServer(...)`.
 */
export function setMcpLogSender(fn: LogSenderFn): void {
  _mcpLogSender = fn;
}

function sendMcpLog(level: LogLevel, message: string): void {
  if (_mcpLogSender) {
    try {
      _mcpLogSender({ level: toMcpLevel(level), logger: "socraticode", data: message });
    } catch {
      // Transport not yet connected or already closed — silently ignore.
    }
  }
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  // Always write to log file when configured — this is the reliable path
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, `${formatLog(level, message, context)}\n`);
    } catch {
      // Silently ignore write errors
    }
  }

  if (_mcpLogSender) {
    // MCP transport is active: route via notifications/message only.
    // Writing to stderr while hosted inside Cline causes Cline to emit
    // "LOG Server "name" info:" with the content silently dropped (Cline's
    // Logger only appends extra args in IS_DEV mode).
    // Include context in the message string so error details aren't silently dropped.
    const fullMessage = context && Object.keys(context).length > 0
      ? `${message} ${JSON.stringify(context)}`
      : message;
    sendMcpLog(level, fullMessage);
  } else {
    // No MCP transport yet (startup, tests, direct invocation): write JSON to stderr.
    process.stderr.write(`${formatLog(level, message, context)}\n`);
  }
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    emit("debug", message, context);
  },

  info(message: string, context?: Record<string, unknown>): void {
    emit("info", message, context);
  },

  warn(message: string, context?: Record<string, unknown>): void {
    emit("warn", message, context);
  },

  error(message: string, context?: Record<string, unknown>): void {
    emit("error", message, context);
  },
};
