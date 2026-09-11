export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramVoice = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  business_connection_id?: string;
};

export type TelegramBusinessConnection = {
  id: string;
  user: TelegramUser;
  is_enabled: boolean;
  rights?: { can_reply?: boolean };
  can_reply?: boolean;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  business_message?: TelegramMessage;
  business_connection?: TelegramBusinessConnection;
};
