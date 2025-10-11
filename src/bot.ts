import { Bot } from 'grammy';
import { config } from './config';
import { SessionManager } from './utils/session-manager';
import { AuthHandler } from './handlers/auth';
import { DownloadHandler } from './handlers/download';
import { PaymentHandler } from './handlers/payment';
import { DatabaseService } from './services/database';
import { SubscriptionService } from './services/subscription';

export class TelegramBot {
  private bot: Bot;
  private sessionManager: SessionManager;
  private authHandler: AuthHandler;
  private downloadHandler: DownloadHandler;
  private paymentHandler: PaymentHandler;
  private db: DatabaseService;
  private subscriptionService: SubscriptionService;

  constructor() {
    this.bot = new Bot(config.botToken);
    this.sessionManager = new SessionManager();
    this.db = new DatabaseService();
    this.subscriptionService = new SubscriptionService(this.bot, this.db);
    this.authHandler = new AuthHandler(this.sessionManager);
    this.downloadHandler = new DownloadHandler(this.sessionManager, this.subscriptionService);
    this.paymentHandler = new PaymentHandler(this.subscriptionService);

    this.setupHandlers();
  }

  private async setupMenuButton() {
    // Set up menu button with commands
    await this.bot.api.setMyCommands([
      { command: 'start', description: '🏠 Главное меню' },
      { command: 'login', description: '🔐 Авторизация через QR-код' },
      { command: 'logout', description: '🚪 Выйти из аккаунта' },
      { command: 'subscribe', description: '💳 Оформить подписку' },
      { command: 'status', description: '📊 Статус подписки' },
      { command: 'download', description: '📥 Скачать из канала' },
      { command: 'story', description: '📸 Скачать историю' },
      { command: 'help', description: '❓ Помощь' },
    ]);
  }

  private setupHandlers() {
    // Start command
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        '👋 Привет! Я бот для скачивания медиа из Telegram.\n\n' +
        '🔐 Авторизация через QR-код:\n' +
        '/login - Получить QR-код для авторизации\n' +
        '/logout - Выйти из аккаунта\n\n' +
        '💳 Подписка:\n' +
        '/subscribe - Оформить подписку (50 ⭐️ в месяц)\n' +
        '/status - Проверить статус подписки\n\n' +
        '📥 Скачивание:\n' +
        '/download - Скачать медиа из канала (с выбором)\n' +
        '/story <ссылка> - Скачать историю\n\n' +
        '❓ Помощь:\n' +
        '/help - Показать подробную инструкцию'
      );
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '📖 Инструкция по использованию:\n\n' +
        '1️⃣ Авторизация без 2FA:\n' +
        '   • Нажмите /login\n' +
        '   • Выберите "Нет 2FA" → нажмите /qr\n' +
        '   • Откройте Telegram на телефоне\n' +
        '   • Настройки → Устройства → Подключить устройство\n' +
        '   • Отсканируйте QR-код\n' +
        '   • Подтвердите вход\n\n' +
        '1️⃣ Авторизация с 2FA:\n' +
        '   • Нажмите /login\n' +
        '   • Введите пароль: /password ваш_пароль_2fa\n' +
        '   • Получите QR-код автоматически\n' +
        '   • Откройте Telegram на телефоне\n' +
        '   • Настройки → Устройства → Подключить устройство\n' +
        '   • Отсканируйте QR-код\n' +
        '   • Пароль будет применен автоматически\n\n' +
        '2️⃣ Оформление подписки:\n' +
        '   • После авторизации используйте /subscribe\n' +
        '   • Стоимость: 50 ⭐️ в месяц\n' +
        '   • Оплата через Telegram Stars\n' +
        '   • Проверка статуса: /status\n\n' +
        '3️⃣ Скачивание историй:\n' +
        '   • Скопируйте ссылку на историю\n' +
        '   • Отправьте: /story https://t.me/username/s/123\n\n' +
        '4️⃣ Скачивание из каналов:\n' +
        '   • Используйте команду /download\n' +
        '   • Выберите канал из списка\n' +
        '   • Укажите номер сообщения или диапазон (например, 1-20)\n\n' +
        '✅ Преимущества QR-авторизации:\n' +
        '   • Быстро и безопасно\n' +
        '   • Не требует ввода SMS-кода\n' +
        '   • Нет блокировок от Telegram\n' +
        '   • Автоматическая обработка 2FA\n\n' +
        '⚠️ Для скачивания медиа необходима активная подписка!'
      );
    });

    // Auth commands
    this.bot.command('login', (ctx) => this.authHandler.handleLogin(ctx));
    this.bot.command('qr', (ctx) => this.authHandler.handleQR(ctx));
    this.bot.command('password', (ctx) => this.authHandler.handlePassword(ctx));
    this.bot.command('logout', (ctx) => this.authHandler.handleLogout(ctx));

    // Subscription commands
    this.bot.command('subscribe', (ctx) => this.paymentHandler.handleSubscribe(ctx));
    this.bot.command('status', (ctx) => this.paymentHandler.handleStatus(ctx));

    // Download commands
    this.bot.command('story', (ctx) => this.downloadHandler.handleStory(ctx));
    this.bot.command('download', (ctx) => this.downloadHandler.handleDownload(ctx));

    // Callback query handler for channel selection
    this.bot.on('callback_query:data', (ctx) => this.downloadHandler.handleChannelSelection(ctx));

    // Payment handlers
    this.bot.on('pre_checkout_query', (ctx) => this.paymentHandler.handlePrecheckoutQuery(ctx));
    this.bot.on('message:successful_payment', (ctx) => this.paymentHandler.handleSuccessfulPayment(ctx));

    // Text message handler for range input
    this.bot.on('message:text', (ctx) => this.downloadHandler.handleMessageRangeInput(ctx));

    // Error handler
    this.bot.catch((err) => {
      console.error('Bot error:', err);
    });
  }

  async start() {
    console.log('🤖 Starting bot...');
    await this.setupMenuButton();

    // Start subscription notification checker
    await this.subscriptionService.startExpiryNotificationChecker();

    await this.bot.start();
    console.log('✅ Bot is running!');
  }

  async stop() {
    console.log('Stopping bot...');

    // Stop subscription notification checker
    this.subscriptionService.stop();

    // Close database connection
    this.db.close();

    await this.bot.stop();
    console.log('Bot stopped.');
  }
}
