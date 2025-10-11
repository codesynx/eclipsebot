export interface UserSession {
  userId: number;
  phoneNumber?: string;
  sessionString?: string;
  isAuthenticated: boolean;
}

export interface DownloadRequest {
  userId: number;
  url: string;
  type: 'story' | 'channel';
}
