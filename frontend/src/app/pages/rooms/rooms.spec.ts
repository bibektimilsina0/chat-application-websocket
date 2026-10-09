import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { Rooms } from './rooms';
import { AuthService } from '../../core/auth.service';
import { Room } from '../../core/models';
import { RoomService } from '../../core/room.service';
import { SocketService } from '../../core/socket.service';
import { FakeSocketService } from '../../../testing/fake-socket-service';
import { flushPromises } from '../../../testing/flush';

const ROOMS: Room[] = [
  { id: 1, name: 'general', member_count: 2, is_member: true },
  { id: 2, name: 'random', member_count: 1, is_member: false },
];

describe('Rooms', () => {
  let fixture: ComponentFixture<Rooms>;
  let component: Rooms;
  let el: HTMLElement;
  let api: jasmine.SpyObj<RoomService>;
  let socket: FakeSocketService;
  let router: jasmine.SpyObj<Router>;
  let snack: jasmine.SpyObj<MatSnackBar>;

  async function setup(list$: Observable<Room[]> = of(ROOMS)) {
    api = jasmine.createSpyObj<RoomService>('RoomService', ['list', 'create', 'join']);
    api.list.and.returnValue(list$);
    socket = new FakeSocketService();
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    snack = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      imports: [Rooms],
      providers: [
        { provide: RoomService, useValue: api },
        { provide: SocketService, useValue: socket },
        { provide: AuthService, useValue: { user: signal({ id: 1, username: 'alice' }), logout: jasmine.createSpy() } },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    fixture = TestBed.createComponent(Rooms);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
    await flushPromises(); // lets ngModel register before we type into it
    fixture.detectChanges();
  }

  const items = () => Array.from(el.querySelectorAll('mat-list-item')) as HTMLElement[];
  const names = () => items().map((i) => ROOMS.concat(extra).find((r) => i.textContent!.includes(r.name))?.name);
  let extra: Room[] = [];
  const nameInput = () => el.querySelector('input[name="roomName"]') as HTMLInputElement;
  const createButton = () => el.querySelector('button[type="submit"]') as HTMLButtonElement;

  function typeName(value: string) {
    nameInput().value = value;
    nameInput().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit() {
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(() => (extra = []));

  describe('listing', () => {
    it('shows a loading state, then the rooms', async () => {
      const pending = new Subject<Room[]>();
      await setup(pending);
      expect(el.querySelector('.hint')!.textContent).toContain('Loading rooms');
      expect(el.querySelector('mat-progress-bar')).not.toBeNull();

      pending.next(ROOMS);
      fixture.detectChanges();

      expect(el.querySelector('mat-progress-bar')).toBeNull();
      expect(items().length).toBe(2);
    });

    it('renders each room with its member count and the right action', async () => {
      await setup();
      const [general, random] = items();

      expect(general.textContent).toContain('general');
      expect(general.textContent).toContain('2 members');
      expect(general.querySelector('button')!.textContent).toContain('Open'); // already a member
      expect(random.textContent).toContain('1 member');
      expect(random.textContent).not.toContain('1 members');
      expect(random.querySelector('button')!.textContent).toContain('Join');
    });

    it('shows an empty state', async () => {
      await setup(of([]));
      expect(el.querySelector('.hint')!.textContent).toContain('No rooms yet');
    });

    it('tells the user when the list cannot be loaded', async () => {
      await setup(throwError(() => new HttpErrorResponse({ status: 500 })));
      expect(snack.open).toHaveBeenCalledWith('Could not load rooms', 'OK', jasmine.anything());
      expect(component.loading()).toBeFalse();
    });

    it('opens a room', async () => {
      await setup();
      (items()[1].querySelector('button') as HTMLButtonElement).click();
      expect(router.navigate).toHaveBeenCalledWith(['/rooms', 2]);
    });

    it('connects the socket for live updates', async () => {
      await setup();
      expect(socket.connectCalls).toBe(1);
    });
  });

  describe('creating a room', () => {
    it('disables Create until a name is typed', async () => {
      await setup();
      expect(createButton().disabled).toBeTrue();
      typeName('  ');
      expect(createButton().disabled).toBeTrue();
      typeName('announcements');
      expect(createButton().disabled).toBeFalse();
    });

    it('shows "Creating…" while waiting, then opens the new room', async () => {
      await setup();
      const pending = new Subject<Room>();
      api.create.and.returnValue(pending);

      typeName('announcements');
      submit();

      expect(api.create).toHaveBeenCalledWith('announcements');
      expect(createButton().textContent).toContain('Creating…');
      expect(createButton().disabled).toBeTrue();
      expect(el.querySelector('mat-progress-bar')).not.toBeNull();

      pending.next({ id: 5, name: 'announcements', member_count: 1, is_member: true });
      expect(router.navigate).toHaveBeenCalledWith(['/rooms', 5]);
      expect(component.rooms().some((r) => r.name === 'announcements')).toBeTrue(); // no refresh needed
    });

    it('shows the server message when the name is taken, and lets the user retry', async () => {
      await setup();
      api.create.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'A room with that name already exists' } })),
      );

      typeName('general');
      submit();

      expect(snack.open).toHaveBeenCalledWith('A room with that name already exists', 'OK', jasmine.anything());
      expect(component.creating()).toBeFalse();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('live updates (no refresh needed)', () => {
    it('adds a room created by someone else, in alphabetical order', async () => {
      await setup();
      extra = [{ id: 3, name: 'announcements', member_count: 1, is_member: false }];

      socket.push('room_changed', { id: 3, name: 'announcements', member_count: 1 });
      fixture.detectChanges();

      expect(names()).toEqual(['announcements', 'general', 'random']);
      expect(items()[0].querySelector('button')!.textContent).toContain('Join');
    });

    it('updates the member count of an existing room', async () => {
      await setup();
      socket.push('room_changed', { id: 2, name: 'random', member_count: 3 });
      fixture.detectChanges();

      expect(items()[1].textContent).toContain('3 members');
      expect(items()[1].querySelector('button')!.textContent).toContain('Join'); // membership untouched
    });

    it('reloads the list after the socket reconnects (events may have been missed)', async () => {
      await setup();
      socket.push('connect');
      expect(api.list).toHaveBeenCalledTimes(2);
    });
  });
});