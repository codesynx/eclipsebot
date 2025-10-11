import { Context } from 'grammy';
import { SessionManager } from '../utils/session-manager';
import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';

// Store pending auth states with QR data
interface PendingAuthData {
  client: any;
  timestamp: number;
  qrCheckInterval?: NodeJS.Timeout;
  awaiting2FA?: boolean;
  passwordSrpId?: any;
  passwordSrpB?: any;
  password2FA?: string; // Store 2FA password for QR login
}

const pendingAuth = new Map<number, PendingAuthData>();
const QR_EXPIRATION_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds

export class AuthHandler {
  constructor(private sessionManager: SessionManager) {}

  async handleLogin(ctx: Context) {
    if (!ctx.from) return;

    const userId = ctx.from.id;

    if (this.sessionManager.hasSession(userId)) {
      await ctx.reply('Вы уже авторизованы! Используйте /logout чтобы выйти.');
      return;
    }

    // Clean up any existing auth attempts
    await this.cleanupPendingAuth(userId);

    await ctx.reply(
      '🔐 Авторизация через QR-код\n\n' +
      '❓ У вас включена двухфакторная аутентификация (2FA)?\n\n' +
      '✅ Если да - сначала введите пароль:\n' +
      '/password ваш_пароль_2fa\n\n' +
      '❌ Если нет - нажмите:\n' +
      '/qr\n\n' +
      'Это пароль облачного доступа, который вы установили в настройках приватности Telegram.'
    );
  }

  async handleQR(ctx: Context) {
    if (!ctx.from) return;

    const userId = ctx.from.id;

    if (this.sessionManager.hasSession(userId)) {
      await ctx.reply('Вы уже авторизованы! Используйте /logout чтобы выйти.');
      return;
    }

    // Clean up any existing auth attempts
    await this.cleanupPendingAuth(userId);

    try {
      await ctx.reply('🔄 Генерирую QR-код для авторизации...');

      const client = await this.sessionManager.createClient(userId);

      // Set up QR login
      await client.connect();

      let qrCodeGenerated = false;

      // Store pending auth
      pendingAuth.set(userId, {
        client,
        timestamp: Date.now(),
      });

      const authPromise = client.signInUserWithQrCode(
        {
          apiId: client.apiId,
          apiHash: client.apiHash,
        },
        {
          onError: (err: Error) => {
            console.error('QR auth error:', err);

            // Check if 2FA is required
            if (err.message.includes('2FA') || err.message.includes('SESSION_PASSWORD_NEEDED')) {
              const authData = pendingAuth.get(userId);
              if (authData) {
                authData.awaiting2FA = true;
                pendingAuth.set(userId, authData);
              }

              ctx.reply(
                '🔐 Требуется пароль двухфакторной аутентификации (2FA).\n\n' +
                'Введите ваш пароль облачного доступа:\n' +
                '/password ваш_пароль_2fa'
              ).catch(console.error);
            } else {
              ctx.reply(`❌ Ошибка при авторизации: ${err.message}`).catch(console.error);
              this.cleanupPendingAuth(userId).catch(console.error);
            }
          },
          password: async (_hint?: string) => {
            // This callback is called when 2FA is required during QR login
            await ctx.reply(
              '🔐 Требуется пароль двухфакторной аутентификации (2FA).\n\n' +
              'Введите ваш пароль облачного доступа:\n' +
              '/password ваш_пароль_2fa'
            );

            // Wait for user to provide password via /password command
            // This will be handled by handlePassword method
            const authData = pendingAuth.get(userId);
            if (authData) {
              authData.awaiting2FA = true;
              pendingAuth.set(userId, authData);
            }

            // Return a promise that will be rejected (user will use /password command)
            throw new Error('Awaiting 2FA password input from user');
          },
          qrCode: async (code: { token: Buffer; expires: number }) => {
            if (!qrCodeGenerated) {
              qrCodeGenerated = true;
              const url = `tg://login?token=${code.token.toString('base64url')}`;

              // Generate QR code as text
              let qrText = '';
              qrcode.generate(url, { small: true }, (qr: string) => {
                qrText = qr;
              });

              await ctx.reply(
                '📱 Отсканируйте QR-код в приложении Telegram:\n\n' +
                '1. Откройте Telegram на телефоне\n' +
                '2. Перейдите в Настройки → Устройства → Подключить устройство\n' +
                '3. Отсканируйте QR-код ниже'
              );

              await ctx.reply(
                '```\n' + qrText + '\n```',
                { parse_mode: 'Markdown' }
              );

              await ctx.reply(
                '⏳ Ожидаю подтверждения...\n\n' +
                'QR-код действителен 5 минут.\n' +
                'Для отмены используйте /logout'
              );
            }
          },
        }
      );

      // Wait for authentication
      const user = await authPromise;

      if (user) {
        // Save session
        const sessionString = client.session.save() as any;
        const phone = ('phone' in user) ? user.phone : '';
        const firstName = ('firstName' in user) ? user.firstName : 'пользователь';

        this.sessionManager.saveSession(userId, sessionString, phone || '');

        await ctx.reply(
          '✅ Авторизация успешна!\n\n' +
          `Добро пожаловать, ${firstName}!\n\n` +
          'Теперь вы можете:\n' +
          '• Скачивать истории: /story <ссылка>\n' +
          '• Скачивать из приватных каналов: /download <ссылка>'
        );

        await this.cleanupPendingAuth(userId);
      }
    } catch (error: any) {
      console.error('Auth error:', error);

      if (error.message.includes('TIMEOUT')) {
        await ctx.reply(
          '⏱ Время ожидания истекло!\n\n' +
          'QR-код больше не действителен.\n' +
          'Используйте /login для повторной попытки.'
        );
      } else {
        await ctx.reply(`❌ Ошибка при авторизации: ${error.message}`);
      }

      await this.cleanupPendingAuth(userId);
    }
  }

