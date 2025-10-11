import { Database } from 'bun:sqlite';
import type { Subscription } from '../types/subscription';

export class DatabaseService {
  private db: Database;

  constructor(dbPath: string = './data/subscriptions.db') {
    // Ensure data directory exists
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    try {
      const fs = require('fs');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      console.error('Error creating directory:', error);
    }

    this.db = new Database(dbPath);
    this.initDatabase();
  }

  private initDatabase() {
    // Create subscriptions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        user_id INTEGER PRIMARY KEY,
        is_active INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_payment_id TEXT,
        notification_sent INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Create index for faster queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_expires_at
      ON subscriptions(expires_at)
    `);
  }

  async getSubscription(userId: number): Promise<Subscription | null> {
    const query = this.db.query(`
      SELECT
        user_id as userId,
        is_active as isActive,
        expires_at as expiresAt,
        created_at as createdAt,
        last_payment_id as lastPaymentId,
        notification_sent as notificationSent
      FROM subscriptions
      WHERE user_id = ?
    `);

    const result = query.get(userId) as any;
    if (!result) return null;

    return {
      userId: result.userId,
      isActive: Boolean(result.isActive),
      expiresAt: result.expiresAt,
      createdAt: result.createdAt,
      lastPaymentId: result.lastPaymentId,
      notificationSent: Boolean(result.notificationSent),
    };
  }

  async createOrUpdateSubscription(
    userId: number,
    durationDays: number,
    paymentId?: string
  ): Promise<void> {
    const now = Date.now();
    const expiresAt = now + durationDays * 24 * 60 * 60 * 1000;

    const existingSubscription = await this.getSubscription(userId);

    if (existingSubscription) {
      // Extend existing subscription
      const newExpiresAt = existingSubscription.isActive && existingSubscription.expiresAt > now
        ? existingSubscription.expiresAt + durationDays * 24 * 60 * 60 * 1000
        : expiresAt;

      const query = this.db.query(`
        UPDATE subscriptions
        SET is_active = 1,
            expires_at = ?,
            last_payment_id = ?,
            notification_sent = 0
        WHERE user_id = ?
      `);

      query.run(newExpiresAt, paymentId || existingSubscription.lastPaymentId, userId);
    } else {
      // Create new subscription
      const query = this.db.query(`
        INSERT INTO subscriptions
        (user_id, is_active, expires_at, created_at, last_payment_id, notification_sent)
        VALUES (?, 1, ?, ?, ?, 0)
      `);

      query.run(userId, expiresAt, now, paymentId || null);
    }
  }

  async deactivateSubscription(userId: number): Promise<void> {
    const query = this.db.query(`
      UPDATE subscriptions
      SET is_active = 0
      WHERE user_id = ?
    `);

    query.run(userId);
  }

  async isSubscriptionActive(userId: number): Promise<boolean> {
    const subscription = await this.getSubscription(userId);
    if (!subscription || !subscription.isActive) return false;

    const now = Date.now();
    if (subscription.expiresAt < now) {
      // Subscription expired, deactivate it
      await this.deactivateSubscription(userId);
      return false;
    }

    return true;
  }

  async getExpiredSubscriptions(): Promise<Subscription[]> {
    const now = Date.now();
    const query = this.db.query(`
      SELECT
        user_id as userId,
        is_active as isActive,
        expires_at as expiresAt,
        created_at as createdAt,
        last_payment_id as lastPaymentId,
        notification_sent as notificationSent
      FROM subscriptions
      WHERE is_active = 1 AND expires_at < ?
    `);

    const results = query.all(now) as any[];
    return results.map(r => ({
      userId: r.userId,
      isActive: Boolean(r.isActive),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      lastPaymentId: r.lastPaymentId,
      notificationSent: Boolean(r.notificationSent),
    }));
  }

  async getExpiringSubscriptions(daysBeforeExpiry: number = 3): Promise<Subscription[]> {
    const now = Date.now();
    const threshold = now + daysBeforeExpiry * 24 * 60 * 60 * 1000;

    const query = this.db.query(`
      SELECT
        user_id as userId,
        is_active as isActive,
        expires_at as expiresAt,
        created_at as createdAt,
        last_payment_id as lastPaymentId,
        notification_sent as notificationSent
      FROM subscriptions
      WHERE is_active = 1
        AND expires_at > ?
        AND expires_at < ?
        AND notification_sent = 0
    `);

    const results = query.all(now, threshold) as any[];
    return results.map(r => ({
      userId: r.userId,
      isActive: Boolean(r.isActive),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      lastPaymentId: r.lastPaymentId,
      notificationSent: Boolean(r.notificationSent),
    }));
  }

  async markNotificationSent(userId: number): Promise<void> {
    const query = this.db.query(`
      UPDATE subscriptions
      SET notification_sent = 1
      WHERE user_id = ?
    `);

    query.run(userId);
  }

  close() {
    this.db.close();
  }
}
