export function focusMapRegion(document: Document): void {
  const target = document.getElementById('map-region');
  if (target === null) {
    return;
  }

  target.focus({ preventScroll: true });
  const reduceMotion = document.defaultView
    ?.matchMedia?.('(prefers-reduced-motion: reduce)')
    ?.matches ?? false;
  target.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}
