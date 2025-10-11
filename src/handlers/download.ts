import { Context, InlineKeyboard } from 'grammy';
import { SessionManager } from '../utils/session-manager';
import { DownloadService } from '../services/downloader';
import { SubscriptionService } from '../services/subscription';
import * as fs from 'fs';

// Store user's download state
interface DownloadState {
  channelId?: string;
  channelName?: string;
  awaitingRange?: boolean;
}

const downloadStates = new Map<number, DownloadState>();

export class DownloadHandler {
  private downloadService: DownloadService;
  private subscriptionService: SubscriptionService;

  constructor(private sessionManager: SessionManager, subscriptionService: SubscriptionService) {
    this.downloadService = new DownloadService();
    this.subscriptionService = subscriptionService;
  }

  async handleStory(ctx: Context) {
    if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

    const userId = ctx.from.id;
    if (!ctx.message.text) return;
    const args = ctx.message.text.split(' ');

    if (args.length < 2) {
      await ctx.reply(
        'Пожалуйста, укажите ссылку на историю.\n\n' +
        'Примеры:\n' +
        '/story https://t.me/username/s/123\n' +
        '/story tg://resolve?domain=username&story=123'
      );
      return;
    }

    const storyUrl = args[1]?.trim();
    if (!storyUrl) {
      await ctx.reply('❌ Неверная ссылка на историю.');
      return;
    }

    // Check if user is authenticated for private stories
    const client = await this.sessionManager.getClient(userId);

    if (!client) {
      await ctx.reply(
        '⚠️ Для скачивания историй необходима авторизация.\n\n' +
        'Используйте /login чтобы авторизоваться.'
      );
      return;
    }

    // Check subscription
    const hasSubscription = await this.subscriptionService.checkSubscription(userId);
    if (!hasSubscription) {
      await ctx.reply(
        '❌ У вас нет активной подписки!\n\n' +
        'Для скачивания медиа необходимо оформить подписку.\n' +
        'Используйте /subscribe для оформления подписки.'
      );
      return;
    }

    try {
      await ctx.reply('Загружаю историю...');

      const filePath = await this.downloadService.downloadStory(client, storyUrl);

      if (filePath) {
        await ctx.replyWithDocument(new (await import('grammy')).InputFile(filePath), {
          caption: 'История загружена ✅',
        });

        // Clean up downloaded file
        fs.unlinkSync(filePath);
      } else {
        await ctx.reply('Не удалось скачать историю.');
      }
    } catch (error: any) {
      console.error('Story download error:', error);
      await ctx.reply(`Ошибка при скачивании истории: ${error.message}`);
    }
  }

  async handleDownload(ctx: Context) {
    if (!ctx.from) return;

    const userId = ctx.from.id;

    const client = await this.sessionManager.getClient(userId);

    if (!client) {
      await ctx.reply(
        '⚠️ Для скачивания из каналов необходима авторизация.\n\n' +
        'Используйте /login чтобы авторизоваться.'
      );
      return;
    }

    // Check subscription
    const hasSubscription = await this.subscriptionService.checkSubscription(userId);
    if (!hasSubscription) {
      await ctx.reply(
        '❌ У вас нет активной подписки!\n\n' +
        'Для скачивания медиа необходимо оформить подписку.\n' +
        'Используйте /subscribe для оформления подписки.'
      );
      return;
    }

    try {
      await ctx.reply('📡 Загружаю список ваших каналов...');

      // Get user's dialogs (chats)
      const dialogs = await client.getDialogs({ limit: 100 });

      // Filter only channels
      const channels = dialogs.filter((dialog) => {
        const entity = dialog.entity;
        return (
          entity &&
          (entity.className === 'Channel' ||
          entity.className === 'Chat')
        );
      });

      if (channels.length === 0) {
        await ctx.reply('❌ У вас нет доступных каналов.');
        return;
      }

      // Create inline keyboard with channels (max 100 buttons, 2 per row)
      const keyboard = new InlineKeyboard();
      let count = 0;

      for (const channel of channels.slice(0, 50)) {
        // Limit to 50 channels
        const entity = channel.entity as any;
        const channelName = entity.title || entity.username || 'Без названия';
        const channelId = entity.id.toString();

        keyboard.text(
          channelName.length > 30 ? channelName.slice(0, 27) + '...' : channelName,
          `ch_${channelId}`
        );

        count++;
        if (count % 2 === 0) {
          keyboard.row();
        }
      }

      if (count % 2 !== 0) {
        keyboard.row();
      }

      keyboard.text('❌ Отмена', 'cancel_download');

      await ctx.reply(
        '📋 Выберите канал, из которого хотите скачать медиа:\n\n' +
        '(Показано первых 50 каналов)',
        {
          reply_markup: keyboard,
        }
      );
    } catch (error: any) {
      console.error('Channel list error:', error);
      await ctx.reply(`❌ Ошибка при загрузке каналов: ${error.message}`);
    }
  }

