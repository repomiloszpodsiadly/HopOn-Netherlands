import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

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
      () => this.focusMapRegion(),
      () => this.focusMapRegion(),
    );
  }

  private createMapUrlTree() {
    return this.router.createUrlTree(['/'], {
      fragment: 'map-region',
    });
  }

  private focusMapRegion(): void {
    const target = this.document.getElementById('map-region');
    if (target === null) {
      return;
    }

    target.focus({ preventScroll: true });
    const reduceMotion = this.document.defaultView
      ?.matchMedia?.('(prefers-reduced-motion: reduce)')
      ?.matches ?? false;
    target.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
}
