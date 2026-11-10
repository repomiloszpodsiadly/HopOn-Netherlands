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

  it('reports an HTTP error and offers a retry', () => {
    const fixture = TestBed.createComponent(ExplorePage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/health').flush('offline', {
      status: 503,
      statusText: 'Service unavailable',
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.api-status__text--desktop')?.textContent).toContain('API returned HTTP 503');
    expect(element.querySelector('.api-status__text--compact')?.textContent).toContain('API offline');
    expect(element.querySelector('button.api-status__retry')?.textContent).toContain('Retry');
  });

  it('reports a connection failure separately from an invalid API response', () => {
    const fixture = TestBed.createComponent(ExplorePage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/health')
      .error(new ProgressEvent('error'));
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.api-status__text--desktop')?.textContent).toContain('Could not reach API');
    expect(element.querySelector('.api-status--offline')).toBeTruthy();
  });

  it('labels an unexpected successful payload and allows recovery with Retry', () => {
    const fixture = TestBed.createComponent(ExplorePage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/health')
      .flush({ status: 'DOWN', service: 'wrong-api' });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.api-status--unexpected')).toBeTruthy();
    expect(element.querySelector('.api-status__text--desktop')?.textContent).toContain(
      'API responded unexpectedly',
    );
    expect(element.querySelector('.api-status__text--compact')?.textContent).toContain('Invalid API reply');

    const retry = element.querySelector('button.api-status__retry') as HTMLButtonElement;
    retry.click();
    retry.click();
    fixture.detectChanges();

    const retryRequest = TestBed.inject(HttpTestingController).expectOne('/api/health');
    retryRequest.flush({ status: 'UP', service: 'hopon-api' });
    fixture.detectChanges();

    expect(element.querySelector('.api-status--online')).toBeTruthy();
    expect(element.querySelector('.api-status__text--compact')?.textContent).toContain('API online');
    expect(element.querySelector('button.api-status__retry')).toBeNull();
  });
});
