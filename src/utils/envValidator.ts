import { logger } from "./logger.js";

export function validateEnv(): void {
  const requiredEnvVars = ["BOT_TOKEN", "CLIENT_ID"];

  const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    logger.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  logger.success("All required environment variables are set");
}
