package com.hopon.catalog;

import com.hopon.cities.City;
import com.hopon.cities.CityDto;
import com.hopon.places.Place;
import com.hopon.places.PlaceCategory;
import com.hopon.places.PlaceDto;
import com.hopon.transit.MobilityHub;
import com.hopon.transit.MobilityHubDto;
import com.hopon.web.InvalidCatalogRequestException;
import com.hopon.web.PlaceNotFoundException;
import org.springframework.stereotype.Service;

import java.text.Normalizer;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

@Service
public class CatalogQueryService {

    private static final int MAX_QUERY_LENGTH = 100;
    private static final Comparator<Place> PLACE_ORDER = Comparator
            .comparing((Place place) -> normalize(place.name()))
            .thenComparing(Place::id);
    private static final Comparator<MobilityHub> HUB_ORDER = Comparator
            .comparing((MobilityHub hub) -> normalize(hub.name()))
            .thenComparing(MobilityHub::id);

    private final CatalogSnapshot snapshot;

    public CatalogQueryService(CatalogSnapshot snapshot) {
        this.snapshot = snapshot;
    }

    public List<CityDto> getCities() {
        return snapshot.cities().stream()
                .map(city -> new CityDto(city.id(), city.name(), city.center(), city.defaultZoom()))
                .toList();
    }

    public List<PlaceDto> getPlaces(String cityId, String query, String categoryValue) {
        requireCity(cityId);
        validateQuery(query);
        PlaceCategory category = parseCategory(categoryValue);
        String normalizedQuery = query == null ? "" : normalize(query.trim());

        return placesForCity(cityId).stream()
                .filter(place -> category == null || place.category() == category)
                .filter(place -> normalizedQuery.isEmpty() || matches(place, normalizedQuery))
                .map(CatalogQueryService::toDto)
                .toList();
    }

    public PlaceDto getPlace(String id) {
        return snapshot.places().stream()
                .filter(place -> place.id().equals(id))
                .findFirst()
                .map(CatalogQueryService::toDto)
                .orElseThrow(PlaceNotFoundException::new);
    }

    public List<Place> placesForCity(String cityId) {
        requireCity(cityId);
        return snapshot.places().stream()
                .filter(place -> place.cityId().equals(cityId))
                .sorted(PLACE_ORDER)
                .toList();
    }

    public List<MobilityHubDto> getHubs(String cityId) {
        requireCity(cityId);
        return snapshot.hubs().stream()
                .filter(hub -> hub.cityId().equals(cityId))
                .sorted(HUB_ORDER)
                .map(CatalogQueryService::toDto)
                .toList();
    }

    private void requireCity(String cityId) {
        if (cityId == null || snapshot.cities().stream().noneMatch(city -> city.id().equals(cityId))) {
            throw new InvalidCatalogRequestException("cityId is required and must identify a supported city.");
        }
    }

    private static void validateQuery(String query) {
        if (query == null) {
            return;
        }
        if (query.length() > MAX_QUERY_LENGTH) {
            throw new InvalidCatalogRequestException("q must be at most 100 characters.");
        }
        if (query.codePoints().anyMatch(Character::isISOControl)) {
            throw new InvalidCatalogRequestException("q must not contain control characters.");
        }
    }

    private static PlaceCategory parseCategory(String categoryValue) {
        if (categoryValue == null) {
            return null;
        }
        try {
            return PlaceCategory.valueOf(categoryValue);
        } catch (IllegalArgumentException exception) {
            throw new InvalidCatalogRequestException(
                    "category must be one of ARCHITECTURE, MUSEUMS, CULTURE, PARKS_NATURE, LANDMARKS.");
        }
    }

    private static boolean matches(Place place, String normalizedQuery) {
        return normalize(place.name()).contains(normalizedQuery)
                || normalize(place.shortDescription()).contains(normalizedQuery)
                || place.tags().stream().anyMatch(tag -> normalize(tag).contains(normalizedQuery));
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
    }

    private static PlaceDto toDto(Place place) {
        return new PlaceDto(
                place.id(),
                place.cityId(),
                place.name(),
                place.category(),
                place.latitude(),
                place.longitude(),
                place.tags(),
                place.shortDescription(),
                place.imagePath(),
                place.imageAttributionId());
    }

    private static MobilityHubDto toDto(MobilityHub hub) {
        return new MobilityHubDto(
                hub.id(),
                hub.cityId(),
                hub.name(),
                hub.latitude(),
                hub.longitude(),
                hub.modes(),
                hub.source());
    }
}
