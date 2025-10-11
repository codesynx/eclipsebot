export const config = {
  botToken: process.env.BOT_TOKEN || '',
  apiId: parseInt(process.env.API_ID || '0'),
  apiHash: process.env.API_HASH || '',
  sessionPath: process.env.SESSION_PATH || './sessions',
};

if (!config.botToken || !config.apiId || !config.apiHash) {
  console.error('Please set BOT_TOKEN, API_ID, and API_HASH in .env file');
  process.exit(1);
}
