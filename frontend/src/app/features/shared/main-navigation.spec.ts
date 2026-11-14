import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { MainNavigationComponent } from './main-navigation';
import { ACTIVE_PLAN_STORAGE_KEY } from '../../core/services/active-plan.store';

@Component({
  standalone: true,
  imports: [MainNavigationComponent],
  template: '<app-main-navigation />',
})
class PlansPageWithCityContext {}

@Component({
  standalone: true,
  imports: [MainNavigationComponent],
  template: '<app-main-navigation />',
})
class PlansPageWithoutCityContext {}

@Component({
  standalone: true,
  imports: [MainNavigationComponent],
  template: '<main id="map-region" tabindex="-1">Map region</main><app-main-navigation />',
})
class MapDestinationPage {}

describe('MainNavigationComponent', () => {
  beforeEach(() => {
    sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: 'plans', component: PlansPageWithCityContext },
        { path: 'plans-default', component: PlansPageWithoutCityContext },
        { path: '', component: MapDestinationPage },
      ])],
    });
  });

  afterEach(() => sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY));

  it('navigates from a city-scoped plan URL to the shared map and focuses the map region', async () => {
    const harness = await RouterTestingHarness.create('/plans?city=rotterdam');
    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(mapLink?.getAttribute('href')).toBe('/#map-region');

    mapLink?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/#map-region');
    expect(document.activeElement?.id).toBe('map-region');
    expect(harness.routeNativeElement?.querySelector('.bottom-nav__item[href$="#map-region"]')
      ?.getAttribute('aria-current')).toBe('location');
    expect(harness.routeNativeElement?.querySelector('.bottom-nav__item[href="/"]')
      ?.getAttribute('aria-current')).toBeNull();
  });

  it('uses the same shared map link when Plans has no city context', async () => {
    const harness = await RouterTestingHarness.create('/plans-default');
    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(mapLink?.getAttribute('href')).toBe('/#map-region');

    mapLink?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/#map-region');
    expect(document.activeElement?.id).toBe('map-region');
  });

  it('keeps the selected saved plan when navigating to the map again', async () => {
    const planId = '614c6654-95e7-4ad6-8fd7-c1fc0b01e95e';
    const harness = await RouterTestingHarness.create(`/?plan=${planId}`);
    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(mapLink?.getAttribute('href')).toBe(`/?plan=${planId}#map-region`);

    mapLink?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe(`/?plan=${planId}#map-region`);
    expect(document.activeElement?.id).toBe('map-region');
  });

  it('does not carry a legacy unknown city query into shared map navigation', async () => {
    const harness = await RouterTestingHarness.create('/plans?city=haarlem');
    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(mapLink?.getAttribute('href')).toBe('/#map-region');
    expect(mapLink?.getAttribute('href')).not.toContain('city=');
  });
});
