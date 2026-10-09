import { signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Ack } from '../app/core/models';

export class FakeSocketService {
  readonly connected = signal(true);
  ack: Ack = { ok: true };
  emitted: { event: string; payload: unknown }[] = [];
  sent: { event: string; payload: unknown }[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  private subjects = new Map<string, Subject<unknown>>();

  private subject(event: string) {
    let s = this.subjects.get(event);
    if (!s) {
      s = new Subject<unknown>();
      this.subjects.set(event, s);
    }
    return s;
  }

  on<T>(event: string): Observable<T> {
    return this.subject(event).asObservable() as Observable<T>;
  }

  /** Simulate the server pushing an event to the component. */
  push(event: string, payload?: unknown) {
    this.subject(event).next(payload);
  }

  async connect() {
    this.connectCalls++;
  }

  disconnect() {
    this.disconnectCalls++;
  }

  async emit(event: string, payload: unknown): Promise<Ack> {
    this.emitted.push({ event, payload });
    return this.ack;
  }

  send(event: string, payload: unknown) {
    this.sent.push({ event, payload });
  }
}