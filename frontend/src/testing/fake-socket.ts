type Handler = (...args: any[]) => void;

export class FakeSocket {
  connected = false;
  active = false;
  ackResponse: unknown = { ok: true };
  ackFails = false;
  emitted: { event: string; payload?: unknown }[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler?: Handler) {
    if (handler) this.handlers.get(event)?.delete(handler);
    else this.handlers.delete(event);
    return this;
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
    return this;
  }

  timeout(_ms: number) {
    return {
      emitWithAck: (event: string, payload?: unknown) => {
        this.emitted.push({ event, payload });
        return this.ackFails ? Promise.reject(new Error('timeout')) : Promise.resolve(this.ackResponse);
      },
    };
  }

  connect() {
    this.connectCalls++;
    this.active = true;
    return this;
  }

  disconnect() {
    this.disconnectCalls++;
    this.active = false;
    this.connected = false;
    return this;
  }

  /** Simulate an event arriving from the server. */
  serverEmits(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }

  listenerCount(event: string) {
    return this.handlers.get(event)?.size ?? 0;
  }
}