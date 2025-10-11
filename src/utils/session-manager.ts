import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { config } from '../config';
import type { UserSession } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class SessionManager {
  private sessions: Map<number, TelegramClient> = new Map();
  private sessionData: Map<number, UserSession> = new Map();
  private sessionFilePath: string;

  constructor() {
    this.sessionFilePath = path.join(config.sessionPath, 'sessions.json');
    this.loadSessions();
  }

  private loadSessions() {
    try {
      if (!fs.existsSync(config.sessionPath)) {
        fs.mkdirSync(config.sessionPath, { recursive: true });
      }

      if (fs.existsSync(this.sessionFilePath)) {
        const data = fs.readFileSync(this.sessionFilePath, 'utf-8');
        const sessions: UserSession[] = JSON.parse(data);
        sessions.forEach(session => {
          this.sessionData.set(session.userId, session);
        });
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  }

  private saveSessions() {
    try {
      const sessions = Array.from(this.sessionData.values());
      fs.writeFileSync(this.sessionFilePath, JSON.stringify(sessions, null, 2));
    } catch (error) {
      console.error('Error saving sessions:', error);
    }
  }

  async createClient(userId: number, sessionString?: string): Promise<TelegramClient> {
    const session = new StringSession(sessionString || '');
    const client = new TelegramClient(session, config.apiId, config.apiHash, {
      connectionRetries: 5,
      deviceModel: 'Desktop',
      systemVersion: 'macOS 14.0',
      appVersion: '1.0.0',
      langCode: 'en',
      systemLangCode: 'en-US',
    });

    this.sessions.set(userId, client);
    return client;
  }

  async getClient(userId: number): Promise<TelegramClient | null> {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId)!;
    }

    const sessionData = this.sessionData.get(userId);
    if (sessionData?.sessionString && sessionData.isAuthenticated) {
      const client = await this.createClient(userId, sessionData.sessionString);
      await client.connect();
      return client;
    }

    return null;
  }

  saveSession(userId: number, sessionString: string, phoneNumber: string) {
    this.sessionData.set(userId, {
      userId,
      phoneNumber,
      sessionString,
      isAuthenticated: true,
    });
    this.saveSessions();
  }

  hasSession(userId: number): boolean {
    return this.sessionData.has(userId) && this.sessionData.get(userId)!.isAuthenticated;
  }

  removeSession(userId: number) {
    this.sessions.delete(userId);
    this.sessionData.delete(userId);
    this.saveSessions();
  }

  async disconnectClient(userId: number) {
    const client = this.sessions.get(userId);
    if (client) {
      try {
        // Add timeout to disconnect operation
        await Promise.race([
          client.disconnect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Disconnect timeout')), 5000)
          ),
        ]);
      } catch (error: any) {
        // Ignore timeout errors during disconnect
        if (error.message !== 'Disconnect timeout') {
          console.error('Error disconnecting client:', error);
        }
      } finally {
        this.sessions.delete(userId);
      }
    }
  }
}
