import { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import * as fs from 'fs';
import * as path from 'path';

export class DownloadService {
  private downloadPath: string;

  constructor() {
    this.downloadPath = './downloads';
    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }
  }

  async downloadStory(client: TelegramClient, storyUrl: string): Promise<string | null> {
    try {
      // Parse story URL: https://t.me/username/s/storyId or tg://resolve?domain=username&story=storyId
      const match = storyUrl.match(/(?:t\.me\/|tg:\/\/resolve\?domain=)([^\/\?&]+)(?:\/s\/|&story=)(\d+)/);

      if (!match) {
        throw new Error('Invalid story URL format');
      }

      const [, username, storyIdStr] = match;
      const storyId = parseInt(storyIdStr);

      // Get user/channel entity
      const entity = await client.getEntity(username);

      // Get stories
      const result = await client.invoke(
        new Api.stories.GetStoriesByID({
          peer: entity,
          id: [storyId],
        })
      );

      if (!result.stories || result.stories.length === 0) {
        throw new Error('Story not found');
      }

      const story = result.stories[0];
      if (!(story instanceof Api.StoryItem)) {
        throw new Error('Invalid story type');
      }

      // Download media from story
      if (story.media) {
        const fileName = `story_${username}_${storyId}_${Date.now()}`;
        const filePath = await this.downloadMedia(client, story.media, fileName);
        return filePath;
      }

      throw new Error('Story has no media');
    } catch (error) {
      console.error('Error downloading story:', error);
      throw error;
    }
  }

  async downloadFromChannel(client: TelegramClient, channelUrl: string, messageId?: number): Promise<string | null> {
    try {
      // Parse channel URL: https://t.me/c/channelId/messageId or https://t.me/username/messageId
      let channel: any;
      let msgId: number | undefined = messageId;

      if (channelUrl.includes('/c/')) {
        // Private channel
        const match = channelUrl.match(/\/c\/(\d+)(?:\/(\d+))?/);
        if (!match) throw new Error('Invalid private channel URL');

        const channelId = BigInt('-100' + match[1]);
        msgId = msgId || (match[2] ? parseInt(match[2]) : undefined);
        channel = await client.getEntity(channelId);
      } else {
        // Public channel
        const match = channelUrl.match(/t\.me\/([^\/]+)(?:\/(\d+))?/);
        if (!match) throw new Error('Invalid channel URL');

        const username = match[1];
        msgId = msgId || (match[2] ? parseInt(match[2]) : undefined);
        channel = await client.getEntity(username);
      }

      if (!msgId) {
        throw new Error('Message ID is required');
      }

      // Get specific message
      const messages = await client.getMessages(channel, { ids: [msgId] });

      if (!messages || messages.length === 0) {
        throw new Error('Message not found');
      }

      const message = messages[0];

      // Download media from message
      if (message.media) {
        const fileName = `channel_${Date.now()}`;
        const filePath = await this.downloadMedia(client, message.media, fileName);
        return filePath;
      }

      throw new Error('Message has no media');
    } catch (error) {
      console.error('Error downloading from channel:', error);
      throw error;
    }
  }

  private async downloadMedia(client: TelegramClient, media: any, fileName: string): Promise<string> {
    const buffer = await client.downloadMedia(media, {});

    if (!buffer) {
      throw new Error('Failed to download media');
    }

    // Determine file extension based on media type
    let extension = '';
    if (media instanceof Api.MessageMediaPhoto || media.photo) {
      extension = '.jpg';
    } else if (media instanceof Api.MessageMediaDocument || media.document) {
      const doc = media.document || media;
      if (doc.mimeType) {
        if (doc.mimeType.includes('video')) extension = '.mp4';
        else if (doc.mimeType.includes('image')) extension = '.jpg';
        else extension = '';
      }
    }

    const filePath = path.join(this.downloadPath, fileName + extension);

    if (buffer instanceof Buffer) {
      fs.writeFileSync(filePath, buffer);
    } else {
      // If it's not a Buffer, convert it
      const uint8Array = new Uint8Array(buffer as any);
      fs.writeFileSync(filePath, uint8Array);
    }

    return filePath;
  }

  getDownloadPath(): string {
    return this.downloadPath;
  }
}
