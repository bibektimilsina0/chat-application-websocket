import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RoomService } from './room.service';
import { API_URL } from './config';
import { Room } from './models';

describe('RoomService', () => {
  let service: RoomService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(RoomService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('fetches the room list', () => {
    const rooms: Room[] = [{ id: 1, name: 'general', member_count: 2, is_member: true }];
    let result: Room[] = [];
    service.list().subscribe((r) => (result = r));

    const req = http.expectOne(`${API_URL}/rooms`);
    expect(req.request.method).toBe('GET');
    req.flush(rooms);

    expect(result).toEqual(rooms);
  });

  it('creates a room', () => {
    service.create('general').subscribe();
    const req = http.expectOne(`${API_URL}/rooms/create`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'general' });
    req.flush({ id: 1, name: 'general', member_count: 1, is_member: true });
  });

  it('joins a room', () => {
    service.join(7).subscribe();
    const req = http.expectOne(`${API_URL}/rooms/7/join`);
    expect(req.request.method).toBe('POST');
    req.flush({ id: 7, name: 'x', member_count: 2, is_member: true });
  });
});