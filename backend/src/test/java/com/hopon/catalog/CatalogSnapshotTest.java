package com.hopon.catalog;

import com.hopon.HopOnApplication;
import com.hopon.cities.City;
import com.hopon.places.Place;
import com.hopon.places.PlaceCategory;
import com.hopon.transit.MobilityHub;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ResourceLoader;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
class CatalogSnapshotTest {

    private static final List<String> CITY_IDS = List.of("amsterdam", "rotterdam", "utrecht");

    @Autowired
    private CatalogSnapshot snapshot;

    @Autowired
    private CatalogSnapshotValidator validator;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ResourceLoader resourceLoader;

    @Test
    void loadsTheCompleteSortedOpenStreetMapSnapshot() {
        assertThat(snapshot.cities()).extracting(City::id).containsExactlyElementsOf(CITY_IDS);
        assertThat(snapshot.places()).hasSize(2707);
        assertThat(snapshot.places()).isSortedAccordingTo(Comparator
                .comparing(Place::cityId)
                .thenComparing(place -> place.name().toLowerCase(Locale.ROOT))
                .thenComparing(Place::id));
        assertThat(snapshot.hubs()).isSortedAccordingTo(Comparator
                .comparing(MobilityHub::cityId)
                .thenComparing(hub -> hub.name().toLowerCase(Locale.ROOT))
                .thenComparing(MobilityHub::id));

        assertThat(snapshot.places()).filteredOn(place -> place.cityId().equals("amsterdam")).hasSize(1436);
        assertThat(snapshot.places()).filteredOn(place -> place.cityId().equals("rotterdam")).hasSize(674);
        assertThat(snapshot.places()).filteredOn(place -> place.cityId().equals("utrecht")).hasSize(597);
        assertThat(snapshot.places()).extracting(Place::id).doesNotHaveDuplicates();
        assertThat(snapshot.places()).extracting(Place::category).contains(PlaceCategory.values());

        for (String cityId : CITY_IDS) {
            assertThat(snapshot.hubs()).filteredOn(hub -> hub.cityId().equals(cityId)).hasSize(6);
        }
        assertThat(snapshot.places()).allSatisfy(place -> {
            assertThat(place.latitude()).isBetween(-90.0, 90.0);
            assertThat(place.longitude()).isBetween(-180.0, 180.0);
            assertThat(place.category()).isNotNull();
            assertThat(place.shortDescription()).isNotBlank();
            assertThat(place.sourceUrl()).startsWith("https://www.openstreetmap.org/");
            assertThat(place.sourceTags()).containsKey("name");
        });
        assertThat(snapshot.hubs()).allSatisfy(hub -> {
            assertThat(hub.latitude()).isBetween(-90.0, 90.0);
            assertThat(hub.longitude()).isBetween(-180.0, 180.0);
            assertThat(hub.modes()).isNotEmpty();
            assertThat(hub.source()).startsWith("https://www.openstreetmap.org/");
        });

        validator.validate(snapshot);
    }

    @Test
    void rejectsMalformedResourceFixture() {
        assertThatThrownBy(() -> new CatalogSnapshotLoader(
                objectMapper,
                resourceLoader,
                validator,
                "classpath:catalog/cities.json",
                "classpath:catalog/invalid/places-malformed.json",
                "classpath:catalog/stops.json"))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    void rejectsDuplicatePlaceIdentityAndCanonicalName() {
        Place original = snapshot.places().getFirst();
        List<Place> duplicated = new ArrayList<>(snapshot.places());
        duplicated.add(copyPlace(original, original.id(), original.cityId(), original.name()));

        assertThatThrownBy(() -> validator.validate(new CatalogSnapshot(snapshot.cities(), duplicated, snapshot.hubs())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("place IDs must be present and unique")
                .hasMessageContaining("duplicate canonical place name");

        List<Place> sameCanonicalName = new ArrayList<>(snapshot.places());
        Place other = sameCanonicalName.get(1);
        sameCanonicalName.set(1, copyPlace(other, other.id(), other.cityId(), original.name().toUpperCase(Locale.ROOT)));
        assertThatThrownBy(() -> validator.validate(new CatalogSnapshot(snapshot.cities(), sameCanonicalName, snapshot.hubs())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("duplicate canonical place name");
    }

    @Test
    void rejectsInvalidCoordinatesAndCrossCityRecords() {
        List<Place> invalidCoordinates = new ArrayList<>(snapshot.places());
        Place first = invalidCoordinates.getFirst();
        invalidCoordinates.set(0, new Place(
                first.id(), first.cityId(), first.name(), first.category(), 200.0, first.longitude(),
                first.tags(), first.shortDescription(), first.imagePath(), first.imageAttributionId(),
                first.sourceUrl(), first.sourceType(), first.sourceOsmId(), first.sourceTags()));

        assertThatThrownBy(() -> validator.validate(new CatalogSnapshot(snapshot.cities(), invalidCoordinates, snapshot.hubs())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("place coordinates are invalid");

        List<Place> crossCity = new ArrayList<>(snapshot.places());
        Place amsterdamPlace = crossCity.getFirst();
        crossCity.set(0, copyPlace(amsterdamPlace, amsterdamPlace.id(), "rotterdam", amsterdamPlace.name()));
        assertThatThrownBy(() -> validator.validate(new CatalogSnapshot(snapshot.cities(), crossCity, snapshot.hubs())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("outside its city bounds");
    }

    @Test
    void applicationStartupFailsWhenCatalogSnapshotIsInvalid() {
        assertThatThrownBy(() -> new SpringApplicationBuilder(HopOnApplication.class)
                .web(WebApplicationType.NONE)
                .properties("hopon.catalog.places=classpath:catalog/invalid/places-empty.json")
                .run())
                .satisfies(failure -> {
                    Throwable rootCause = failure;
                    while (rootCause.getCause() != null) {
                        rootCause = rootCause.getCause();
                    }
                    assertThat(rootCause)
                            .isInstanceOf(IllegalStateException.class)
                            .hasMessageContaining("must contain at least 25 places");
                });
    }

    private static Place copyPlace(Place place, String id, String cityId, String name) {
        return new Place(
                id,
                cityId,
                name,
                place.category(),
                place.latitude(),
                place.longitude(),
                place.tags(),
                place.shortDescription(),
                place.imagePath(),
                place.imageAttributionId(),
                place.sourceUrl(),
                place.sourceType(),
                place.sourceOsmId(),
                place.sourceTags());
    }
}
