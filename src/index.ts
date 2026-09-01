#!/usr/bin/env node
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { program } from "commander";

import { appConfig } from "@/config/app.config";

import type { Resource } from "@/resources/resource";
import { createServerWithTools } from "@/server";
import * as common from "@/tools/common";
import * as custom from "@/tools/custom";
import * as snapshot from "@/tools/snapshot";
import * as control from "@/tools/control";
import type { Tool } from "@/tools/tool";

import { protectStdioTransport } from "@/utils/log";

import packageJSON from "../package.json";

function setupExitWatchdog(server: Server) {
  let isClosing = false;
  const cleanupAndExit = async (code: number = 0) => {
    if (isClosing) return;
    isClosing = true;
    const forceExitTimeout = setTimeout(() => process.exit(code), 3000);
    try {
      await server.close();
    } catch (_) {}
    clearTimeout(forceExitTimeout);
    process.exit(code);
  };

  process.stdin.on("close", () => {
    cleanupAndExit(0);
  });

  process.on("SIGINT", () => {
    cleanupAndExit(0);
  });

  process.on("SIGTERM", () => {
    cleanupAndExit(0);
  });
}

const commonTools: Tool[] = [common.pressKey, common.wait];

const customTools: Tool[] = [custom.getConsoleLogs, custom.screenshot];

const snapshotTools: Tool[] = [
  common.navigate(true),
  common.goBack(true),
  common.goForward(true),
  snapshot.snapshot,
  snapshot.click,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  ...commonTools,
  ...customTools,
  control.pause_ai,
  control.resume_ai,
  control.take_control,
  control.return_control,
  control.emergency_stop,
  control.get_control_state,
  control.get_agent_status,
  control.pause_agent,
  control.resume_agent,
  control.stop_agent,
  control.get_policy,
  control.set_policy,
  control.undo_last,
  control.get_action_history,
];

const resources: Resource[] = [];

async function createServer(): Promise<Server> {
  return createServerWithTools({
    name: appConfig.name,
    version: packageJSON.version,
    tools: snapshotTools,
    resources,
  });
}

/**
 * Note: Tools must be defined *before* calling `createServer` because only declarations are hoisted, not the initializations
 */
program
  .version("Version " + packageJSON.version)
  .name(packageJSON.name)
  .action(async () => {
    protectStdioTransport();
    const server = await createServer();
    setupExitWatchdog(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
  });
program.parse(process.argv);
