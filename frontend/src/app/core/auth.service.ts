import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, of, tap } from 'rxjs';
import { API_URL } from './config';

export interface User {
  id: number;
  username: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly user = signal<User | null>(null);
  readonly isLoggedIn = computed(() => !!this.user());

  register(username: string, password: string) {
    return this.http.post<User>(`${API_URL}/auth/register`, { username, password });
  }

  login(username: string, password: string) {
    return this.http
      .post<{ user: User }>(`${API_URL}/auth/login`, { username, password })
      .pipe(tap((res) => this.user.set(res.user)));
  }

  me() {
    return this.http.get<User>(`${API_URL}/auth/me`);
  }

  /** App start: the cookies decide. The backend refreshes silently if needed. */
  restoreSession(): Promise<unknown> {
    return firstValueFrom(
      this.me().pipe(
        tap((u) => this.user.set(u)),
        catchError(() => of(null)),
      ),
    );
  }

  logout(callServer = true) {
    if (callServer) {
      this.http.post(`${API_URL}/auth/logout`, {}).subscribe({ error: () => {} });
    }
    this.user.set(null);
    this.router.navigate(['/login']);
  }
}