export type PlaceImageAttribution = Readonly<{
  author: string;
  sourceUrl: string;
  licenseLabel: string;
  licenseUrl: string;
  objectPosition: string;
}>;

const PLACE_IMAGE_ATTRIBUTIONS: Readonly<Record<string, PlaceImageAttribution>> = {
  'royal-palace-amsterdam': {
    author: 'Elekes Andor',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Royal_Palace_Amsterdam.jpg',
    licenseLabel: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    objectPosition: 'center 18%',
  },
  'erasmus-bridge-rotterdam': {
    author: 'acediscovery',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:ErasmusBridge-Rotterdam.jpg',
    licenseLabel: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    objectPosition: 'center 45%',
  },
  'dom-tower-utrecht': {
    author: 'tED',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Domtoren_vanaf_de_Maartensbrug.jpg',
    licenseLabel: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    objectPosition: 'center 18%',
  },
};

export function getPlaceImageAttribution(id: string | null): PlaceImageAttribution | null {
  return id === null ? null : PLACE_IMAGE_ATTRIBUTIONS[id] ?? null;
}
