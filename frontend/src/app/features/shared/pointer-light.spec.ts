import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PointerLightDirective } from './pointer-light';

@Component({ imports: [PointerLightDirective], template: '<button appPointerLight>Explore</button>' })
class PointerLightHost {}

describe('PointerLightDirective', () => {
  let fixture: ComponentFixture<PointerLightHost>;
  let button: HTMLButtonElement;
  let media: MediaQueryList;
  let pendingFrame: FrameRequestCallback | undefined;

  function move(clientX: number, clientY: number, pointerType = 'mouse'): void {
    const event = new MouseEvent('pointermove', { clientX, clientY });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    button.dispatchEvent(event);
  }

  beforeEach(async () => {
    media = Object.assign(new EventTarget(), { matches: true }) as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    TestBed.configureTestingModule({ imports: [PointerLightHost] });
    fixture = TestBed.createComponent(PointerLightHost);
    fixture.detectChanges();
    await fixture.whenStable();
    button = fixture.nativeElement.querySelector('button');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 120, 50));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback;
      return 7;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { pendingFrame = undefined; });
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('coalesces pointer movement into one frame and uses the latest position', () => {
    move(40, 35);
    move(100, 60);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    pendingFrame?.(0);
    expect(button.style.getPropertyValue('--light-x')).toBe('75.00%');
    expect(button.style.getPropertyValue('--light-y')).toBe('80.00%');

    button.dispatchEvent(new Event('pointerleave'));
    expect(button.style.getPropertyValue('--light-x')).toBe('');
    expect(button.style.getPropertyValue('--light-y')).toBe('');
  });

  it('ignores touch and disabled controls, and resets when the media preference changes', () => {
    move(40, 35, 'touch');
    button.disabled = true;
    move(40, 35);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    button.disabled = false;
    move(40, 35);
    pendingFrame?.(0);
    expect(button.style.getPropertyValue('--light-x')).not.toBe('');
    Object.defineProperty(media, 'matches', { value: false });
    media.dispatchEvent(new Event('change'));
    expect(button.style.getPropertyValue('--light-x')).toBe('');
    move(100, 60);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('cancels queued work and removes listeners when its view is destroyed', () => {
    move(40, 35);
    fixture.destroy();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(pendingFrame).toBeUndefined();
    move(100, 60);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(button.style.getPropertyValue('--light-x')).toBe('');
  });
});
