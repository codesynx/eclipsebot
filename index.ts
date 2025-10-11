import { TelegramBot } from "./src/bot";

async function main() {
  const bot = new TelegramBot();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    await bot.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    await bot.stop();
    process.exit(0);
  });

  // Start the bot
  await bot.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
