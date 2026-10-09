export interface Room {
  id: number;
  name: string;
  member_count: number;
  is_member: boolean;
}

export interface ChatMessage {
  message_id: string;
  room_id: number;
  user_id: number;
  username: string;
  content: string;
  kind?: 'message' | 'system';
  created_at: string;
  isNew?: boolean;
}

export interface RoomChange {
  id: number;
  name: string;
  member_count: number;
}

export interface PresenceUser {
  id: number;
  username: string;
}

export interface PresenceEvent {
  room_id: number;
  users: PresenceUser[];
}

export interface TypingEvent {
  room_id: number;
  username: string;
  is_typing: boolean;
}

export interface Ack {
  ok: boolean;
  error?: string;
  message_id?: string;
}