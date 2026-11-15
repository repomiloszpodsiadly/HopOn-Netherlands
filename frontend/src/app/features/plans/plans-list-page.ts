import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { PlansApiService } from '../../core/api/plans-api.service';
import { CITY_LABELS, CityId } from '../../core/models/catalog.models';
import { MAX_SAVED_PLANS, PlanResponse } from '../../core/models/plan.models';
import { MainNavigationComponent } from '../shared/main-navigation';
import { PointerLightDirective } from '../shared/pointer-light';

type PlansListResult = Readonly<{
  plans: readonly PlanResponse[] | null;
  error: string | null;
}>;

@Component({
  selector: 'app-plans-list-page',
  imports: [RouterLink, MainNavigationComponent, PointerLightDirective],
  templateUrl: './plans-list-page.html',
  styleUrls: ['./plans-page.css', './plan-workspace.css', './plans-list-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlansListPage {
  private readonly destroyRef = inject(DestroyRef);
  private readonly plansApi = inject(PlansApiService);
  private readonly reloadRequests = new Subject<void>();

  readonly plans = signal<readonly PlanResponse[]>([]);
  readonly planLimit = MAX_SAVED_PLANS;
  readonly atCapacity = computed(() => this.plans().length >= this.planLimit);
  readonly totalPlaces = computed(() => this.plans().reduce((total, plan) => total + plan.placeIds.length, 0));
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.reloadRequests
      .pipe(
        startWith(undefined),
        switchMap(() => {
          this.loading.set(true);
          this.error.set(null);
          return this.plansApi.getPlans().pipe(
            map((plans) => ({ plans, error: null }) satisfies PlansListResult),
            catchError((error: unknown) => of({
              plans: null,
              error: apiErrorMessage(error, 'Saved plans could not be loaded'),
            } satisfies PlansListResult)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (result.error !== null || result.plans === null) {
          this.error.set(result.error ?? 'Saved plans could not be loaded.');
          return;
        }
        this.plans.set(result.plans);
      });
  }

  cityName(cityId: CityId): string {
    return CITY_LABELS[cityId];
  }

  formatDate(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      return value;
    }
    return new Intl.DateTimeFormat('en-NL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp);
  }

  retry(): void {
    this.reloadRequests.next();
  }
}