  async handleChannelSelection(ctx: Context) {
    if (!ctx.callbackQuery || !ctx.from) return;

    const userId = ctx.from.id;
    const data = ctx.callbackQuery.data;

    if (!data) return;

    if (data === 'cancel_download') {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('❌ Скачивание отменено.');
      downloadStates.delete(userId);
      return;
    }

    if (data.startsWith('ch_')) {
      const channelId = data.replace('ch_', '');

      const client = await this.sessionManager.getClient(userId);
      if (!client) {
        await ctx.answerCallbackQuery({ text: 'Ошибка: нет авторизации' });
        return;
      }

      try {
        // Get channel info
        const entity = await client.getEntity(parseInt(channelId));
        const channelName = (entity as any).title || (entity as any).username || 'Канал';

        // Save state
        downloadStates.set(userId, {
          channelId,
          channelName,
          awaitingRange: true,
        });

        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
          `✅ Выбран канал: ${channelName}\n\n` +
          '📝 Теперь отправьте номер сообщения или диапазон:\n\n' +
          'Примеры:\n' +
          '• 1 - скачать первое сообщение\n' +
          '• 10 - скачать 10-е сообщение\n' +
          '• 1-20 - скачать сообщения с 1 по 20\n' +
          '• 5-10 - скачать сообщения с 5 по 10\n\n' +
          '⚠️ Максимум 50 сообщений за раз'
        );
      } catch (error: any) {
        console.error('Channel selection error:', error);
        await ctx.answerCallbackQuery({ text: 'Ошибка при выборе канала' });
        await ctx.editMessageText(`❌ Ошибка: ${error.message}`);
      }
    }
  }

  async handleMessageRangeInput(ctx: Context) {
    if (!ctx.from || !ctx.message || !('text' in ctx.message)) return;

    const userId = ctx.from.id;
    const state = downloadStates.get(userId);

    if (!state || !state.awaitingRange) {
      return; // Not waiting for range input
    }

    if (!ctx.message.text) return;
    const input = ctx.message.text.trim();

    // Parse input (e.g., "1", "1-20")
    let startMsg: number;
    let endMsg: number;

    if (input.includes('-')) {
      const parts = input.split('-');
      if (parts.length !== 2) {
        await ctx.reply('❌ Неверный формат. Используйте: 1-20');
        return;
      }
      startMsg = parseInt(parts[0]?.trim() || '0');
      endMsg = parseInt(parts[1]?.trim() || '0');
    } else {
      startMsg = parseInt(input);
      endMsg = startMsg;
    }

    if (isNaN(startMsg) || isNaN(endMsg) || startMsg < 1 || endMsg < startMsg) {
      await ctx.reply('❌ Неверный формат. Используйте: 1 или 1-20');
      return;
    }

    if (endMsg - startMsg + 1 > 50) {
      await ctx.reply('❌ Максимум 50 сообщений за раз. Уменьшите диапазон.');
      return;
    }

    const client = await this.sessionManager.getClient(userId);
    if (!client) {
      await ctx.reply('❌ Ошибка: нет авторизации');
      downloadStates.delete(userId);
      return;
    }

    try {
      await ctx.reply(
        `📥 Скачиваю сообщения ${startMsg}${endMsg !== startMsg ? `-${endMsg}` : ''} из канала "${state.channelName}"...\n\n` +
        'Это может занять некоторое время...'
      );

      const entity = await client.getEntity(parseInt(state.channelId!));
      const messages = await client.getMessages(entity, {
        limit: endMsg,
      });

      // Filter messages in range
      const targetMessages = messages
        .reverse()
        .slice(startMsg - 1, endMsg)
        .filter((msg) => msg.media);

      if (targetMessages.length === 0) {
        await ctx.reply('❌ В указанном диапазоне нет сообщений с медиа.');
        downloadStates.delete(userId);
        return;
      }

      await ctx.reply(`✅ Найдено ${targetMessages.length} сообщений с медиа. Начинаю скачивание...`);

      // Download each message
      for (let i = 0; i < targetMessages.length; i++) {
        const msg = targetMessages[i];
        if (!msg || !msg.media) continue;

        try {
          const buffer = await client.downloadMedia(msg.media, {});

          if (buffer) {
            const InputFile = (await import('grammy')).InputFile;

            // Determine media type
            if (msg.photo) {
              await ctx.replyWithPhoto(new InputFile(buffer as Buffer), {
                caption: `📷 Сообщение #${msg.id} (${i + 1}/${targetMessages.length})`,
              });
            } else if (msg.video) {
              await ctx.replyWithVideo(new InputFile(buffer as Buffer), {
                caption: `🎥 Сообщение #${msg.id} (${i + 1}/${targetMessages.length})`,
              });
            } else {
              await ctx.replyWithDocument(new InputFile(buffer as Buffer), {
                caption: `📎 Сообщение #${msg.id} (${i + 1}/${targetMessages.length})`,
              });
            }
          }
        } catch (downloadError: any) {
          console.error('Download error for message:', msg?.id, downloadError);
          await ctx.reply(`⚠️ Не удалось скачать сообщение #${msg?.id || 'unknown'}`);
        }
      }

      await ctx.reply(`✅ Скачивание завершено! Обработано ${targetMessages.length} сообщений.`);
      downloadStates.delete(userId);
    } catch (error: any) {
      console.error('Download range error:', error);
      await ctx.reply(`❌ Ошибка при скачивании: ${error.message}`);
      downloadStates.delete(userId);
    }
  }
}
