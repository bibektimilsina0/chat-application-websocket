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
  upload(roomId: number, file: File) {
    const body = new FormData();
    body.append('file', file);
    // No Content-Type header: the browser must set the multipart boundary itself
    return this.http.post<ChatMessage>(`${API_URL}/rooms/${roomId}/files`, body, {
      observe: 'events',
      reportProgress: true,
    });
  }

  fileUrl(roomId: number, key: string, name: string) {
    return `${API_URL}/rooms/${roomId}/files/${key}?filename=${encodeURIComponent(name)}`;
  }
}