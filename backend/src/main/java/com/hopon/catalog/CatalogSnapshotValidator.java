package com.hopon.catalog;

import com.hopon.cities.City;
import com.hopon.places.Place;
import com.hopon.places.PlaceCategory;
import com.hopon.transit.HubMode;
import com.hopon.transit.MobilityHub;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Component
public final class CatalogSnapshotValidator {

    private static final List<String> EXPECTED_CITY_IDS = List.of("amsterdam", "rotterdam", "utrecht");
    private static final Comparator<Place> PLACE_ORDER = Comparator
            .comparing(Place::cityId)
            .thenComparing(place -> place.name().toLowerCase(Locale.ROOT))
            .thenComparing(Place::id);
    private static final Comparator<MobilityHub> HUB_ORDER = Comparator
            .comparing(MobilityHub::cityId)
            .thenComparing(hub -> hub.name().toLowerCase(Locale.ROOT))
            .thenComparing(MobilityHub::id);
    private static final Map<String, CityBounds> CITY_BOUNDS = Map.of(
            "amsterdam", new CityBounds(52.22, 52.46, 4.70, 5.10),
            "rotterdam", new CityBounds(51.84, 52.03, 4.25, 4.68),
            "utrecht", new CityBounds(52.00, 52.18, 4.95, 5.25));
    private static final Set<String> OSM_TYPES = Set.of("node", "way", "relation");

    public void validate(CatalogSnapshot snapshot) {
        List<String> errors = new ArrayList<>();
        validateCities(snapshot.cities(), errors);
        validatePlaces(snapshot.places(), snapshot.cities(), errors);
        validateHubs(snapshot.hubs(), snapshot.cities(), errors);

        if (!errors.isEmpty()) {
            throw new IllegalStateException("Invalid catalog snapshot: " + String.join("; ", errors));
        }
    }

    private static void validateCities(List<City> cities, List<String> errors) {
        List<String> actualCityIds = cities.stream().map(City::id).toList();
        if (!EXPECTED_CITY_IDS.equals(actualCityIds)) {
            errors.add("cities must be exactly " + EXPECTED_CITY_IDS + " in that order");
        }

        Set<String> ids = new HashSet<>();
        for (City city : cities) {
            if (isBlank(city.id()) || !ids.add(city.id())) {
                errors.add("city IDs must be present and unique: " + city.id());
            }
            if (isBlank(city.name())) {
                errors.add("city name is required for " + city.id());
            }
            if (city.center() == null || !isValidPoint(city.center().latitude(), city.center().longitude())) {
                errors.add("city center coordinates are invalid for " + city.id());
            } else if (!isWithinCity(city.id(), city.center().latitude(), city.center().longitude())) {
                errors.add("city center falls outside its supported bounds: " + city.id());
            }
            if (!Double.isFinite(city.defaultZoom()) || city.defaultZoom() < 8.0 || city.defaultZoom() > 16.0) {
                errors.add("default zoom must be between 8 and 16 for " + city.id());
            }
            if (!isOsmSource(city.sourceUrl(), null, null)) {
                errors.add("city source must be a valid OpenStreetMap URL for " + city.id());
            }
            if (city.sourceTags() == null
                    || !"city".equals(city.sourceTags().get("place"))
                    || isBlank(city.sourceTags().get("name"))
                    || !canonicalName(city.name()).equals(canonicalName(city.sourceTags().get("name")))) {
                errors.add("city source must identify an OSM place=city node for " + city.id());
            }
        }
    }

