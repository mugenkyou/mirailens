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
