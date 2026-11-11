import { Routes } from '@angular/router';
import { ExplorePage } from './features/explore/explore-page';
import { planDetailsCanDeactivate } from './features/plans/plan-details.guard';

export const routes: Routes = [
  { path: '', component: ExplorePage },
  {
    path: 'plans',
    pathMatch: 'full',
    loadComponent: () => import('./features/plans/plans-list-page')
      .then((module) => module.PlansListPage),
  },
  {
    path: 'plans/new',
    loadComponent: () => import('./features/plans/plan-create-page')
      .then((module) => module.PlanCreatePage),
  },
  {
    path: 'plans/:id',
    loadComponent: () => import('./features/plans/plan-details-page')
      .then((module) => module.PlanDetailsPage),
    canDeactivate: [planDetailsCanDeactivate],
  },
  { path: '**', redirectTo: '' },
];
