import { DestroyRef, Directive, ElementRef, inject, NgZone } from '@angular/core';

/** A decorative highlight; native click, touch and keyboard behaviour stay intact. */
@Directive({
  selector: '[appPointerLight]',
  host: { class: 'pointer-light' },
})
export class PointerLightDirective {
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    const view = element.ownerDocument.defaultView;
    if (!view?.matchMedia) {
      return;
    }

    const media = view.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    inject(NgZone).runOutsideAngular(() => {
      let frame: number | null = null;
      let x = 50;
      let y = 50;

      const reset = () => {
        if (frame !== null) {
          view.cancelAnimationFrame(frame);
          frame = null;
        }
        element.style.removeProperty('--light-x');
        element.style.removeProperty('--light-y');
      };

      const move = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse' || !media.matches || element.matches(':disabled')) {
          return;
        }
        const bounds = element.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) {
          return;
        }
        x = Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100));
        y = Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100));
        if (frame === null) {
          frame = view.requestAnimationFrame(() => {
            frame = null;
            element.style.setProperty('--light-x', `${x.toFixed(2)}%`);
            element.style.setProperty('--light-y', `${y.toFixed(2)}%`);
          });
        }
      };

      element.addEventListener('pointermove', move, { passive: true });
      element.addEventListener('pointerleave', reset);
      media.addEventListener('change', reset);
      destroyRef.onDestroy(() => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerleave', reset);
        media.removeEventListener('change', reset);
        reset();
      });
    });
  }
}
