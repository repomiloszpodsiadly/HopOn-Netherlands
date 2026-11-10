import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ExplorePage } from './explore-page';

describe('ExplorePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExplorePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('renders the accessible city guide shell and navigation', () => {
    const fixture = TestBed.createComponent(ExplorePage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/health')
      .flush({ status: 'UP', service: 'hopon-api' });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain('Find your own');
    expect(element.querySelector('nav[aria-label="Main navigation"]')).toBeTruthy();
    expect(element.querySelector('a[aria-current="page"]')?.textContent).toContain('Explore');
  });

  it('shows an offline status and retry when the API is unavailable', () => {
    const fixture = TestBed.createComponent(ExplorePage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/health').flush('offline', {
      status: 503,
      statusText: 'Service unavailable',
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[role="status"]')?.textContent).toContain('API not running');
    expect(element.querySelector('button.api-status__retry')?.textContent).toContain('Retry');
  });
});
