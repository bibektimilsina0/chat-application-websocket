import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_URL } from './config';
import { Room } from './models';

@Injectable({ providedIn: 'root' })
export class RoomService {
  private http = inject(HttpClient);

  list() {
    return this.http.get<Room[]>(`${API_URL}/rooms`);
  }

  create(name: string) {
    return this.http.post<Room>(`${API_URL}/rooms/create`, { name });
  }

  /** Idempotent on the backend, so it's safe to call every time a room is opened. */
  join(roomId: number) {
    return this.http.post<Room>(`${API_URL}/rooms/${roomId}/join`, {});
  }
}