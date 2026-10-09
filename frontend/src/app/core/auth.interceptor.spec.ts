import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { API_URL } from './config';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let loggedIn: boolean;
  let logout: jasmine.Spy;

  beforeEach(() => {
    loggedIn = true;
    logout = jasmine.createSpy('logout');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isLoggedIn: () => loggedIn, logout } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  const fail = (url: string, status: number) => {
    http.get(url).subscribe({ error: () => {} });
    controller.expectOne(url).flush({ error: 'x' }, { status, statusText: 'err' });
  };

  it('sends cookies and the CSRF header on every request', () => {
    http.get(`${API_URL}/rooms`).subscribe();
    const req = controller.expectOne(`${API_URL}/rooms`);
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    req.flush([]);
  });

  it('logs out when the session is over (401 on a normal request)', () => {
    fail(`${API_URL}/rooms`, 401);
    expect(logout).toHaveBeenCalledWith(false);
  });

  it('does not log out on a failed login attempt', () => {
    fail(`${API_URL}/auth/login`, 401);
    expect(logout).not.toHaveBeenCalled();
  });

  it('does not log out when nobody is logged in', () => {
    loggedIn = false;
    fail(`${API_URL}/rooms`, 401);
    expect(logout).not.toHaveBeenCalled();
  });

  it('does not log out on server errors', () => {
    fail(`${API_URL}/rooms`, 500);
    expect(logout).not.toHaveBeenCalled();
  });
});