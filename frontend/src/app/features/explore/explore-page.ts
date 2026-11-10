import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HealthApiService } from '../../core/api/health-api.service';

type ApiState = 'checking' | 'online' | 'offline';

@Component({
  selector: 'app-explore-page',
  templateUrl: './explore-page.html',
  styleUrl: './explore-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorePage {
  private readonly healthApi = inject(HealthApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly apiState = signal<ApiState>('checking');
  readonly apiStatusText = signal('Checking local API');

  readonly themes = ['Architecture hunt', 'Culture day', 'Green escape'];
  readonly categories = ['All places', 'Architecture', 'Museums', 'Culture', 'Parks & nature'];

  constructor() {
    this.checkHealth();
  }

  retryHealthCheck(): void {
    this.apiState.set('checking');
    this.apiStatusText.set('Checking local API');
    this.checkHealth();
  }

  private checkHealth(): void {
    this.healthApi
      .getHealth()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.apiState.set('online');
          this.apiStatusText.set('Local API connected');
        },
        error: () => {
          this.apiState.set('offline');
          this.apiStatusText.set('API not running');
        },
      });
  }
}
