import { z } from "zod";
import { ToolDef } from "../registry.js";
import { BRIDGE_METHODS, bridgeCall } from "./_helpers.js";
import { ConsoleLogsResult } from "@uvibe/core";

const InputShape = {
  level: z.enum(["all", "warning_or_error", "error"]).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  sinceTimestamp: z.number().optional().describe("Unix ms; only return logs after this time."),
  detailLevel: z.enum(["summary", "normal", "full"]).optional(),
};

export const unityGetConsoleLogs: ToolDef<typeof InputShape, ConsoleLogsResult> = {
  name: "unity_get_console_logs",
  description:
    "Returns Unity console logs captured since the UnityVibeOS package loaded. Logs are captured via Application.logMessageReceivedThreaded; logs emitted before package load are not retained (documented limitation). Filter by level and limit count.",
  requires: ["unity_bridge"],
  inputShape: InputShape,
  async run(args, ctx) {
    return bridgeCall<ConsoleLogsResult>(
      ctx.bridge,
      BRIDGE_METHODS.consoleGetLogs,
      {
        level: args.level ?? "all",
        limit: args.limit ?? 200,
        sinceTimestamp: args.sinceTimestamp,
      },
      args.detailLevel ?? "normal"
    );
  },
};
