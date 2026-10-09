import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth.service';
import { RoomService } from '../../core/room.service';
import { MessageService } from '../../core/message.service';
import { SocketService } from '../../core/socket.service';
import { ChatMessage, PresenceEvent, PresenceUser, TypingEvent } from '../../core/models';
import { MatProgressBarModule } from '@angular/material/progress-bar';

const PAGE_SIZE = 30;
const TYPING_STOP_MS = 2000; // I stop typing after 2s of silence
const TYPING_EXPIRE_MS = 5000; // forget a remote "typing" if no update arrives

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(current.map((m) => m.message_id));
  const added = incoming.filter((m) => !seen.has(m.message_id));
  if (!added.length) return current;
  return [...current, ...added].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

@Component({
  selector: 'app-chat-room',
  imports: [DatePipe, FormsModule, MatToolbarModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,MatProgressBarModule],
  templateUrl: './chat-room.html',
  styleUrl: './chat-room.scss',
})
export class ChatRoom implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private roomsApi = inject(RoomService);
  private messagesApi = inject(MessageService);
  private snack = inject(MatSnackBar);
  protected readonly socket = inject(SocketService);
  protected readonly auth = inject(AuthService);

  private scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private subs = new Subscription();
  private destroyed = false;

  readonly roomId = Number(this.route.snapshot.paramMap.get('id'));
  roomName = signal('');
  messages = signal<ChatMessage[]>([]);
  online = signal<PresenceUser[]>([]);
  typingUsers = signal<string[]>([]);
  unread = signal(0);
  loadingOlder = signal(false);
  noMore = signal(false);
  sending = signal(false);
  draft = signal('');
  ready = signal(false); 

  readonly typingText = computed(() => {
    const names = this.typingUsers();
    if (names.length === 0) return '';
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return 'Several people are typing…';
  });

  private atBottom = true;
  private firstLoad = true;
  private iAmTyping = false;
  private stopTypingTimer?: ReturnType<typeof setTimeout>;
  private remoteTypingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async ngOnInit() {
    if (!Number.isInteger(this.roomId)) {
      this.router.navigate(['/rooms']);
      return;
    }

    // Opening the page joins the room (idempotent); this also handles direct links
    try {
      const room = await firstValueFrom(this.roomsApi.join(this.roomId));
      this.roomName.set(room.name);
    } catch (e: any) {
      this.snack.open(e.error?.error ?? 'Could not open this room', 'OK', { duration: 4000 });
      this.router.navigate(['/rooms']);
      return;
    }
    if (this.destroyed) return;

    // Attach all listeners BEFORE connecting so no event is missed
    this.subs.add(this.socket.on<void>('connect').subscribe(() => this.enterRoom()));
    this.subs.add(this.socket.on<ChatMessage>('receive_message').subscribe((m) => this.onIncoming(m)));
    this.subs.add(
      this.socket.on<PresenceEvent>('presence').subscribe((p) => {
        if (p.room_id === this.roomId) this.online.set(p.users);
      }),
    );
    this.subs.add(this.socket.on<TypingEvent>('typing').subscribe((t) => this.onRemoteTyping(t)));

    try {
      await this.socket.connect();
    } catch {
      this.snack.open('Could not connect to chat', 'OK', { duration: 4000 });
    }
    // Arrived with the socket already connected: no 'connect' event is coming
    if (this.socket.connected() && !this.destroyed) await this.enterRoom();
  }

  /** Runs on every (re)connect: join the socket room and load what we may have missed. */
  private async enterRoom() {
    const ack = await this.socket.emit('join_room', { room_id: this.roomId });
    if (!ack.ok) {
      this.snack.open(ack.error ?? 'Could not join the room', 'OK', { duration: 4000 });
      this.router.navigate(['/rooms']);
      return;
    }
    try {
      const latest = await firstValueFrom(this.messagesApi.history(this.roomId, undefined, PAGE_SIZE));
      this.messages.update((cur) => mergeMessages(cur, latest));
      if (this.firstLoad) {
        this.firstLoad = false;
        this.noMore.set(latest.length < PAGE_SIZE);
        this.scrollToBottom();
      }
          if (this.firstLoad) {
        this.firstLoad = false;
        this.noMore.set(latest.length < PAGE_SIZE);
        this.scrollToBottom();
      }
      this.ready.set(true);
    } catch {
      this.snack.open('Could not load message history', 'OK', { duration: 4000 });
      this.ready.set(true);
    }
  }

  // ---------- incoming ----------

  private onIncoming(m: ChatMessage) {
    if (m.room_id !== this.roomId) return;
    if (this.messages().some((x) => x.message_id === m.message_id)) return;

    if (m.kind === 'system') {
      this.messages.update((cur) => [...cur, m]);
      if (this.atBottom) this.scrollToBottom();
      return;
    }

    const mine = m.user_id === this.auth.user()?.id;
    this.messages.update((cur) => [...cur, { ...m, isNew: !mine }]);

    if (mine || this.atBottom) {
      this.scrollToBottom();
      if (!mine) setTimeout(() => this.clearNewFlags(), 3000);
    } else {
      this.unread.update((n) => n + 1);
    }
  }


  private onRemoteTyping(t: TypingEvent) {
    if (t.room_id !== this.roomId) return;
    clearTimeout(this.remoteTypingTimers.get(t.username));
    this.typingUsers.update((list) => list.filter((n) => n !== t.username));

    if (t.is_typing) {
      this.typingUsers.update((list) => [...list, t.username]);
      this.remoteTypingTimers.set(
        t.username,
        setTimeout(() => this.typingUsers.update((list) => list.filter((n) => n !== t.username)), TYPING_EXPIRE_MS),
      );
    }
  }

  // ---------- sending ----------

  onInput() {
    if (!this.iAmTyping) {
      this.iAmTyping = true;
      this.socket.send('typing', { room_id: this.roomId, is_typing: true });
    }
    clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = setTimeout(() => this.stopTyping(), TYPING_STOP_MS);
  }

  private stopTyping() {
    clearTimeout(this.stopTypingTimer);
    if (this.iAmTyping) {
      this.iAmTyping = false;
      this.socket.send('typing', { room_id: this.roomId, is_typing: false });
    }
  }

  async send() {
    const content = this.draft().trim();
    if (!content || this.sending()) return;

    this.sending.set(true);
    this.stopTyping();
    const ack = await this.socket.emit('send_message', { room_id: this.roomId, content });
    this.sending.set(false);

    if (ack.ok) {
      this.draft.set(''); // the message itself arrives through 'receive_message'
    } else {
      this.snack.open(ack.error ?? 'Message not sent', 'OK', { duration: 4000 });
    }
  }

  // ---------- scrolling and pagination ----------

  onScroll() {
    const el = this.scroller()?.nativeElement;
    if (!el) return;

    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (this.atBottom && this.unread() > 0) {
      this.unread.set(0);
      setTimeout(() => this.clearNewFlags(), 2000);
    }
    if (el.scrollTop < 40) this.loadOlder();
  }

  async loadOlder() {
    const el = this.scroller()?.nativeElement;
    const oldest = this.messages()[0];
    if (!el || !oldest || this.loadingOlder() || this.noMore()) return;

    this.loadingOlder.set(true);
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    try {
      const older = await firstValueFrom(this.messagesApi.history(this.roomId, oldest.message_id, PAGE_SIZE));
      if (older.length < PAGE_SIZE) this.noMore.set(true);
      if (older.length) {
        this.messages.update((cur) => mergeMessages(cur, older));
        // keep the viewport on the same message after prepending
        setTimeout(() => (el.scrollTop = el.scrollHeight - prevHeight + prevTop));
      }
    } catch {
      this.snack.open('Could not load older messages', 'OK', { duration: 4000 });
    } finally {
      this.loadingOlder.set(false);
    }
  }

  jumpToLatest() {
    this.scrollToBottom();
  }

  private scrollToBottom() {
    this.atBottom = true;
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private clearNewFlags() {
    this.messages.update((list) => (list.some((m) => m.isNew) ? list.map((m) => ({ ...m, isNew: false })) : list));
  }

  back() {
    this.router.navigate(['/rooms']);
  }

   ngOnDestroy() {
    this.destroyed = true;
    this.subs.unsubscribe();
    this.stopTyping();
    clearTimeout(this.stopTypingTimer);
    this.remoteTypingTimers.forEach((t) => clearTimeout(t));
    // Stay connected for the rooms page; just leave this room (updates presence)
    this.socket.send('leave_room', { room_id: this.roomId });
  }
}