import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlaceDto } from '../../core/models/catalog.models';
import { PlaceDetailComponent } from './place-detail';

const ROYAL_PALACE: PlaceDto = {
  id: 'amsterdam-relation-3580875',
  cityId: 'amsterdam',
  name: 'Royal Palace',
  category: 'ARCHITECTURE',
  latitude: 52.3731449,
  longitude: 4.891336,
  tags: ['architecture'],
  shortDescription: 'A mapped architectural place in Amsterdam.',
  imagePath: '/assets/catalog/royal-palace-amsterdam.jpg',
  imageAttributionId: 'royal-palace-amsterdam',
};

describe('PlaceDetailComponent image attribution', () => {
  let fixture: ComponentFixture<PlaceDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PlaceDetailComponent] }).compileComponents();
    fixture = TestBed.createComponent(PlaceDetailComponent);
    fixture.componentRef.setInput('place', ROYAL_PALACE);
    fixture.componentRef.setInput('cityName', 'Amsterdam');
    fixture.componentRef.setInput('categoryLabel', 'Architecture');
    fixture.detectChanges();
  });

  it('renders responsive local imagery with source and license in a closed disclosure', () => {
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement | null;
    const credit = fixture.nativeElement.querySelector('.place-detail__credit') as HTMLElement | null;
    const visual = fixture.nativeElement.querySelector('.place-detail__visual') as HTMLElement | null;
    const disclosure = credit?.querySelector('details');
    const notice = credit?.querySelector('.place-detail__credit-content p');
    const links = credit?.querySelectorAll('a');

    expect(image?.getAttribute('src')).toBe('/assets/catalog/royal-palace-amsterdam.jpg');
    expect(image?.getAttribute('srcset')).toContain('/assets/catalog/royal-palace-amsterdam-640.jpg 640w');
    expect(image?.getAttribute('sizes')).toContain('348px');
    expect(image?.getAttribute('width')).toBe('1280');
    expect(image?.getAttribute('height')).toBe('960');
    expect(links).toHaveLength(2);
    expect(links?.[0].textContent).toContain('Photo by Elekes Andor');
    expect(links?.[0].getAttribute('href'))
      .toBe('https://commons.wikimedia.org/wiki/File:Royal_Palace_Amsterdam.jpg');
    expect(links?.[1].textContent).toContain('CC BY-SA 4.0');
    expect(links?.[1].getAttribute('href')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(visual?.contains(credit)).toBe(true);
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector('summary')?.getAttribute('aria-label')).toBe('Photo credits');
    expect(notice?.textContent).toBe('Resized and re-encoded from the source; displayed with a crop.');
    expect(fixture.nativeElement.textContent).not.toContain('Used the Commons');
  });

  it('renders the verified author and license for every selected catalog image', () => {
    const examples = [
      {
        place: ROYAL_PALACE,
        author: 'Elekes Andor',
        license: 'CC BY-SA 4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Royal_Palace_Amsterdam.jpg',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      },
      {
        place: {
          ...ROYAL_PALACE,
          id: 'rotterdam-relation-20774225',
          cityId: 'rotterdam',
          name: 'Erasmus Bridge',
          imagePath: '/assets/catalog/erasmus-bridge-rotterdam.jpg',
          imageAttributionId: 'erasmus-bridge-rotterdam',
        },
        author: 'acediscovery',
        license: 'CC BY 4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:ErasmusBridge-Rotterdam.jpg',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      },
      {
        place: {
          ...ROYAL_PALACE,
          id: 'utrecht-way-262779230',
          cityId: 'utrecht',
          name: 'Dom Tower',
          imagePath: '/assets/catalog/dom-tower-utrecht.jpg',
          imageAttributionId: 'dom-tower-utrecht',
        },
        author: 'tED',
        license: 'CC BY 2.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Domtoren_vanaf_de_Maartensbrug.jpg',
        licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      },
    ];

    for (const example of examples) {
      fixture.componentRef.setInput('place', example.place);
      fixture.detectChanges();
      const links = fixture.nativeElement.querySelectorAll('.place-detail__credit a') as NodeListOf<HTMLAnchorElement>;

      expect(links[0].textContent).toContain(`Photo by ${example.author}`);
      expect(links[0].getAttribute('href')).toBe(example.sourceUrl);
      expect(links[1].textContent).toContain(example.license);
      expect(links[1].getAttribute('href')).toBe(example.licenseUrl);
      expect(fixture.nativeElement.querySelector('.place-detail__credit-content p')?.textContent)
        .toBe('Resized and re-encoded from the source; displayed with a crop.');
    }
  });

  it('shows the catalog fallback when the image request fails', () => {
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.place-detail__fallback-mark')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('From the verified Amsterdam catalog');
  });

  it('uses the fallback when a local image path and attribution ID do not match', () => {
    fixture.componentRef.setInput('place', {
      ...ROYAL_PALACE,
      imagePath: '/assets/catalog/erasmus-bridge-rotterdam.jpg',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.place-detail__credit')).toBeNull();
  });

  it('uses the fallback when the image attribution belongs to a different catalog POI', () => {
    fixture.componentRef.setInput('place', {
      ...ROYAL_PALACE,
      id: 'different-amsterdam-place',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.place-detail__credit')).toBeNull();
  });
});
