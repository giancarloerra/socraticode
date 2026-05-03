// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import * as vscode from "vscode";
import { log } from "./output.js";
import { getSettings } from "./settings.js";

/**
 * Registers the SocratiCode MCP server with VS Code's MCP host (Copilot
 * agent mode, Cline, Continue, Roo Code, ...) via the
 * `vscode.lm.registerMcpServerDefinitionProvider` API (VS Code 1.99+).
 *
 * This is the single most important thing the extension does. Once this
 * provider is registered, every MCP-aware chat / agent in the editor sees
 * SocratiCode's tools without the user editing any `.vscode/mcp.json`.
 *
 * The provider returns a single stdio definition that launches the engine
 * via `npx -y socraticode` (overridable via `socraticode.command` /
 * `socraticode.args`). The engine's environment is the user-configured
 * `socraticode.env` object passed through unchanged, which is how power
 * users point at an external Qdrant (`QDRANT_MODE=external`, `QDRANT_URL`,
 * `QDRANT_API_KEY`) or pick an embedding provider.
 */

export class SocratiCodeMcpProvider implements vscode.McpServerDefinitionProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChange.event;

  /** Trigger VS Code to re-fetch the server definition (e.g. after a setting change). */
  refresh(): void {
    this._onDidChange.fire();
  }

  async provideMcpServerDefinitions(): Promise<vscode.McpServerDefinition[]> {
    const settings = getSettings();
    const def = new vscode.McpStdioServerDefinition(
      "SocratiCode",
      settings.command,
      settings.args,
      settings.env,
    );
    return [def];
  }
}

export function registerMcpProvider(
  context: vscode.ExtensionContext,
): SocratiCodeMcpProvider | undefined {
  const provider = new SocratiCodeMcpProvider();

  // The `engines.vscode: ^1.99.0` field in package.json prevents
  // installation on hosts without the MCP API, but some VS Code-derived
  // editors lie about their reported version. Defensively check that
  // the API surface exists before calling it, so activation degrades
  // gracefully (sidebar / commands / status bar still work) instead of
  // throwing a hard error that disables the entire extension.
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") {
    log(
      "vscode.lm.registerMcpServerDefinitionProvider is unavailable in this host; " +
        "skipping MCP server registration. Sidebar, commands and status bar still work.",
    );
    return undefined;
  }

  const disposable = vscode.lm.registerMcpServerDefinitionProvider("socraticode.mcp", provider);
  context.subscriptions.push(disposable);
  log("Registered SocratiCode MCP server provider");

  // Refresh the provider when relevant settings change so VS Code re-reads
  // the definition (e.g. user changed the engine command or env vars).
  const watch = vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration("socraticode.command") ||
      e.affectsConfiguration("socraticode.args") ||
      e.affectsConfiguration("socraticode.env")
    ) {
      log("Settings changed, refreshing MCP server definition");
      provider.refresh();
    }
  });
  context.subscriptions.push(watch);

  return provider;
}
