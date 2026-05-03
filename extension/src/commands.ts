// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import * as vscode from "vscode";
import { openInteractiveGraph } from "./graphPanel.js";
import { log, output } from "./output.js";
import type { ProjectsTreeProvider } from "./sidebar.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  sidebar: ProjectsTreeProvider,
): void {
  const subs = context.subscriptions;

  subs.push(
    vscode.commands.registerCommand(
      "socraticode.indexCurrentWorkspace",
      indexCurrentWorkspaceCommand,
    ),
  );

  subs.push(
    vscode.commands.registerCommand(
      "socraticode.openInteractiveGraph",
      async (projectId?: string) => {
        await openInteractiveGraph(projectId);
      },
    ),
  );

  subs.push(
    vscode.commands.registerCommand("socraticode.refreshProjects", () => {
      sidebar.refresh();
    }),
  );

  subs.push(
    vscode.commands.registerCommand("socraticode.openWalkthrough", async () => {
      // Use context.extension.id so this keeps working if the publisher
      // namespace changes. Same pattern as the first-run trigger in
      // extension.ts. Wrapped in try/catch because some VS Code forks
      // do not expose `workbench.action.openWalkthrough` and the
      // command would otherwise reject silently.
      try {
        await vscode.commands.executeCommand(
          "workbench.action.openWalkthrough",
          `${context.extension.id}#socraticode.gettingStarted`,
          false,
        );
      } catch (err) {
        log(`Failed to open walkthrough: ${(err as Error).message}`);
        vscode.window.showWarningMessage(
          "SocratiCode: this editor does not appear to support walkthroughs. See the marketplace listing for getting-started guidance.",
        );
      }
    }),
  );

  subs.push(
    vscode.commands.registerCommand("socraticode.openOutput", () => {
      output().show(true);
    }),
  );
}

async function indexCurrentWorkspaceCommand(): Promise<void> {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    vscode.window.showWarningMessage("SocratiCode: open a folder or workspace before indexing.");
    return;
  }
  // The engine is the authority on indexing. Surface a clear instruction
  // the AI assistant can act on and copy the prompt to the clipboard.
  const prompt = `Use SocratiCode to index this project: call codebase_index for ${ws.uri.fsPath}.`;
  await vscode.env.clipboard.writeText(prompt);
  log(`indexCurrentWorkspace: prompt copied for ${ws.uri.fsPath}`);
  const action = await vscode.window.showInformationMessage(
    "Prompt copied to clipboard. Paste it into your AI assistant chat to index this workspace.",
    "Open chat",
    "Show output",
  );
  if (action === "Open chat") {
    // `workbench.action.chat.open` is not guaranteed across every
    // VS Code-compatible editor (some Theia-based forks omit it). Fall
    // back to the output channel if the host doesn't expose the chat
    // command, so the user always gets useful feedback.
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open");
    } catch (err) {
      log(`Open chat failed: ${(err as Error).message}`);
      output().show(true);
      vscode.window.showInformationMessage(
        "SocratiCode: this editor does not expose a chat command. Opened the SocratiCode output channel instead.",
      );
    }
  } else if (action === "Show output") {
    output().show(true);
  }
}
