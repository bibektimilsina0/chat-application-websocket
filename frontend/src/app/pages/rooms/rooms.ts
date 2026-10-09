import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth.service';
import { RoomService } from '../../core/room.service';
import { SocketService } from '../../core/socket.service';
import { Room, RoomChange } from '../../core/models';

const byName = (a: Room, b: Room) => a.name.localeCompare(b.name);

@Component({
  selector: 'app-rooms',
  imports: [
    FormsModule,
    MatToolbarModule,
    MatButtonModule,
    MatListModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './rooms.html',
  styleUrl: './rooms.scss',
})
export class Rooms implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private roomsApi = inject(RoomService);
  private socket = inject(SocketService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private subs = new Subscription();

  rooms = signal<Room[]>([]);
  loading = signal(true);
  creating = signal(false);
  newName = signal('');

  async ngOnInit() {
    this.load(true);

    // Live updates: new rooms and member counts, without a page refresh
    this.subs.add(this.socket.on<RoomChange>('room_changed').subscribe((c) => this.upsert(c)));
    // After a reconnect we may have missed events, so reload quietly
    this.subs.add(this.socket.on<void>('connect').subscribe(() => this.load(false)));

    try {
      await this.socket.connect();
    } catch {
      /* the list still works over REST */
    }
  }

  private load(showSpinner: boolean) {
    if (showSpinner) this.loading.set(true);
    this.roomsApi.list().subscribe({
      next: (rooms) => {
        this.rooms.set(rooms);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snack.open('Could not load rooms', 'OK', { duration: 4000 });
      },
    });
  }

  private upsert(change: RoomChange) {
    this.rooms.update((list) => {
      const i = list.findIndex((r) => r.id === change.id);
      if (i === -1) return [...list, { ...change, is_member: false }].sort(byName);
      const copy = [...list];
      copy[i] = { ...copy[i], name: change.name, member_count: change.member_count };
      return copy;
    });
  }

  create() {
    const name = this.newName().trim();
    if (!name || this.creating()) return;
    this.creating.set(true);
    this.roomsApi.create(name).subscribe({
      next: (room) => {
        // Show it in the list right away, in case the user comes back
        this.rooms.update((list) => [...list.filter((r) => r.id !== room.id), room].sort(byName));
        this.newName.set('');
        this.router.navigate(['/rooms', room.id]);
      },
      error: (e) => {
        this.creating.set(false);
        this.snack.open(e.error?.error ?? 'Could not create the room', 'OK', { duration: 4000 });
      },
    });
  }

  open(room: Room) {
    // The chat page joins the room itself (idempotent), so we only navigate
    this.router.navigate(['/rooms', room.id]);
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }
}