import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { API_URL } from './config';
import { ChatMessage } from './models';

@Injectable({ providedIn: 'root' })
export class MessageService {
  private http = inject(HttpClient);

  /** Oldest first. Pass `before` (a message_id) to load the page of older messages. */
  history(roomId: number, before?: string, limit = 30) {
    let params = new HttpParams().set('limit', limit);
    if (before) params = params.set('before', before);
    return this.http.get<ChatMessage[]>(`${API_URL}/rooms/${roomId}/messages`, { params });
  }
}