export interface Subscription {
  userId: number;
  isActive: boolean;
  expiresAt: number; // Unix timestamp
  createdAt: number; // Unix timestamp
  lastPaymentId?: string;
  notificationSent: boolean;
}

export interface PaymentConfig {
  priceStars: number;
  subscriptionDurationDays: number;
  title: string;
  description: string;
}

export const SUBSCRIPTION_CONFIG: PaymentConfig = {
  priceStars: 120,
  subscriptionDurationDays: 30,
  title: 'Подписка на бота',
  description: 'Месячная подписка для скачивания медиа из Telegram',
};
