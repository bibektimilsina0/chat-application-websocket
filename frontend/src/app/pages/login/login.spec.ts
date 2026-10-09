import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { Login } from './login';
import { AuthService } from '../../core/auth.service';

const ALICE = { id: 1, username: 'alice' };

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let component: Login;
  let el: HTMLElement;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['login', 'register']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });
    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  const input = (name: string) => el.querySelector(`input[formcontrolname="${name}"]`) as HTMLInputElement;
  const submitButton = () => el.querySelector('button[type="submit"]') as HTMLButtonElement;

  function fill(username: string, password: string) {
    for (const [name, value] of [['username', username], ['password', password]]) {
      input(name).value = value;
      input(name).dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
  }

  function submit() {
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('renders the login form with the button disabled', () => {
    expect(el.querySelector('mat-card-title')!.textContent).toContain('Log in');
    expect(input('username')).not.toBeNull();
    expect(input('password')).not.toBeNull();
    expect(submitButton().disabled).toBeTrue();
  });

  it('keeps the button disabled for an invalid username or password', () => {
    fill('ab', 'secret123'); // username too short
    expect(submitButton().disabled).toBeTrue();
    fill('alice', 'short'); // password too short
    expect(submitButton().disabled).toBeTrue();
  });

  it('enables the button once the form is valid', () => {
    fill('alice', 'secret123');
    expect(submitButton().disabled).toBeFalse();
  });

  it('switches to registration mode', () => {
    (el.querySelector('button[type="button"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('mat-card-title')!.textContent).toContain('Create account');
    expect(submitButton().textContent).toContain('Register');
  });

  it('logs in and goes to the rooms page', () => {
    auth.login.and.returnValue(of({ user: ALICE }));
    fill('alice', 'secret123');
    submit();

    expect(auth.login).toHaveBeenCalledWith('alice', 'secret123');
    expect(router.navigate).toHaveBeenCalledWith(['/rooms']);
  });

  it('shows the server error and stays on the page when login fails', () => {
    auth.login.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 401, error: { error: 'Invalid username or password' } })),
    );
    fill('alice', 'wrong-password');
    submit();

    expect(el.querySelector('.error')!.textContent).toContain('Invalid username or password');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.loading()).toBeFalse();
    expect(submitButton().disabled).toBeFalse(); // the user can try again
  });

  it('explains a network failure', () => {
    auth.login.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    fill('alice', 'secret123');
    submit();

    expect(el.querySelector('.error')!.textContent).toContain('Cannot reach the server');
  });

  it('shows a loading state while the request is running', () => {
    const pending = new Subject<{ user: typeof ALICE }>();
    auth.login.and.returnValue(pending);
    fill('alice', 'secret123');
    submit();

    expect(submitButton().textContent).toContain('Logging in…');
    expect(submitButton().disabled).toBeTrue();
    expect(el.querySelector('mat-progress-bar')).not.toBeNull();

    pending.next({ user: ALICE });
    pending.complete();
    expect(router.navigate).toHaveBeenCalledWith(['/rooms']);
  });

  it('registers, then logs in automatically', () => {
    auth.register.and.returnValue(of(ALICE));
    auth.login.and.returnValue(of({ user: ALICE }));
    component.toggleMode();
    fixture.detectChanges();

    fill('alice', 'secret123');
    submit();

    expect(auth.register).toHaveBeenCalledWith('alice', 'secret123');
    expect(auth.login).toHaveBeenCalledWith('alice', 'secret123');
    expect(router.navigate).toHaveBeenCalledWith(['/rooms']);
  });

  it('shows "username taken" and does not log in when registration fails', () => {
    auth.register.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'Username already taken' } })),
    );
    component.toggleMode();
    fill('alice', 'secret123');
    submit();

    expect(el.querySelector('.error')!.textContent).toContain('Username already taken');
    expect(auth.login).not.toHaveBeenCalled();
  });
});