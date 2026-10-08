import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const AUTH_URL = /\/auth\/(login|register|refresh|logout)$/;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  const apiReq = req.clone({
    withCredentials: true, // send/receive the httpOnly cookies
    setHeaders: { 'X-Requested-With': 'XMLHttpRequest' }, // required by the backend CSRF check
  });
    
  return next(apiReq).pipe(
    catchError((err) => {
      // The backend already tried to refresh. A 401 now means the session is over.
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !AUTH_URL.test(req.url) &&
        auth.isLoggedIn()
      ) {
        auth.logout(false);
      }
      return throwError(() => err);
    }),
  );
};