# SARP Bot - Discord Bot in TypeScript

A modern Discord bot built with TypeScript, discord.js, and Prisma ORM. Features dynamic command loading, slash commands, prefix commands, cooldowns, and per-guild configuration.

## ✨ Features

- ⚡ **Hybrid Command System**: Support for both slash commands and prefix commands
- 🔄 **Dynamic Command Loading**: Automatically loads commands from directories
- 🎯 **Command Cooldowns**: Prevent command spam with per-user cooldowns
- 🏢 **Guild Configuration**: Per-guild settings stored in PostgreSQL
- 📊 **Prisma ORM**: Type-safe database access
- 🛠️ **TypeScript**: Full type safety and modern development experience
- 🔌 **Modular Architecture**: Easy to extend and maintain

## 📁 Project Structure

```
src/
├── commands/              # All bot commands
│   ├── moderation/       # Moderation commands
│   ├── utility/          # Utility commands (ping, help, etc.)
│   ├── erlc/             # ERLC-specific commands
│   └── admin/            # Admin-only commands
├── config/               # Configuration files
│   ├── constants.ts      # Bot constants
│   └── config.ts         # Discord client config
├── database/             # Database setup
│   └── client.ts         # Prisma client initialization
├── events/               # Event handlers
│   ├── ready.ts          # Bot ready event
│   ├── messageCreate.ts  # Prefix command handler
│   └── interactionCreate.ts # Slash command handler
├── loaders/              # Command loaders
│   ├── commandLoader.ts  # Prefix command loader
│   └── slashCommandLoader.ts # Slash command loader
├── middleware/           # Middleware functions
│   ├── cooldown.ts       # Command cooldown system
│   └── permissions.ts    # Permission checking
├── services/             # Business logic
│   └── GuildConfigService.ts # Guild configuration service
├── types/                # TypeScript types
│   ├── Command.ts        # Prefix command interface
│   └── SlashCommand.ts   # Slash command interface
├── utils/                # Utility functions
│   ├── logger.ts         # Logger utility
│   └── envValidator.ts   # Environment validation
└── index.ts              # Bot entry point
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 12+ (or use Prisma Postgres)
- Discord Bot Token

### Installation

1. **Clone or setup the project**

   ```bash
   cd SARP-Bot
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Setup PostgreSQL Database**
   See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for detailed instructions.

4. **Configure environment**

   ```bash
   # Create .env from .env.example
   cp .env.example .env

   # Edit .env with your values
   # BOT_TOKEN=your_discord_token
   # CLIENT_ID=your_client_id
   # DATABASE_URL=postgresql://...
   ```

5. **Initialize database**

   ```bash
   npm run db:push
   ```

6. **Start the bot**
   ```bash
   npm run dev
   ```

## 📝 Creating Commands

### Creating a Prefix Command

Create a file in `src/commands/{category}/{commandName}.ts`:

```typescript
import { Message } from "discord.js";
import { Command } from "../../types/Command";

export const myCommand: Command = {
  name: "mycommand",
  description: "My custom command",
  category: "utility",
  cooldown: 3000, // Optional: cooldown in milliseconds
  async execute(message: Message, args: string[]) {
    // Your command logic
    await message.reply("Hello!");
  },
};
```

**Export the command as default or named export:**

```typescript
export default myCommand;
// OR
export const myCommand: Command = { ... };
```

### Creating a Slash Command

Create a file in `src/commands/{category}/{commandName}Slash.ts`:

```typescript
import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { SlashCommandType } from "../../types/SlashCommand";

export const mySlashCommand: SlashCommandType = {
  data: new SlashCommandBuilder()
    .setName("mycommand")
    .setDescription("My custom slash command")
    .addStringOption((option) =>
      option.setName("text").setDescription("Some text").setRequired(true),
    ),
  category: "utility",
  async execute(interaction: ChatInputCommandInteraction) {
    const text = interaction.options.getString("text");
    await interaction.reply(`You said: ${text}`);
  },
};
```

### Command Properties

| Property    | Type     | Description                                | Required |
| ----------- | -------- | ------------------------------------------ | -------- |
| name        | string   | Command name (lowercase)                   | ✅       |
| description | string   | Command description                        | ✅       |
| category    | string   | Category: moderation, utility, erlc, admin | ✅       |
| cooldown    | number   | Cooldown in ms (default: 3000)             | ❌       |
| execute     | function | Command handler function                   | ✅       |

