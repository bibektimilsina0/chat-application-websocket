import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MessageService } from './message.service';
import { API_URL } from './config';

describe('MessageService', () => {
  let service: MessageService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(MessageService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the latest page with the default limit', () => {
    service.history(7).subscribe();
    const req = http.expectOne((r) => r.url === `${API_URL}/rooms/7/messages`);
    expect(req.request.params.get('limit')).toBe('30');
    expect(req.request.params.has('before')).toBeFalse();
    req.flush([]);
  });

  it('asks for older messages with the before cursor', () => {
    service.history(7, 'abc-123', 10).subscribe();
    const req = http.expectOne((r) => r.url === `${API_URL}/rooms/7/messages`);
    expect(req.request.params.get('before')).toBe('abc-123');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush([]);
  });
});