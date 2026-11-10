import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { HealthApiService, UnexpectedHealthResponseError } from '../../core/api/health-api.service';

type ApiState = 'checking' | 'online' | 'offline' | 'unexpected';

@Component({
  selector: 'app-explore-page',
  templateUrl: './explore-page.html',
  styleUrl: './explore-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplorePage {
  private readonly healthApi = inject(HealthApiService);
  private readonly destroyRef = inject(DestroyRef);
  private healthCheckPending = false;

  readonly apiState = signal<ApiState>('checking');
  readonly apiStatusText = signal('Checking local API');
  readonly compactApiStatusText = signal('Checking API');

  readonly themes = ['Architecture hunt', 'Culture day', 'Green escape'];
  readonly categories = ['All places', 'Architecture', 'Museums', 'Culture', 'Parks & nature'];

  constructor() {
    this.checkHealth();
  }

  retryHealthCheck(): void {
    if (this.healthCheckPending) {
      return;
    }

    this.apiState.set('checking');
    this.apiStatusText.set('Checking local API');
    this.compactApiStatusText.set('Checking API');
    this.checkHealth();
  }

  private checkHealth(): void {
    if (this.healthCheckPending) {
      return;
    }

    this.healthCheckPending = true;
    this.healthApi
      .getHealth()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => (this.healthCheckPending = false)),
      )
      .subscribe({
        next: () => {
          this.apiState.set('online');
          this.apiStatusText.set('Local API connected');
          this.compactApiStatusText.set('API online');
        },
        error: (error: unknown) => {
          const failure = describeHealthFailure(error);
          this.apiState.set(failure.state);
          this.apiStatusText.set(failure.message);
          this.compactApiStatusText.set(failure.compactMessage);
        },
      });
  }
}

function describeHealthFailure(error: unknown): {
  state: 'offline' | 'unexpected';
  message: string;
  compactMessage: string;
} {
  if (
    error instanceof UnexpectedHealthResponseError ||
    (error instanceof HttpErrorResponse && error.status >= 200 && error.status < 300)
  ) {
    return {
      state: 'unexpected',
      message: 'API responded unexpectedly',
      compactMessage: 'Invalid API reply',
    };
  }

  if (error instanceof HttpErrorResponse) {
    return {
      state: 'offline',
      message: error.status === 0 ? 'Could not reach API' : `API returned HTTP ${error.status}`,
      compactMessage: 'API offline',
    };
  }

  return {
    state: 'unexpected',
    message: 'Health check failed unexpectedly',
    compactMessage: 'Check failed',
  };
}
