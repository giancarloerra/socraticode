// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogLevel, logger, setLogLevel, setMcpLogSender } from "../../src/services/logger.js";

type SenderFn = Parameters<typeof setMcpLogSender>[0];

describe("logger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let savedLevel: ReturnType<typeof getLogLevel>;

  beforeEach(() => {
    // Pin the level so tests don't depend on SOCRATICODE_LOG_LEVEL in the
    // host shell — that env was the suspected cause of the reviewer's
    // "does not emit debug at the default info level" flake.
    savedLevel = getLogLevel();
    setLogLevel("info");
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setLogLevel(savedLevel);
  });

  describe("log methods exist", () => {
    it("has debug method", () => {
      expect(typeof logger.debug).toBe("function");
    });

    it("has info method", () => {
      expect(typeof logger.info).toBe("function");
    });

    it("has warn method", () => {
      expect(typeof logger.warn).toBe("function");
    });

    it("has error method", () => {
      expect(typeof logger.error).toBe("function");
    });
  });

  describe("info logging", () => {
    it("writes to stderr", () => {
      logger.info("test message");
      expect(stderrSpy).toHaveBeenCalled();
    });

    it("outputs valid JSON", () => {
      logger.info("test message");
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("includes timestamp, level, and data", () => {
      logger.info("hello world");
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.level).toBe("info");
      expect(parsed.data).toBe("hello world");
    });

    it("includes context fields when provided", () => {
      logger.info("test", { projectPath: "/test", count: 42 });
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.projectPath).toBe("/test");
      expect(parsed.count).toBe(42);
    });

    it("outputs with trailing newline", () => {
      logger.info("test");
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output.endsWith("\n")).toBe(true);
    });
  });

  describe("warn logging", () => {
    it("writes with warn level", () => {
      logger.warn("warning message");
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("warn");
      expect(parsed.data).toBe("warning message");
    });
  });

  describe("error logging", () => {
    it("writes with error level", () => {
      logger.error("error message");
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("error");
      expect(parsed.data).toBe("error message");
    });

    it("includes error context", () => {
      logger.error("failed", { error: "something broke", code: 500 });
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.error).toBe("something broke");
      expect(parsed.code).toBe(500);
    });
  });

  describe("timestamp format", () => {
    it("uses ISO 8601 format", () => {
      logger.info("timestamp test");
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      // ISO 8601: 2024-01-15T10:30:00.000Z
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("log level filtering", () => {
    it("does not emit debug messages at the default info level", () => {
      logger.debug("should be filtered");
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("emits info, warn, and error at the default info level", () => {
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");
      expect(stderrSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe("setMcpLogSender", () => {
    let senderMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      senderMock = vi.fn();
      setMcpLogSender(senderMock as SenderFn);
    });

    afterEach(() => {
      // Reset so subsequent tests continue using the stderr path
      setMcpLogSender(null as unknown as SenderFn);
    });

    it("routes logs through the MCP sender instead of stderr", () => {
      logger.info("mcp test");
      expect(senderMock).toHaveBeenCalledOnce();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("passes correct logger name, level, and data to the sender", () => {
      logger.info("hello");
      expect(senderMock).toHaveBeenCalledWith({
        level: "info",
        logger: "socraticode",
        data: "hello",
      });
    });

    it("maps warn level to 'warning' to comply with the MCP spec", () => {
      logger.warn("something off");
      expect(senderMock).toHaveBeenCalledWith(expect.objectContaining({
        level: "warning",
      }));
    });

    it("keeps debug, info, error level names unchanged for MCP", () => {
      logger.error("boom");
      expect(senderMock).toHaveBeenCalledWith(expect.objectContaining({
        level: "error",
      }));
    });

    it("embeds context fields in the data string when context is provided", () => {
      logger.info("msg", { foo: "bar", count: 3 });
      const call = senderMock.mock.calls[0]?.[0] as { data: string };
      expect(call.data).toContain("msg");
      expect(call.data).toContain("foo");
      expect(call.data).toContain("bar");
    });

    it("sends plain message string when no context is provided", () => {
      logger.info("plain message");
      const call = senderMock.mock.calls[0]?.[0] as { data: string };
      expect(call.data).toBe("plain message");
    });

    it("swallows exceptions thrown by the sender", () => {
      senderMock.mockImplementation(() => { throw new Error("transport closed"); });
      expect(() => logger.info("test")).not.toThrow();
    });
  });
});
