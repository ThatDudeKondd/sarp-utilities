import { defineCommand } from "../../utils/defineCommand.js";

export default defineCommand({
  name: "afk",
  description: "Sets your status to AFK.",
  cooldown: 1000,

  options: [
    {
      name: "message",
      description: "A message as to what your afk for.",
      type: "string",
      required: false,
    },
  ],

  execute: async (ctx) => {
    const message = ctx.getString("message");
  },
});
