import { Routes } from '@angular/router';
import { ExplorePage } from './features/explore/explore-page';

export const routes: Routes = [
  { path: '', component: ExplorePage },
  { path: '**', redirectTo: '' },
];
