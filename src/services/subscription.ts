import { Bot } from 'grammy';
import { DatabaseService } from './database';
import { SUBSCRIPTION_CONFIG } from '../types/subscription';

export class SubscriptionService {
  private db: DatabaseService;
  private bot: Bot;
  private checkInterval: Timer | null = null;

  constructor(bot: Bot, db: DatabaseService) {
    this.bot = bot;
    this.db = db;
  }

  async checkSubscription(userId: number): Promise<boolean> {
    return await this.db.isSubscriptionActive(userId);
  }

  async activateSubscription(userId: number, paymentId?: string): Promise<void> {
    await this.db.createOrUpdateSubscription(
      userId,
      SUBSCRIPTION_CONFIG.subscriptionDurationDays,
      paymentId
    );
  }

  async getSubscriptionInfo(userId: number) {
    const subscription = await this.db.getSubscription(userId);
    if (!subscription) {
      return {
        isActive: false,
        message: '❌ У вас нет активной подписки.\n\n' +
          `💳 Стоимость: ${SUBSCRIPTION_CONFIG.priceStars} ⭐️ в месяц\n` +
          'Используйте /subscribe для оформления подписки.',
      };
    }

    const now = Date.now();
    const isExpired = subscription.expiresAt < now;

    if (isExpired) {
      await this.db.deactivateSubscription(userId);
      return {
        isActive: false,
        message: '⚠️ Ваша подписка истекла.\n\n' +
          `💳 Стоимость продления: ${SUBSCRIPTION_CONFIG.priceStars} ⭐️ в месяц\n` +
          'Используйте /subscribe для продления подписки.',
      };
    }

    const daysLeft = Math.ceil((subscription.expiresAt - now) / (1000 * 60 * 60 * 24));
    const expiryDate = new Date(subscription.expiresAt).toLocaleDateString('ru-RU');

    return {
      isActive: true,
      message: '✅ Ваша подписка активна!\n\n' +
        `📅 Действует до: ${expiryDate}\n` +
        `⏳ Осталось дней: ${daysLeft}\n\n` +
        'Вы можете скачивать медиа из Telegram без ограничений.',
    };
  }

  async startExpiryNotificationChecker() {
    // Check every 12 hours
    const intervalMs = 12 * 60 * 60 * 1000;

    const check = async () => {
      try {
        await this.checkAndNotifyExpiring();
        await this.checkAndDeactivateExpired();
      } catch (error) {
        console.error('Error checking subscriptions:', error);
      }
    };

    // Run immediately on start
    await check();

    // Then run on interval
    this.checkInterval = setInterval(check, intervalMs);
    console.log('✅ Subscription notification checker started');
  }

  private async checkAndNotifyExpiring() {
    const expiringSubscriptions = await this.db.getExpiringSubscriptions(3);

    for (const subscription of expiringSubscriptions) {
      try {
        const now = Date.now();
        const daysLeft = Math.ceil((subscription.expiresAt - now) / (1000 * 60 * 60 * 24));
        const expiryDate = new Date(subscription.expiresAt).toLocaleDateString('ru-RU');

        await this.bot.api.sendMessage(
          subscription.userId,
          `⚠️ Ваша подписка скоро истечет!\n\n` +
          `📅 Дата окончания: ${expiryDate}\n` +
          `⏳ Осталось дней: ${daysLeft}\n\n` +
          `💳 Стоимость продления: ${SUBSCRIPTION_CONFIG.priceStars} ⭐️ в месяц\n\n` +
          `Используйте /subscribe чтобы продлить подписку и продолжить пользоваться ботом.`
        );

        await this.db.markNotificationSent(subscription.userId);
        console.log(`Sent expiry notification to user ${subscription.userId}`);
      } catch (error) {
        console.error(`Failed to send notification to user ${subscription.userId}:`, error);
      }
    }
  }

  private async checkAndDeactivateExpired() {
    const expiredSubscriptions = await this.db.getExpiredSubscriptions();

    for (const subscription of expiredSubscriptions) {
      try {
        await this.db.deactivateSubscription(subscription.userId);

        await this.bot.api.sendMessage(
          subscription.userId,
          `❌ Ваша подписка истекла!\n\n` +
          `💳 Стоимость: ${SUBSCRIPTION_CONFIG.priceStars} ⭐️ в месяц\n\n` +
          `Используйте /subscribe чтобы возобновить подписку и продолжить скачивать медиа из Telegram.`
        );

        console.log(`Deactivated expired subscription for user ${subscription.userId}`);
      } catch (error) {
        console.error(`Failed to deactivate subscription for user ${subscription.userId}:`, error);
      }
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('Subscription notification checker stopped');
    }
  }
}
