import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  mode = signal<'login' | 'register'>('login');
  error = signal('');
  loading = signal(false);

  form = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  toggleMode() {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.error.set('');
  }

  submit() {
    if (this.form.invalid || this.loading()) return;
    const { username, password } = this.form.getRawValue();
    this.loading.set(true);
    this.error.set('');

    const fail = (e: HttpErrorResponse) => {
      this.loading.set(false);
      this.error.set(e.status === 0 ? 'Cannot reach the server' : (e.error?.error ?? 'Something went wrong'));
    };
    const doLogin = () =>
      this.auth.login(username, password).subscribe({
        next: () => this.router.navigate(['/rooms']),
        error: fail,
      });

    if (this.mode() === 'login') {
      doLogin();
    } else {
      this.auth.register(username, password).subscribe({ next: doLogin, error: fail });
    }
  }
}