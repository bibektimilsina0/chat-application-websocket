import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { Socket } from 'socket.io-client';
import { AuthService, User } from './auth.service';
import { SOCKET_FACTORY, SocketService } from './socket.service';
import { FakeSocket } from '../../testing/fake-socket';
import { flushPromises } from '../../testing/flush';

describe('SocketService', () => {
  let socket: FakeSocket;
  let user: WritableSignal<User | null>;
  let me: jasmine.Spy;
  let logout: jasmine.Spy;
  let service: SocketService;

  beforeEach(() => {
    socket = new FakeSocket();
    user = signal<User | null>({ id: 1, username: 'alice' });
    me = jasmine.createSpy('me').and.returnValue(of({ id: 1, username: 'alice' }));
    logout = jasmine.createSpy('logout');

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user, me, logout } },
        { provide: SOCKET_FACTORY, useValue: () => socket as unknown as Socket },
      ],
    });
    service = TestBed.inject(SocketService);
  });

  describe('connecting', () => {
    it('refreshes the session cookie first, then opens the socket', async () => {
      me.and.callFake(() => {
        expect(socket.connectCalls).toBe(0); // /auth/me must come before connect()
        return of({ id: 1, username: 'alice' });
      });

      await service.connect();

      expect(me).toHaveBeenCalledTimes(1);
      expect(socket.connectCalls).toBe(1);
    });

    it('does nothing when already connecting or connected', async () => {
      socket.active = true;
      await service.connect();
      expect(me).not.toHaveBeenCalled();
      expect(socket.connectCalls).toBe(0);
    });

    it('tracks the connection state', () => {
      expect(service.connected()).toBeFalse();
      socket.serverEmits('connect');
      expect(service.connected()).toBeTrue();
      socket.serverEmits('disconnect');
      expect(service.connected()).toBeFalse();
    });
  });

  describe('receiving events', () => {
    it('turns socket events into an observable and cleans up on unsubscribe', () => {
      const received: string[] = [];
      const sub = service.on<string>('receive_message').subscribe((m) => received.push(m));

      socket.serverEmits('receive_message', 'hi');
      sub.unsubscribe();
      socket.serverEmits('receive_message', 'after unsubscribe');

      expect(received).toEqual(['hi']);
      expect(socket.listenerCount('receive_message')).toBe(0);
    });
  });

  describe('sending events', () => {
    it('returns the server acknowledgement', async () => {
      socket.ackResponse = { ok: true, message_id: 'm1' };
      const ack = await service.emit('send_message', { room_id: 7, content: 'hi' });

      expect(ack).toEqual({ ok: true, message_id: 'm1' });
      expect(socket.emitted).toContain({ event: 'send_message', payload: { room_id: 7, content: 'hi' } });
    });

    it('returns an error ack when the server does not answer', async () => {
      socket.ackFails = true;
      const ack = await service.emit('send_message', { room_id: 7, content: 'hi' });
      expect(ack).toEqual({ ok: false, error: 'No response from the server' });
    });

    it('send() is fire-and-forget (typing)', () => {
      service.send('typing', { room_id: 7, is_typing: true });
      expect(socket.emitted).toContain({ event: 'typing', payload: { room_id: 7, is_typing: true } });
    });
  });

  describe('handshake failures', () => {
    it('refreshes the session once and reconnects', async () => {
      socket.serverEmits('connect_error', new Error('unauthorized'));
      await flushPromises();

      expect(me).toHaveBeenCalledTimes(1);
      expect(socket.connectCalls).toBe(1);
      expect(logout).not.toHaveBeenCalled();
    });

    it('logs out when it is still unauthorized after the refresh', async () => {
      socket.serverEmits('connect_error', new Error('unauthorized'));
      await flushPromises();
      socket.serverEmits('connect_error', new Error('unauthorized'));
      await flushPromises();

      expect(logout).toHaveBeenCalledWith(false);
    });

    it('allows another refresh after a successful connection', async () => {
      socket.serverEmits('connect_error', new Error('unauthorized'));
      await flushPromises();
      socket.serverEmits('connect'); // the retry worked
      socket.serverEmits('connect_error', new Error('unauthorized'));
      await flushPromises();

      expect(me).toHaveBeenCalledTimes(2);
      expect(logout).not.toHaveBeenCalled();
    });

    it('ignores other connection errors (socket.io retries by itself)', async () => {
      socket.serverEmits('connect_error', new Error('xhr poll error'));
      await flushPromises();

      expect(me).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
    });
  });

  it('closes the socket when the user logs out', () => {
    TestBed.tick(); // run the initial effect
    const before = socket.disconnectCalls;

    user.set(null);
    TestBed.tick();

    expect(socket.disconnectCalls).toBe(before + 1);
  });
});