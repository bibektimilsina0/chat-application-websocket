import { Routes } from '@angular/router';
import { Login } from './pages/login/login';
import { Rooms } from './pages/rooms/rooms';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'rooms', component: Rooms, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'rooms' },
  { path: '**', redirectTo: 'rooms' },
];