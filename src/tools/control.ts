import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { Tool } from "./tool";
import { Context } from "@/context";

const baseControlSchema = (name: string, description: string) => ({
  name,
  description,
  inputSchema: zodToJsonSchema(z.object({})),
});

async function sendControlCommand(context: Context, action: string) {
  return await context.sendSocketMessage("browser_control", { action });
}

// --- New Phase 2 Tools ---

export const get_agent_status: Tool = {
  schema: baseControlSchema("get_agent_status", "Return the current extension-authoritative control state, connection status, and whether the agent is allowed to execute."),
  handle: async (context) => {
    if (!context.hasWs()) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            state: "BLOCKED",
            connectionStatus: "disconnected",
            allowedToExecute: false
          }, null, 2)
        }]
      };
    }

    try {
      const response = await context.sendSocketMessage("get_agent_status", {}, { timeoutMs: 5000 });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            state: response.state,
            connectionStatus: response.connectionStatus,
            allowedToExecute: response.allowedToExecute
          }, null, 2)
        }]
      };
    } catch (e) {
      const allowed = context.controlState === "IDLE" || context.controlState === "AGENT_RUNNING" || context.controlState === "AGENT_RESUMING";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            state: context.controlState,
            connectionStatus: "connected",
            allowedToExecute: allowed,
            warning: "Fallback to mirrored state: " + String((e as any).message || e)
          }, null, 2)
        }]
      };
    }
  }
};

export const pause_agent: Tool = {
  schema: baseControlSchema("pause_agent", "Request that the extension pause agent execution."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "PAUSE");
    return {
      content: [{ type: "text", text: `AI execution pause requested. Control state is now ${response.state}.` }],
    };
  }
};

export const resume_agent: Tool = {
  schema: baseControlSchema("resume_agent", "Request return of control to the agent."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "RESUME");
    return {
      content: [{ type: "text", text: `AI execution resume requested. Control state is now ${response.state}.` }],
    };
  }
};

export const stop_agent: Tool = {
  schema: baseControlSchema("stop_agent", "Emergency-stop all active agent execution."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "EMERGENCY_STOP");
    return {
      content: [{ type: "text", text: `Emergency stop requested. Control state is now ${response.state}.` }],
    };
  }
};

// --- Backwards Compatibility Tools ---

export const pause_ai: Tool = {
  schema: baseControlSchema("pause_ai", "Pause AI browser execution. AI tools will be blocked until resumed."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "PAUSE");
    return {
      content: [{ type: "text", text: `AI execution paused. Control state is now ${response.state}.` }],
    };
  },
};

export const resume_ai: Tool = {
  schema: baseControlSchema("resume_ai", "Resume AI browser execution after a pause or takeover."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "RESUME");
    return {
      content: [{ type: "text", text: `AI execution resumed. Control state is now ${response.state}.` }],
    };
  },
};

export const take_control: Tool = {
  schema: baseControlSchema("take_control", "Human takes explicit control of the browser. Blocks AI actions."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "TAKE_CONTROL");
    return {
      content: [{ type: "text", text: `Human assumed control. Control state is now ${response.state}.` }],
    };
  },
};

export const return_control: Tool = {
  schema: baseControlSchema("return_control", "Return control to the AI from the human."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "RETURN_CONTROL");
    return {
      content: [{ type: "text", text: `Control returned to AI. Control state is now ${response.state}.` }],
    };
  },
};

export const emergency_stop: Tool = {
  schema: baseControlSchema("emergency_stop", "Immediately and persistently stop all AI execution. Requires explicit reset."),
  handle: async (context) => {
    const response = await sendControlCommand(context, "EMERGENCY_STOP");
    return {
      content: [{ type: "text", text: `EMERGENCY STOP activated. Control state is now ${response.state}.` }],
    };
  },
};

export const get_control_state: Tool = {
  schema: baseControlSchema("get_control_state", "Get the current AI browser execution control state."),
  handle: async (context) => {
    const response = await context.sendSocketMessage("get_control_state", {});
    return {
      content: [{ type: "text", text: `Current control state: ${response.state}` }],
    };
  },
};
