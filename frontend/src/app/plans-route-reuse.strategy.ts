import { BaseRouteReuseStrategy, ActivatedRouteSnapshot } from '@angular/router';

export class PlansRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot): boolean {
    if (future.routeConfig === current.routeConfig && future.routeConfig?.path === 'plans/:id') {
      return future.params['id'] === current.params['id'];
    }
    return super.shouldReuseRoute(future, current);
  }
}
