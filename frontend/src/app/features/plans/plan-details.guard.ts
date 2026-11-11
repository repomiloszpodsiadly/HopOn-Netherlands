import { CanDeactivateFn } from '@angular/router';

export interface PlanDetailsNavigationGuard {
  confirmNavigationAway(): boolean | Promise<boolean>;
}

export const planDetailsCanDeactivate: CanDeactivateFn<PlanDetailsNavigationGuard> = (component) =>
  component.confirmNavigationAway();
