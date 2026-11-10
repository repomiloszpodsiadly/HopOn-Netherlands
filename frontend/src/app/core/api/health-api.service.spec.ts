import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HealthApiService, UnexpectedHealthResponseError } from './health-api.service';

describe('HealthApiService', () => {
  let service: HealthApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HealthApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HealthApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('requests the same-origin health endpoint and returns the typed contract', () => {
    let response: unknown;
    service.getHealth().subscribe((health) => (response = health));

    const request = httpTesting.expectOne('/api/health');
    expect(request.request.method).toBe('GET');
    request.flush({ status: 'UP', service: 'hopon-api' });

    expect(response).toEqual({ status: 'UP', service: 'hopon-api' });
  });

  it('rejects an unexpected health payload', () => {
    let error: unknown;
    service.getHealth().subscribe({ error: (caught: unknown) => (error = caught) });

    httpTesting.expectOne('/api/health').flush({ status: 'DOWN', service: 'wrong-api' });

    expect(error).toBeInstanceOf(UnexpectedHealthResponseError);
    expect((error as Error).message).toBe('Health endpoint returned an unexpected response');
  });
});