    private static void validatePlaces(List<Place> places, List<City> cities, List<String> errors) {
        Set<String> supportedCities = cityIds(cities);
        Map<String, Integer> counts = new HashMap<>();
        Map<String, Integer> architectureCounts = new HashMap<>();
        Map<String, Integer> cultureCounts = new HashMap<>();
        Map<String, Integer> greenCounts = new HashMap<>();
        Set<String> ids = new HashSet<>();
        Set<String> sourceUrls = new HashSet<>();
        Set<String> canonicalNames = new HashSet<>();

        for (Place place : places) {
            if (isBlank(place.id()) || !ids.add(place.id())) {
                errors.add("place IDs must be present and unique: " + place.id());
            }
            if (!supportedCities.contains(place.cityId())) {
                errors.add("place references an unsupported city: " + place.id());
                continue;
            }
            if (isBlank(place.name())) {
                errors.add("place name is required for " + place.id());
            } else if (!canonicalNames.add(place.cityId() + "|" + canonicalName(place.name()))) {
                errors.add("duplicate canonical place name in " + place.cityId() + ": " + place.name());
            }
            if (!isValidPoint(place.latitude(), place.longitude())) {
                errors.add("place coordinates are invalid for " + place.id());
            } else if (!isWithinCity(place.cityId(), place.latitude(), place.longitude())) {
                errors.add("place coordinates fall outside its city bounds: " + place.id());
            }
            if (place.category() == null) {
                errors.add("place category is required for " + place.id());
            } else {
                counts.merge(place.cityId(), 1, Integer::sum);
                if (place.category() == PlaceCategory.ARCHITECTURE) {
                    architectureCounts.merge(place.cityId(), 1, Integer::sum);
                } else if (place.category() == PlaceCategory.CULTURE) {
                    cultureCounts.merge(place.cityId(), 1, Integer::sum);
                } else if (place.category() == PlaceCategory.PARKS_NATURE) {
                    greenCounts.merge(place.cityId(), 1, Integer::sum);
                }
            }
            if (isBlank(place.shortDescription())) {
                errors.add("place description is required for " + place.id());
            }
            if (place.tags() == null || place.tags().isEmpty() || place.tags().stream().anyMatch(CatalogSnapshotValidator::isBlank)) {
                errors.add("place tags must be present and nonblank for " + place.id());
            }
            if (!isOsmSource(place.sourceUrl(), place.sourceType(), place.sourceOsmId())) {
                errors.add("place source identity is invalid for " + place.id());
            } else if (!sourceUrls.add(place.sourceUrl())) {
                errors.add("duplicate OSM source object in places: " + place.sourceUrl());
            }
            if (place.sourceTags() == null || isBlank(place.sourceTags().get("name"))) {
                errors.add("place source must retain its OSM name tag: " + place.id());
            }
            String addressCity = place.sourceTags() == null ? null : place.sourceTags().get("addr:city");
            if (!isBlank(addressCity) && !canonicalName(addressCity).equals(canonicalName(cityName(place.cityId())))) {
                errors.add("place address identifies a different city: " + place.id());
            }
            validateImageMetadata(place, errors);
        }

        for (String cityId : EXPECTED_CITY_IDS) {
            if (counts.getOrDefault(cityId, 0) < 25) {
                errors.add(cityId + " must contain at least 25 places");
            }
            if (architectureCounts.getOrDefault(cityId, 0) < 3) {
                errors.add(cityId + " must contain at least three architecture places");
            }
            if (cultureCounts.getOrDefault(cityId, 0) < 3) {
                errors.add(cityId + " must contain at least three culture places");
            }
            if (greenCounts.getOrDefault(cityId, 0) < 3) {
                errors.add(cityId + " must contain at least three green places");
            }
        }
        if (!isOrdered(places, PLACE_ORDER)) {
            errors.add("places must be ordered by city ID, normalized name, then ID");
        }
    }

    private static void validateHubs(List<MobilityHub> hubs, List<City> cities, List<String> errors) {
        Set<String> supportedCities = cityIds(cities);
        Map<String, Integer> counts = new HashMap<>();
        Set<String> ids = new HashSet<>();
        Set<String> sourceUrls = new HashSet<>();

        for (MobilityHub hub : hubs) {
            if (isBlank(hub.id()) || !ids.add(hub.id())) {
                errors.add("hub IDs must be present and unique: " + hub.id());
            }
            if (!supportedCities.contains(hub.cityId())) {
                errors.add("hub references an unsupported city: " + hub.id());
                continue;
            }
            counts.merge(hub.cityId(), 1, Integer::sum);
            if (isBlank(hub.name())) {
                errors.add("hub name is required for " + hub.id());
            }
            if (!isValidPoint(hub.latitude(), hub.longitude())) {
                errors.add("hub coordinates are invalid for " + hub.id());
            } else if (!isWithinCity(hub.cityId(), hub.latitude(), hub.longitude())) {
                errors.add("hub coordinates fall outside its city bounds: " + hub.id());
            }
            if (hub.modes() == null || hub.modes().isEmpty() || hub.modes().stream().anyMatch(mode -> mode == null)) {
                errors.add("hub modes must be present for " + hub.id());
            } else {
                if (new HashSet<>(hub.modes()).size() != hub.modes().size()) {
                    errors.add("hub modes must be unique for " + hub.id());
                }
                if (hub.modes().contains(HubMode.UNKNOWN) && hub.modes().size() > 1) {
                    errors.add("UNKNOWN cannot be combined with a claimed hub mode: " + hub.id());
                }
                validateHubModeSources(hub, errors);
            }
            if (!isOsmSource(hub.source(), hub.sourceType(), hub.sourceOsmId())) {
                errors.add("hub source identity is invalid for " + hub.id());
            } else if (!sourceUrls.add(hub.source())) {
                errors.add("duplicate OSM source object in hubs: " + hub.source());
            }
            if (hub.sourceTags() == null || isBlank(hub.sourceTags().get("name"))) {
                errors.add("hub source must retain its OSM name tag: " + hub.id());
            }
        }

        for (String cityId : EXPECTED_CITY_IDS) {
            if (counts.getOrDefault(cityId, 0) < 6) {
                errors.add(cityId + " must contain at least six curated mobility hubs");
            }
        }
        if (!isOrdered(hubs, HUB_ORDER)) {
            errors.add("hubs must be ordered by city ID, normalized name, then ID");
        }
    }

