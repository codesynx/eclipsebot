import { Context } from 'grammy';
import { SubscriptionService } from '../services/subscription';
import { SUBSCRIPTION_CONFIG } from '../types/subscription';

export class PaymentHandler {
  private subscriptionService: SubscriptionService;

  constructor(subscriptionService: SubscriptionService) {
    this.subscriptionService = subscriptionService;
  }

  async handleSubscribe(ctx: Context) {
    if (!ctx.from) return;

    const userId = ctx.from.id;

    // Check if user is already subscribed
    const hasActiveSubscription = await this.subscriptionService.checkSubscription(userId);

    if (hasActiveSubscription) {
      const info = await this.subscriptionService.getSubscriptionInfo(userId);
      await ctx.reply(
        `✅ У вас уже есть активная подписка!\n\n${info.message}\n\n` +
        `Если хотите продлить подписку заранее, используйте кнопку ниже.`
      );
    }

    // Create invoice for Telegram Stars
    await ctx.replyWithInvoice(
      SUBSCRIPTION_CONFIG.title,
      SUBSCRIPTION_CONFIG.description,
      JSON.stringify({ userId }), // payload
      'XTR', // currency (XTR = Telegram Stars)
      [
        {
          label: `Подписка на ${SUBSCRIPTION_CONFIG.subscriptionDurationDays} дней`,
          amount: SUBSCRIPTION_CONFIG.priceStars,
        },
      ],
      {
        protect_content: false,
        reply_markup: undefined,
      }
    );
  }

  async handlePrecheckoutQuery(ctx: Context) {
    // Always approve the pre-checkout query
    // You can add additional validation here if needed
    await ctx.answerPreCheckoutQuery(true);
  }

  async handleSuccessfulPayment(ctx: Context) {
    if (!ctx.message?.successful_payment || !ctx.from) return;

    const payment = ctx.message.successful_payment;
    const userId = ctx.from.id;

    try {
      // Parse the payload to get userId (for verification)
      const payload = JSON.parse(payment.invoice_payload);

      if (payload.userId !== userId) {
        console.error('User ID mismatch in payment');
        await ctx.reply('❌ Произошла ошибка при обработке платежа. Обратитесь в поддержку.');
        return;
      }

      // Activate subscription
      await this.subscriptionService.activateSubscription(
        userId,
        payment.telegram_payment_charge_id
      );

      const info = await this.subscriptionService.getSubscriptionInfo(userId);

      await ctx.reply(
        `🎉 Спасибо за оплату!\n\n` +
        `${info.message}\n\n` +
        `Теперь вы можете использовать бота для скачивания медиа из Telegram.\n\n` +
        `Доступные команды:\n` +
        `/download - Скачать из канала\n` +
        `/story - Скачать историю\n` +
        `/status - Проверить статус подписки`
      );

      console.log(`Subscription activated for user ${userId}, payment: ${payment.telegram_payment_charge_id}`);
    } catch (error) {
      console.error('Error processing successful payment:', error);
      await ctx.reply(
        '⚠️ Платеж получен, но произошла ошибка при активации подписки. ' +
        'Пожалуйста, обратитесь в поддержку с номером транзакции: ' +
        payment.telegram_payment_charge_id
      );
    }
  }

  async handleStatus(ctx: Context) {
    if (!ctx.from) return;

    const userId = ctx.from.id;
    const info = await this.subscriptionService.getSubscriptionInfo(userId);

    await ctx.reply(info.message);
  }
}