## 🎮 Using the Guild Config

```typescript
import { GuildConfigService } from "./services/GuildConfigService";

// Get prefix
const prefix = await GuildConfigService.getPrefix(guildId);

// Set prefix
await GuildConfigService.setPrefix(guildId, "!");

// Get mod log channel
const modLogId = await GuildConfigService.getModLogChannel(guildId);

// Set mod log channel
await GuildConfigService.setModLogChannel(guildId, channelId);
```

## ⏱️ Command Cooldowns

Cooldowns are automatically handled for prefix commands:

```typescript
export const myCommand: Command = {
  name: "mycommand",
  cooldown: 5000, // 5 second cooldown per user
  // ...
};
```

For more control, use the cooldown middleware:

```typescript
import {
  checkCooldown,
  setCooldown,
  getCooldown,
} from "../middleware/cooldown";

// Check and set cooldown
const canExecute = await checkCooldown(message, "mycommand", 5000);
if (!canExecute) return;

// Or manually check
const remaining = getCooldown(userId, "mycommand");
if (remaining > 0) {
  await message.reply(`Wait ${(remaining / 1000).toFixed(1)}s`);
}
```

## 🛠️ Available Commands

### npm Scripts

```bash
npm run dev           # Development with hot reload
npm run build         # Build TypeScript to JavaScript
npm start             # Run compiled bot
npm run db:migrate    # Create database migration
npm run db:push       # Push schema to database
npm run db:seed       # Seed database with test data
npm run db:studio     # Open Prisma Studio GUI
```

## 📊 Database Schema

### GuildConfig

```prisma
- guildId (String) - Discord server ID
- prefix (String) - Command prefix (default: "!")
- modLogChannelId (String?) - Moderation log channel
- createdAt (DateTime) - Creation timestamp
- updatedAt (DateTime) - Update timestamp
```

### CommandCooldown

```prisma
- userId (String)
- commandName (String)
- expiresAt (DateTime)
```

### User

```prisma
- userId (String) - Discord user ID
- infractions (Int) - Count of infractions
- warnings (Int) - Count of warnings
```

## 🔍 Logger Utility

```typescript
import { logger } from "./utils/logger";

logger.info("Info message");
logger.warn("Warning message");
logger.error("Error message", error);
logger.debug("Debug message");
logger.success("Success message");
```

## 🐛 Debugging

Enable debug mode in `.env`:

```env
DEBUG=true
```

View bot logs with timestamps:

```
[2024-01-15T10:30:45.123Z] [INFO] Starting bot...
[2024-01-15T10:30:46.456Z] [SUCCESS] Bot ready!
```

## 🐳 Production Deployment

Production runs this bot (and its `djsko` dependency) in Docker, supervised by a
systemd `--user` service — not raw `node`/`npm`.

- **Image**: multi-stage build from `Dockerfile`. Build context must be the repo
  root (`/opt/sarp-project`), not `sarp-utilities/`, since it also copies the
  sibling `djsko` workspace member:
  ```bash
  cd /opt/sarp-project
  docker build -f sarp-utilities/Dockerfile -t sarp-utilities:latest .
  ```
- **Process supervisor inside the container**: `pm2-runtime` via
  `ecosystem.config.cjs` (single fork instance — the bot owns one Discord
  gateway connection).
- **systemd unit** (`sarp-utilities.service`): `ExecStart=docker run --rm
  --name sarp-utilities --network host --env-file .env sarp-utilities:latest`.
  `--network host` lets the container reach Postgres on `localhost:5432`.
- **Auto-deploy**: `deploy-sarp.sh` is triggered either by a GitHub webhook
  (push to `main` on `sarp-utilities` or `djsko`) or a 5-minute polling timer
  as a fallback. It pulls both repos, rebuilds the image, runs a one-shot
  `docker run ... npm run db:update` migration container, then restarts the
  systemd service. See `DEBUG_CHEATSHEET.md` for troubleshooting commands.

## 🤝 Contributing

1. Create a feature branch
2. Add your commands/features
3. Test thoroughly
4. Submit changes

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For issues and questions, please check:

- [DATABASE_SETUP.md](./DATABASE_SETUP.md) - Database setup guide
- [Prisma Docs](https://www.prisma.io/docs/)
- [discord.js Guide](https://discordjs.guide/)
