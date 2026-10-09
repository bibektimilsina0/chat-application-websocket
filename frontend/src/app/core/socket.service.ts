import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { io } from 'socket.io-client';
import { API_URL } from './config';
import { AuthService } from './auth.service';
import { Ack } from './models';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private auth = inject(AuthService);

  // autoConnect:false lets components attach listeners before the connection opens
  private socket = io(API_URL, {
    autoConnect: false,
    withCredentials: true, // browser sends the httpOnly cookies in the handshake
    transports: ['websocket'],
  });

  readonly connected = signal(false);
  private authRetried = false;

  constructor() {
        // Logged out (by button, or because the session died) -> close the socket
    effect(() => {
      if (!this.auth.user()) this.socket.disconnect();
    });
    this.socket.on('connect', () => {
      this.connected.set(true);
      this.authRetried = false;
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('connect_error', (err) => {
      this.connected.set(false);
      if (err.message !== 'unauthorized') return; // other errors: socket.io retries by itself
      if (this.authRetried) {
        this.auth.logout(false);
        return;
      }
      this.authRetried = true;
      this.refreshAndReconnect();
    });
  }

  /** Refresh the cookie via a normal HTTP call, then connect. */
  async connect(): Promise<void> {
    if (this.socket.connected || this.socket.active) return;
    await firstValueFrom(this.auth.me());
    this.socket.connect();
  }

  disconnect() {
    this.socket.disconnect();
  }

  on<T>(event: string): Observable<T> {
    return new Observable<T>((subscriber) => {
      const handler = (data: T) => subscriber.next(data);
      this.socket.on(event, handler);
      return () => this.socket.off(event, handler);
    });
  }

  /** Emit and wait for the server's acknowledgement ({ok, error?}). */
  async emit(event: string, payload: unknown): Promise<Ack> {
    try {
      return await this.socket.timeout(5000).emitWithAck(event, payload);
    } catch {
      return { ok: false, error: 'No response from the server' };
    }
  }

  /** Fire and forget (typing). */
  send(event: string, payload: unknown) {
    this.socket.emit(event, payload);
  }

  private async refreshAndReconnect() {
    try {
      await firstValueFrom(this.auth.me());
      this.socket.connect();
    } catch {
      this.auth.logout(false);
    }
  }
}