  private async cleanupPendingAuth(userId: number) {
    const authData = pendingAuth.get(userId);
    if (authData) {
      if (authData.qrCheckInterval) {
        clearInterval(authData.qrCheckInterval);
      }
      pendingAuth.delete(userId);
      await this.sessionManager.disconnectClient(userId);
    }
  }

  async handlePassword(ctx: Context) {
    if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ');

    if (args.length < 2) {
      await ctx.reply(
        'Пожалуйста, укажите пароль 2FA.\n\n' +
        'Пример: /password ваш_пароль_2fa\n\n' +
        '⚠️ Это пароль облачного доступа, который вы установили в Telegram.'
      );
      return;
    }

    const password = args.slice(1).join(' ');

    // Check if user already has pending auth with 2FA flag
    const existingAuthData = pendingAuth.get(userId);

    if (existingAuthData?.awaiting2FA) {
      // User is trying to enter password after QR scan failed
      try {
        await ctx.reply('🔐 Проверяю пароль 2FA...');

        const { client } = existingAuthData;
        const Api = (await import('telegram/tl')).Api;

        try {
          // Get password info
          const passwordSrp = await client.invoke(new Api.account.GetPassword());

          // Check password
          await client.checkPassword(passwordSrp, password);

          // If successful, save session
          const me = await client.getMe();
          const sessionString = client.session.save() as any;
          const phone = ('phone' in me) ? me.phone : '';
          const firstName = ('firstName' in me) ? me.firstName : 'пользователь';

          this.sessionManager.saveSession(userId, sessionString, phone || '');

          await ctx.reply(
            '✅ Авторизация успешна!\n\n' +
            `Добро пожаловать, ${firstName}!\n\n` +
            'Теперь вы можете:\n' +
            '• Скачивать истории: /story <ссылка>\n' +
            '• Скачивать из приватных каналов: /download <ссылка>'
          );

          await this.cleanupPendingAuth(userId);
          return;
        } catch (passError: any) {
          if (passError.message.includes('PASSWORD_HASH_INVALID')) {
            await ctx.reply(
              '❌ Неверный пароль 2FA!\n\n' +
              'Проверьте пароль и попробуйте снова:\n' +
              '/password ваш_пароль_2fa\n\n' +
              'Или начните заново: /login'
            );
            return;
          } else {
            throw passError;
          }
        }
      } catch (error: any) {
        console.error('Password verification error:', error);
        await ctx.reply(
          `❌ Ошибка при проверке пароля: ${error.message}\n\n` +
          'Попробуйте начать заново: /login'
        );
        await this.cleanupPendingAuth(userId);
        return;
      }
    }

    // User is setting password before QR scan - store it and generate QR
    await ctx.reply(
      '✅ Пароль сохранен!\n\n' +
      '🔄 Генерирую QR-код для авторизации...'
    );

    // Clean up any existing auth
    await this.cleanupPendingAuth(userId);

    try {
      const client = await this.sessionManager.createClient(userId);
      await client.connect();

      let qrCodeGenerated = false;

      // Store password before starting auth
      pendingAuth.set(userId, {
        client,
        timestamp: Date.now(),
        password2FA: password,
      });

      const authPromise = client.signInUserWithQrCode(
        {
          apiId: client.apiId,
          apiHash: client.apiHash,
        },
        {
          onError: (err: Error) => {
            console.error('QR auth error:', err);

            // Check if 2FA is required
            if (err.message.includes('2FA') || err.message.includes('SESSION_PASSWORD_NEEDED')) {
              ctx.reply('🔐 Требуется ввод пароля 2FA. Проверяю сохраненный пароль...').catch(console.error);

              // The error is thrown but we need to handle 2FA differently
              // Don't try to fix it here, let the user flow handle it
              ctx.reply(
                '❌ QR-авторизация не может автоматически обработать 2FA.\n\n' +
                'Попробуйте альтернативный метод авторизации через номер телефона,\n' +
                'или обратитесь к разработчику для реализации этой функции.'
              ).catch(console.error);
            } else {
              ctx.reply(`❌ Ошибка при авторизации: ${err.message}`).catch(console.error);
            }

            this.cleanupPendingAuth(userId).catch(console.error);
          },
          password: async (_hint?: string) => {
            // This callback is called when 2FA is required
            await ctx.reply('🔐 Обрабатываю двухфакторную аутентификацию...');

            const authData = pendingAuth.get(userId);
            if (authData?.password2FA) {
              return authData.password2FA;
            }

            throw new Error('2FA password not provided');
          },
          qrCode: async (code: { token: Buffer; expires: number }) => {
            if (!qrCodeGenerated) {
              qrCodeGenerated = true;
              const url = `tg://login?token=${code.token.toString('base64url')}`;

              let qrText = '';
              qrcode.generate(url, { small: true }, (qr: string) => {
                qrText = qr;
              });

              await ctx.reply(
                '📱 Отсканируйте QR-код в приложении Telegram:\n\n' +
                '1. Откройте Telegram на телефоне\n' +
                '2. Настройки → Устройства → Подключить устройство\n' +
                '3. Отсканируйте QR-код ниже'
              );

              await ctx.reply(
                '```\n' + qrText + '\n```',
                { parse_mode: 'Markdown' }
              );

              await ctx.reply(
                '⏳ Ожидаю подтверждения...\n\n' +
                '🔐 Ваш пароль 2FA уже сохранен и будет использован автоматически.\n' +
                'Для отмены используйте /logout'
              );
            }
          },
        }
      );

      const user = await authPromise;

      if (user) {
        const sessionString = client.session.save() as any;
        const phone = ('phone' in user) ? user.phone : '';
        const firstName = ('firstName' in user) ? user.firstName : 'пользователь';

        this.sessionManager.saveSession(userId, sessionString, phone || '');

        await ctx.reply(
          '✅ Авторизация успешна!\n\n' +
          `Добро пожаловать, ${firstName}!\n\n` +
          'Теперь вы можете:\n' +
          '• Скачивать истории: /story <ссылка>\n' +
          '• Скачивать из приватных каналов: /download <ссылка>'
        );

        await this.cleanupPendingAuth(userId);
      }
    } catch (error: any) {
      console.error('Auth error:', error);

      if (error.message.includes('TIMEOUT')) {
        await ctx.reply(
          '⏱ Время ожидания истекло!\n\n' +
          'QR-код больше не действителен.\n' +
          'Попробуйте снова: /password ваш_пароль_2fa'
        );
      } else if (error.message.includes('PASSWORD_HASH_INVALID')) {
        await ctx.reply(
          '❌ Неверный пароль 2FA!\n\n' +
          'Проверьте пароль и попробуйте снова:\n' +
          '/password ваш_правильный_пароль_2fa'
        );
      } else {
        await ctx.reply(`❌ Ошибка при авторизации: ${error.message}`);
      }

      await this.cleanupPendingAuth(userId);
    }
  }


  async handleLogout(ctx: Context) {
    if (!ctx.from) return;

    const userId = ctx.from.id;

    if (!this.sessionManager.hasSession(userId)) {
      await ctx.reply('Вы не авторизованы.');
      return;
    }

    await this.sessionManager.disconnectClient(userId);
    this.sessionManager.removeSession(userId);
    pendingAuth.delete(userId);

    await ctx.reply('Вы вышли из системы.');
  }
}
