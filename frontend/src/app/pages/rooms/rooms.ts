import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/auth.service';
import { RoomService } from '../../core/room.service';
import { Room } from '../../core/models';

@Component({
  selector: 'app-rooms',
  imports: [FormsModule, MatToolbarModule, MatButtonModule, MatListModule, MatFormFieldModule, MatInputModule],
  templateUrl: './rooms.html',
  styleUrl: './rooms.scss',
})
export class Rooms implements OnInit {
  protected readonly auth = inject(AuthService);
  private roomsApi = inject(RoomService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  rooms = signal<Room[]>([]);
  loading = signal(true);
  creating = signal(false);
  newName = signal('');

  ngOnInit() {
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

  create() {
    const name = this.newName().trim();
    if (!name || this.creating()) return;
    this.creating.set(true);
    this.roomsApi.create(name).subscribe({
      next: (room) => this.router.navigate(['/rooms', room.id]),
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
}