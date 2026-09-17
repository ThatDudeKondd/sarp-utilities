import { GatewayIntentBits, Partials } from "discord.js";

export const BOT_CONFIG = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
} as const;

const superAdminId = "726507399640252416";

const DEBUG = process.env.DEBUG;
const erlcApiKey = process.env.ERLC_API_KEY || "";
const vexiraPortfolioKey = process.env.VEXIRA_PORTFOLIO_KEY || "";
const clientId = process.env.CLIENT_ID || "";

export const config = {
  debugState: DEBUG,
  superAdminId,
  clientId,
  vexiraPortfolioKey,
  erlcApiBaseUrl: "https://api.erlc.gg/v2/server",
  robloxUserPageUrl: "https://www.roblox.com/users/<USER_ID>/profile",
  vixeraPortfolioUrl: "https://www.vexira-portfolio.work",
  getOptions: {
    method: "GET",
    headers: { "server-key": erlcApiKey },
  },
  postOptions: {
    method: "POST",
    headers: {
      "server-key": erlcApiKey,
      "Content-Type": "application/json",
    },
  },
};