    private static void validateHubModeSources(MobilityHub hub, List<String> errors) {
        Map<String, String> tags = hub.sourceTags();
        String railway = tags == null ? null : tags.get("railway");
        String station = tags == null ? null : tags.get("station");
        if (hub.modes().contains(HubMode.TRAIN)
                && !"station".equals(railway)
                && (station == null || !station.contains("train"))) {
            errors.add("TRAIN mode is not present in the OSM source tags for " + hub.id());
        }
        if (hub.modes().contains(HubMode.METRO) && (station == null || !station.contains("subway"))) {
            errors.add("METRO mode is not present in the OSM source tags for " + hub.id());
        }
        if ((hub.modes().contains(HubMode.TRAM) || hub.modes().contains(HubMode.BUS) || hub.modes().contains(HubMode.FERRY))
                && (tags == null || isBlank(tags.get("public_transport")) && isBlank(tags.get("amenity")))) {
            errors.add("hub mode is not substantiated by transport source tags for " + hub.id());
        }
    }

    private static void validateImageMetadata(Place place, List<String> errors) {
        boolean hasImagePath = !isBlank(place.imagePath());
        boolean hasAttribution = !isBlank(place.imageAttributionId());
        if (hasImagePath != hasAttribution) {
            errors.add("image path and attribution ID must be provided together for " + place.id());
        }
    }

    private static boolean isOsmSource(String sourceUrl, String sourceType, String sourceOsmId) {
        if (isBlank(sourceUrl)) {
            return false;
        }
        try {
            URI uri = URI.create(sourceUrl);
            if (!"https".equals(uri.getScheme()) || !"www.openstreetmap.org".equals(uri.getHost())) {
                return false;
            }
            String[] segments = uri.getPath().split("/");
            if (segments.length != 3
                    || !OSM_TYPES.contains(segments[1])
                    || !segments[2].matches("[1-9][0-9]*")
                    || uri.getPort() != -1
                    || uri.getQuery() != null
                    || uri.getFragment() != null) {
                return false;
            }
            String canonicalSource = "https://www.openstreetmap.org/" + segments[1] + "/" + segments[2];
            return canonicalSource.equals(sourceUrl)
                    && (sourceType == null && sourceOsmId == null
                    || segments[1].equals(sourceType) && segments[2].equals(sourceOsmId));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static boolean isValidPoint(double latitude, double longitude) {
        return Double.isFinite(latitude)
                && Double.isFinite(longitude)
                && latitude >= -90.0
                && latitude <= 90.0
                && longitude >= -180.0
                && longitude <= 180.0;
    }

    private static boolean isWithinCity(String cityId, double latitude, double longitude) {
        CityBounds bounds = CITY_BOUNDS.get(cityId);
        return bounds != null
                && latitude >= bounds.minLatitude()
                && latitude <= bounds.maxLatitude()
                && longitude >= bounds.minLongitude()
                && longitude <= bounds.maxLongitude();
    }

    private static <T> boolean isOrdered(List<T> values, Comparator<? super T> comparator) {
        for (int index = 1; index < values.size(); index++) {
            if (comparator.compare(values.get(index - 1), values.get(index)) > 0) {
                return false;
            }
        }
        return true;
    }

    private static Set<String> cityIds(List<City> cities) {
        Set<String> ids = new HashSet<>();
        cities.forEach(city -> ids.add(city.id()));
        return ids;
    }

    private static String cityName(String cityId) {
        return switch (cityId) {
            case "amsterdam" -> "Amsterdam";
            case "rotterdam" -> "Rotterdam";
            case "utrecht" -> "Utrecht";
            default -> cityId;
        };
    }

    private static String canonicalName(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[\\p{P}\\p{Z}\\s]+", "");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record CityBounds(double minLatitude, double maxLatitude, double minLongitude, double maxLongitude) {
    }
}
