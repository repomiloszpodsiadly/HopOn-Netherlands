import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { CityId } from '../../core/models/catalog.models';
import { MainNavigationComponent } from './main-navigation';

@Component({
  standalone: true,
  imports: [MainNavigationComponent],
  template: '<app-main-navigation [cityId]="cityId" />',
})
class PlansPageWithCityContext {
  cityId: CityId = 'rotterdam';
}

@Component({
  standalone: true,
  imports: [MainNavigationComponent],
  template: '<app-main-navigation />',
})
class PlansPageWithoutCityContext {}

@Component({
  standalone: true,
  template: '<main id="map-region" tabindex="-1">Map region</main>',
})
class MapDestinationPage {}

describe('MainNavigationComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: 'plans', component: PlansPageWithCityContext },
        { path: 'plans-default', component: PlansPageWithoutCityContext },
        { path: '', component: MapDestinationPage },
      ])],
    });
  });

  it('navigates from Plans to the known city map and focuses the map region', async () => {
    const harness = await RouterTestingHarness.create('/plans');
    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(mapLink?.getAttribute('href')).toBe('/?city=rotterdam#map-region');

    mapLink?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/?city=rotterdam#map-region');
    expect(document.activeElement?.id).toBe('map-region');
  });

  it('uses Amsterdam as the stable default when Plans has no city context', async () => {
    const harness = await RouterTestingHarness.create('/plans-default');
    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(mapLink?.getAttribute('href')).toBe('/?city=amsterdam#map-region');

    mapLink?.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/?city=amsterdam#map-region');
    expect(document.activeElement?.id).toBe('map-region');
  });

  it('replaces an unknown city context with the stable default', async () => {
    const harness = await RouterTestingHarness.create('/plans');
    const plansPage = harness.routeDebugElement?.componentInstance as PlansPageWithCityContext;
    plansPage.cityId = 'haarlem' as CityId;
    harness.detectChanges();

    const mapLink = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.bottom-nav__item[href$="#map-region"]',
    );
    expect(mapLink?.getAttribute('href')).toBe('/?city=amsterdam#map-region');
  });
});
