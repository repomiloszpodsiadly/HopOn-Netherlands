import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PlaceCategory } from '../../core/models/catalog.models';

@Component({
  selector: 'app-category-icon',
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      @switch (category()) {
        @case ('PARKS_NATURE') { <path d="m12 3-5 6h2l-4 6h5v6h4v-6h5l-4-6h2l-5-6Z"/> }
        @case ('MUSEUMS') { <path d="m3 8 9-5 9 5H3ZM5 10v8m5-8v8m4-8v8m5-8v8M3 21h18M4 18h16"/> }
        @case ('ARCHITECTURE') { <path d="M3 20h18M6 20V9m12 11V9M4 14h16M8 14l4-10 4 10M12 4v16"/> }
        @case ('CULTURE') { <path d="M4 4v9a6 6 0 0 0 12 0V4l-6 2-6-2Zm3 6h1m4 0h1M8 14c1 2 3 2 4 0m6-5 3-1v7a6 6 0 0 1-6 6"/> }
        @case ('LANDMARKS') { <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.3"/> }
        @default {
          <rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/>
          <rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>
        }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; width: 18px; height: 18px; flex: 0 0 auto; } svg { width: 100%; height: 100%; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryIconComponent {
  readonly category = input<PlaceCategory | null>(null);
}
