import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ChatRoom } from './chat-room';
import { AuthService } from '../../core/auth.service';
import { MessageService } from '../../core/message.service';
import { Ack, ChatMessage } from '../../core/models';
import { RoomService } from '../../core/room.service';
import { SocketService } from '../../core/socket.service';
import { FakeSocketService } from '../../../testing/fake-socket-service';
import { flushPromises } from '../../../testing/flush';

let seq = 0;
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => {
  seq++;
  return {
    message_id: `id-${String(seq).padStart(4, '0')}`,
    room_id: 7,
    user_id: 2,
    username: 'bob',
    content: `message ${seq}`,
    kind: 'message',
    created_at: new Date(Date.UTC(2026, 0, 1, 10, 0, seq)).toISOString(), // later = bigger seq
    ...over,
  };
};
const systemMsg = (content: string) => msg({ kind: 'system', content, user_id: 3, username: 'carol' });

describe('ChatRoom', () => {
  let fixture: ComponentFixture<ChatRoom>;
  let component: ChatRoom;
  let el: HTMLElement;
  let socket: FakeSocketService;
  let rooms: jasmine.SpyObj<RoomService>;
  let messages: jasmine.SpyObj<MessageService>;
  let router: jasmine.SpyObj<Router>;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let clockInstalled = false;

  async function setup(opts: { latest?: ChatMessage[]; older?: ChatMessage[]; ack?: Ack; joinError?: boolean } = {}) {
    const { latest = [], older = [], ack, joinError } = opts;
    socket = new FakeSocketService();
    if (ack) socket.ack = ack;

    rooms = jasmine.createSpyObj<RoomService>('RoomService', ['join']);
    rooms.join.and.returnValue(
      joinError
        ? throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Room not found' } }))
        : of({ id: 7, name: 'general', member_count: 2, is_member: true }),
    );
    messages = jasmine.createSpyObj<MessageService>('MessageService', ['history', 'upload', 'fileUrl']);
    messages.fileUrl.and.callFake(
      (room: number, key: string, name: string) =>
        `/rooms/${room}/files/${key}?filename=${encodeURIComponent(name)}`,
    );
    messages.history.and.callFake((_room: number, before?: string) => of(before ? older : latest));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    snack = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      imports: [ChatRoom],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: '7' }) } } },
        { provide: RoomService, useValue: rooms },
        { provide: MessageService, useValue: messages },
        { provide: SocketService, useValue: socket },
        { provide: AuthService, useValue: { user: signal({ id: 1, username: 'alice' }) } },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    fixture = TestBed.createComponent(ChatRoom);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    await settle();
  }

  async function settle() {
    fixture.detectChanges();
    await flushPromises();
    fixture.detectChanges();
  }

  const q = (sel: string) => el.querySelector(sel) as HTMLElement | null;
  const qa = (sel: string) => Array.from(el.querySelectorAll(sel)) as HTMLElement[];
  const texts = (sel: string) => qa(sel).map((e) => e.textContent!.trim());

  // The composer also contains the hidden file picker and the paperclip button,
  // so these selectors must skip them.
  const messageField = () => q('.composer input:not([type="file"])') as HTMLInputElement;
  const sendButton = () => q('.composer button[mat-flat-button]') as HTMLButtonElement;

  function type(value: string) {
    const field = messageField();
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function useClock() {
    jasmine.clock().install();
    clockInstalled = true;
  }

  beforeEach(() => (seq = 0));
  afterEach(() => {
    if (clockInstalled) jasmine.clock().uninstall();
    clockInstalled = false;
  });

  // ---------------------------------------------------------------- opening the room

  describe('opening the room', () => {
    it('joins over REST, joins the socket room and shows the room name', async () => {
      await setup();

      expect(rooms.join).toHaveBeenCalledWith(7);
      expect(socket.emitted).toContain({ event: 'join_room', payload: { room_id: 7 } });
      expect(q('mat-toolbar')!.textContent).toContain('general');
      expect(q('mat-toolbar')!.textContent).toContain('Connected');
    });

    it('goes back to the room list when the room cannot be opened', async () => {
      await setup({ joinError: true });

      expect(snack.open).toHaveBeenCalledWith('Room not found', 'OK', jasmine.anything());
      expect(router.navigate).toHaveBeenCalledWith(['/rooms']);
    });

    it('goes back to the room list when the socket refuses the join', async () => {
      await setup({ ack: { ok: false, error: 'You are not a member of this room' } });

      expect(snack.open).toHaveBeenCalledWith('You are not a member of this room', 'OK', jasmine.anything());
      expect(router.navigate).toHaveBeenCalledWith(['/rooms']);
    });

    it('tells the server when the user leaves', async () => {
      await setup();
      fixture.destroy();
      expect(socket.sent).toContain({ event: 'leave_room', payload: { room_id: 7 } });
    });
  });

  // ---------------------------------------------------------------- message history

  describe('message history', () => {
    it('renders stored messages, including system notices', async () => {
      const history = [
        msg({ content: 'hello' }),
        systemMsg('carol joined the room'),
        msg({ content: 'hi there', user_id: 1, username: 'alice' }),
      ];
      await setup({ latest: history });

      expect(texts('.msg .content')).toEqual(['hello', 'hi there']);
      expect(texts('.msg .meta strong')).toEqual(['bob', 'alice']);
      expect(texts('.system')).toEqual(['carol joined the room']);
    });

    it('marks my own messages', async () => {
      await setup({ latest: [msg(), msg({ user_id: 1, username: 'alice' })] });

      const rows = qa('.msg');
      expect(rows[0].classList.contains('mine')).toBeFalse();
      expect(rows[1].classList.contains('mine')).toBeTrue();
    });

    it('shows a friendly message for an empty room', async () => {
      await setup({ latest: [] });
      expect(q('.empty')!.textContent).toContain('No messages yet');
    });

    it('offers older messages only when a full page was loaded', async () => {
      await setup({ latest: Array.from({ length: 3 }, () => msg()) });
      expect(q('.older')).toBeNull();
    });

    it('loads older messages and puts them before the current ones', async () => {
      const older = Array.from({ length: 5 }, () => msg());
      const latest = Array.from({ length: 30 }, () => msg());
      await setup({ latest, older });

      expect(q('.older')).not.toBeNull();
      (q('.older') as HTMLButtonElement).click();
      await settle();

      expect(messages.history).toHaveBeenCalledWith(7, latest[0].message_id, 30);
      const contents = texts('.msg .content');
      expect(contents.length).toBe(35);
      expect(contents.slice(0, 5)).toEqual(older.map((m) => m.content));
      expect(q('.older')).toBeNull(); // a short page means we reached the beginning
    });

    it('shows an image attachment as a picture', async () => {
      const file = { name: 'cat.png', key: 'a'.repeat(32) + '.png', type: 'image/png', size: 2048 };
      await setup({ latest: [msg({ kind: 'file', content: 'cat.png', file })] });

      const img = q('.msg img.thumb') as HTMLImageElement;
      expect(img.src).toContain(`/rooms/7/files/${file.key}`);
      expect(img.alt).toBe('cat.png');
    });

    it('shows other attachments as a download link with the size', async () => {
      const file = { name: 'report.pdf', key: 'b'.repeat(32) + '.pdf', type: 'application/pdf', size: 3 * 1024 * 1024 };
      await setup({ latest: [msg({ kind: 'file', content: 'report.pdf', file })] });

      expect(q('.msg a.file')!.textContent).toContain('report.pdf');
      expect(q('.msg a.file')!.textContent).toContain('3.0 MB');
    });

    it('refuses oversized files before uploading', async () => {
      await setup();
      const big = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big.zip');
      component.onFilePicked({ target: { files: [big], value: '' } } as unknown as Event);

      expect(snack.open).toHaveBeenCalledWith('File is too large (max 10 MB)', 'OK', jasmine.anything());
      expect(messages.upload).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- real-time messages

  describe('real-time messages', () => {
    beforeEach(async () => setup({ latest: [msg({ content: 'first' })] }));

    it('shows a message the moment it arrives', () => {
      socket.push('receive_message', msg({ content: 'hello alice' }));
      fixture.detectChanges();

      expect(texts('.msg .content')).toEqual(['first', 'hello alice']);
    });

    it('ignores a duplicate delivery', () => {
      const m = msg({ content: 'once' });
      socket.push('receive_message', m);
      socket.push('receive_message', m);
      fixture.detectChanges();

      expect(texts('.msg .content')).toEqual(['first', 'once']);
    });

    it('ignores messages for other rooms', () => {
      socket.push('receive_message', msg({ room_id: 8, content: 'elsewhere' }));
      fixture.detectChanges();

      expect(texts('.msg .content')).toEqual(['first']);
    });

    it('shows "joined" notices as system lines', () => {
      socket.push('receive_message', systemMsg('carol joined the room'));
      fixture.detectChanges();

      expect(texts('.system')).toEqual(['carol joined the room']);
      expect(qa('.msg').length).toBe(1); // not rendered as a chat bubble
    });

    it('highlights new messages from others, then removes the highlight', () => {
      useClock();
      socket.push('receive_message', msg({ content: 'look at me' }));
      fixture.detectChanges();
      expect(qa('.msg.new').length).toBe(1);

      jasmine.clock().tick(3001);
      fixture.detectChanges();
      expect(qa('.msg.new').length).toBe(0);
    });

    it('does not highlight my own messages', () => {
      socket.push('receive_message', msg({ user_id: 1, username: 'alice' }));
      fixture.detectChanges();

      expect(qa('.msg.new').length).toBe(0);
    });
  });

  // ---------------------------------------------------------------- sending

  describe('sending messages', () => {
    beforeEach(async () => setup());

    it('sends the typed message over the socket and clears the input', async () => {
      type('hello everyone');
      expect(sendButton().disabled).toBeFalse();

      sendButton().click();
      await settle();

      expect(socket.emitted.find((e) => e.event === 'send_message')?.payload).toEqual({
        room_id: 7,
        content: 'hello everyone',
      });
      expect(component.draft()).toBe('');
    });

    it('sends on Enter', async () => {
      type('with enter');
      messageField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await settle();

      expect(socket.emitted.some((e) => e.event === 'send_message')).toBeTrue();
    });

    it('does not send empty or whitespace-only messages', async () => {
      expect(sendButton().disabled).toBeTrue();
      type('   ');
      expect(sendButton().disabled).toBeTrue();

      await component.send();
      expect(socket.emitted.some((e) => e.event === 'send_message')).toBeFalse();
    });

    it('keeps the text and shows the error when the server rejects it', async () => {
      socket.ack = { ok: false, error: 'Could not send the message, please try again' };
      type('important');

      await component.send();
      await settle();

      expect(snack.open).toHaveBeenCalledWith('Could not send the message, please try again', 'OK', jasmine.anything());
      expect(component.draft()).toBe('important');
    });

    it('disables sending while the socket is disconnected', () => {
      type('hi');
      socket.connected.set(false);
      fixture.detectChanges();

      expect(sendButton().disabled).toBeTrue();
      expect(q('mat-toolbar')!.textContent).toContain('Connecting');
    });
  });

  // ---------------------------------------------------------------- typing indicators

  describe('typing indicators', () => {
    beforeEach(async () => setup());

    const typing = (username: string, is_typing: boolean, room_id = 7) =>
      socket.push('typing', { room_id, username, is_typing });

    it('shows who is typing and clears it when they stop', () => {
      typing('bob', true);
      fixture.detectChanges();
      expect(q('.typing')!.textContent).toContain('bob is typing…');

      typing('bob', false);
      fixture.detectChanges();
      expect(q('.typing')!.textContent!.trim()).toBe('');
    });

    it('handles several people typing', () => {
      typing('bob', true);
      typing('carol', true);
      fixture.detectChanges();
      expect(q('.typing')!.textContent).toContain('bob and carol are typing…');

      typing('dave', true);
      fixture.detectChanges();
      expect(q('.typing')!.textContent).toContain('Several people are typing…');
    });

    it('ignores typing in other rooms', () => {
      typing('bob', true, 8);
      fixture.detectChanges();
      expect(q('.typing')!.textContent!.trim()).toBe('');
    });

    it('forgets a typing notice if no update arrives (lost "stopped" event)', () => {
      useClock();
      typing('bob', true);
      fixture.detectChanges();
      expect(q('.typing')!.textContent).toContain('bob');

      jasmine.clock().tick(5001);
      fixture.detectChanges();
      expect(q('.typing')!.textContent!.trim()).toBe('');
    });

    it('tells the others when I start typing, only once per burst', () => {
      useClock();
      type('h');
      type('he');
      type('hel');

      const started = socket.sent.filter((e) => e.event === 'typing' && (e.payload as any).is_typing);
      expect(started.length).toBe(1);
    });

    it('tells the others when I stop typing', () => {
      useClock();
      type('hello');
      jasmine.clock().tick(2001);

      expect(socket.sent).toContain({ event: 'typing', payload: { room_id: 7, is_typing: false } });
    });

    it('stops my typing indicator when I send the message', async () => {
      type('hello');
      await component.send();

      expect(socket.sent).toContain({ event: 'typing', payload: { room_id: 7, is_typing: false } });
    });
  });

  // ---------------------------------------------------------------- active user list

  describe('active user list', () => {
    beforeEach(async () => setup());

    const presence = (users: { id: number; username: string }[], room_id = 7) =>
      socket.push('presence', { room_id, users });

    it('lists the people who are online, with a count', () => {
      presence([{ id: 1, username: 'alice' }, { id: 2, username: 'bob' }]);
      fixture.detectChanges();

      expect(q('.people h3')!.textContent).toContain('Online (2)');
      expect(qa('.people li').length).toBe(2);
    });

    it('marks the current user', () => {
      presence([{ id: 1, username: 'alice' }, { id: 2, username: 'bob' }]);
      fixture.detectChanges();

      const [alice, bob] = qa('.people li');
      expect(alice.textContent).toContain('(you)');
      expect(bob.textContent).not.toContain('(you)');
    });

    it('updates when someone leaves', () => {
      presence([{ id: 1, username: 'alice' }, { id: 2, username: 'bob' }]);
      presence([{ id: 1, username: 'alice' }]);
      fixture.detectChanges();

      expect(q('.people h3')!.textContent).toContain('Online (1)');
      expect(texts('.people li').join()).not.toContain('bob');
    });

    it('ignores presence for other rooms', () => {
      presence([{ id: 1, username: 'alice' }]);
      presence([{ id: 9, username: 'zed' }], 8);
      fixture.detectChanges();

      expect(texts('.people li').join()).not.toContain('zed');
    });
  });
});