import { defineCommand } from "../../utils/defineCommand.js";
import { setAfk } from "../../services/AfkService.js";
import { createSuccessEmbed, truncateString } from "../../utils/formatters.js";

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
    const message = truncateString(ctx.getString("message")?.trim() || "AFK", 200);
    await setAfk(ctx.user.id, message, ctx.member);

    await ctx.reply({
      embeds: [createSuccessEmbed("AFK", `💤 You are now AFK: ${message}`)],
      allowedMentions: { parse: [] },
    });
  },
});
