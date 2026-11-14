import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs';
import { focusMapRegion } from './focus-map-region';
import { ActivePlanStore } from '../../core/services/active-plan.store';

@Component({
  selector: 'app-main-navigation',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './main-navigation.html',
  styleUrl: './main-navigation.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MainNavigationComponent {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly activePlanStore = inject(ActivePlanStore);
  readonly mapActive = toSignal(this.router.events.pipe(
    filter((event) => event instanceof NavigationEnd),
    map(() => this.router.parseUrl(this.router.url).fragment === 'map-region'),
  ), { initialValue: this.router.parseUrl(this.router.url).fragment === 'map-region' });

  get mapHref(): string {
    return this.router.serializeUrl(this.createMapUrlTree());
  }

  navigateToMap(event: MouseEvent): void {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    void this.router.navigateByUrl(this.createMapUrlTree()).then(
      () => focusMapRegion(this.document),
      () => focusMapRegion(this.document),
    );
  }

  private createMapUrlTree() {
    const planId = this.router.parseUrl(this.router.url).queryParamMap.get('plan')
      ?? this.activePlanStore.selectedId();
    return this.router.createUrlTree(['/'], {
      fragment: 'map-region',
      queryParams: planId === null ? {} : { plan: planId },
    });
  }
}
