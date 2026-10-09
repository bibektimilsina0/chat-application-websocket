import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { API_URL } from './config';

const ALICE = { id: 1, username: 'alice' };

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: Router, useValue: router }],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts logged out', () => {
    expect(service.user()).toBeNull();
    expect(service.isLoggedIn()).toBeFalse();
  });

  it('logs in and stores the user (tokens travel in cookies, not in the body)', () => {
    service.login('alice', 'secret123').subscribe();

    const req = http.expectOne(`${API_URL}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'alice', password: 'secret123' });
    req.flush({ user: ALICE });

    expect(service.user()).toEqual(ALICE);
    expect(service.isLoggedIn()).toBeTrue();
  });

  it('stays logged out when the credentials are wrong', () => {
    let status = 0;
    service.login('alice', 'nope').subscribe({ error: (e) => (status = e.status) });

    http
      .expectOne(`${API_URL}/auth/login`)
      .flush({ error: 'Invalid username or password' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(service.user()).toBeNull();
  });

  it('registers a user', () => {
    service.register('alice', 'secret123').subscribe();
    const req = http.expectOne(`${API_URL}/auth/register`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'alice', password: 'secret123' });
    req.flush(ALICE, { status: 201, statusText: 'Created' });
  });

  it('restores the session from the cookies at app start', async () => {
    const restored = service.restoreSession();
    http.expectOne(`${API_URL}/auth/me`).flush(ALICE);
    await restored;
    expect(service.user()).toEqual(ALICE);
  });

  it('resolves quietly when there is no session to restore', async () => {
    const restored = service.restoreSession();
    http.expectOne(`${API_URL}/auth/me`).flush({ error: 'x' }, { status: 401, statusText: 'Unauthorized' });
    await restored; // must not throw, otherwise the app would never start
    expect(service.user()).toBeNull();
  });

  it('logout calls the server, clears the user and goes to /login', () => {
    service.user.set(ALICE);
    service.logout();

    http.expectOne(`${API_URL}/auth/logout`).flush({ message: 'Logged out' });

    expect(service.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('logout(false) skips the server call', () => {
    service.user.set(ALICE);
    service.logout(false);

    http.expectNone(`${API_URL}/auth/logout`);
    expect(service.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});