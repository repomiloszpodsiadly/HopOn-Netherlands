import { CanDeactivateFn } from '@angular/router';

export interface PlanCreateNavigationGuard {
  confirmNavigationAway(): boolean;
}

export const planCreateCanDeactivate: CanDeactivateFn<PlanCreateNavigationGuard> = (component) =>
  component.confirmNavigationAway();
