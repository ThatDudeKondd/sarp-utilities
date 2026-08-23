import "dotenv/config";
import { Client, SlashCommandBuilder } from "discord.js";
import { resolve } from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { BOT_CONFIG } from "./config/config.js";
import { BOT_TOKEN } from "./config/constants.js";
import { validateEnv } from "./utils/envValidator.js";
import { logger } from "./utils/logger.js";
import { connectDatabase, disconnectDatabase } from "./database/client.js";
import { onReady } from "./events/ready.js";
import { onMessageCreate } from "./events/messageCreate.js";
import { onInteractionCreate } from "./events/interactionCreate.js";
import { CommandLoader } from "./loaders/unifiedCommandLoader.js";
import { setCommandRegistry } from "./loaders/commandRegistry.js";
import { UnifiedCommand } from "./types/UnifiedCommand.js";
import { Jishaku } from "djsko";

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate environment variables
validateEnv();

const client = new Client(BOT_CONFIG);

// Loaded once at startup: every command file yields one entry here, registered
// as both a prefix command (byName/byAlias) and a slash command (slashData).
let commands = new Map<string, UnifiedCommand>();
let aliases = new Map<string, UnifiedCommand>();
let slashData: SlashCommandBuilder[] = [];

const jsk = new Jishaku(client, {
  prefix: "-", // Root command becomes `.jsk`. Default: '.'
  owners: [
    "726507399640252416",
    "1383717448804470817",
    "1355621905658548357",
    "1092489655888379915",
  ], // Optional; defaults to the application owner/team.
  shellOwners: ["726507399640252416"],
  encoding: "UTF-8", // Use 'Shift_JIS' for Japanese Windows shell output.
  updateCommand: "/opt/sarp-project/sarp-utilities/deploy-sarp.sh",
  restartCommand: "systemctl --user restart sarp-utilities.service",
});

async function initializeBot() {
  try {
    // Connect to database
    await connectDatabase();

    // Load commands
    const commandsDir = resolve(__dirname, "commands");
    const loaded = await CommandLoader.loadCommands(commandsDir);
    commands = loaded.byName;
    aliases = loaded.byAlias;
    slashData = loaded.slashData;
    setCommandRegistry(commands);

    logger.success("✅ Bot initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize bot:", error);
    process.exit(1);
  }
}

// Event listeners
client.on("clientReady", (readyClient) => onReady(readyClient, slashData));

client.on("messageCreate", (message) =>
  onMessageCreate(message, commands, aliases),
);

client.on("messageCreate", (message) => jsk.onMessageCreated(message));

client.on("interactionCreate", (interaction) =>
  onInteractionCreate(interaction as any, commands),
);

// Error handling
client.on("error", (error) => {
  logger.error("Discord client error:", error);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection:", reason);
});

// Graceful shutdown
async function shutdown() {
  logger.info("Shutting down bot...");

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit.");
    process.exit(1);
  }, 3000);
  forceExit.unref();

  try {
    await disconnectDatabase();
    await client.destroy();
  } catch (error) {
    logger.error("Error during shutdown:", error);
  } finally {
    clearTimeout(forceExit);
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Initialize and login
initializeBot()
  .then(() => {
    client.login(BOT_TOKEN);
  })
  .catch((error) => {
    logger.error("Failed to start bot:", error);
    process.exit(1);
  });
