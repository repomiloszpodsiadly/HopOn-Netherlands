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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
class CatalogSnapshotTest {

    private static final List<String> CITY_IDS = List.of("amsterdam", "rotterdam", "utrecht");
    private static final AtomicLong TEST_SOURCE_IDS = new AtomicLong(99_000_000_000_000L);
    private static final Comparator<Place> PLACE_ORDER = Comparator
            .comparing(Place::cityId)
            .thenComparing(place -> place.name().toLowerCase(Locale.ROOT))
            .thenComparing(Place::id);
    private static final Comparator<MobilityHub> HUB_ORDER = Comparator
            .comparing(MobilityHub::cityId)
            .thenComparing(hub -> hub.name().toLowerCase(Locale.ROOT))
            .thenComparing(MobilityHub::id);

    @Autowired
    private CatalogSnapshot snapshot;

    @Autowired
    private CatalogSnapshotValidator validator;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ResourceLoader resourceLoader;

    @Test
    void loadsSortedCatalogWithMinimumCoverageUniqueIdentityAndSourceMetadata() throws Exception {
        assertThat(snapshot.cities()).extracting(City::id).containsExactlyElementsOf(CITY_IDS);
        assertThat(snapshot.places()).isSortedAccordingTo(PLACE_ORDER);
        assertThat(snapshot.hubs()).isSortedAccordingTo(HUB_ORDER);

        List<String> catalogIds = Stream.concat(
                        snapshot.places().stream().map(Place::id),
                        snapshot.hubs().stream().map(MobilityHub::id))
                .toList();
        assertThat(catalogIds).doesNotHaveDuplicates();

        List<String> sourceIdentities = Stream.concat(
                        snapshot.places().stream().map(place -> sourceIdentity(place.sourceType(), place.sourceOsmId())),
                        snapshot.hubs().stream().map(hub -> sourceIdentity(hub.sourceType(), hub.sourceOsmId())))
                .toList();
        assertThat(sourceIdentities).doesNotHaveDuplicates();

        for (String cityId : CITY_IDS) {
            List<Place> cityPlaces = snapshot.places().stream()
                    .filter(place -> place.cityId().equals(cityId))
                    .toList();
            assertThat(cityPlaces).hasSizeGreaterThanOrEqualTo(25);
            assertThat(cityPlaces).extracting(Place::category).contains(PlaceCategory.values());
            assertThat(snapshot.hubs().stream().filter(hub -> hub.cityId().equals(cityId)).toList())
                    .hasSizeGreaterThanOrEqualTo(6);
        }

        assertThat(snapshot.places()).allSatisfy(place -> {
            assertThat(place.latitude()).isBetween(-90.0, 90.0);
            assertThat(place.longitude()).isBetween(-180.0, 180.0);
            assertThat(place.category()).isNotNull();
            assertThat(place.shortDescription()).isNotBlank();
            assertThat(place.sourceUrl()).isEqualTo(osmUrl(place.sourceType(), place.sourceOsmId()));
            assertThat(place.sourceTags()).containsKey("name");
            assertThat(place.imagePath() == null).isEqualTo(place.imageAttributionId() == null);
        });
        assertThat(snapshot.hubs()).allSatisfy(hub -> {
            assertThat(hub.latitude()).isBetween(-90.0, 90.0);
            assertThat(hub.longitude()).isBetween(-180.0, 180.0);
            assertThat(hub.modes()).isNotEmpty();
            assertThat(hub.source()).isEqualTo(osmUrl(hub.sourceType(), hub.sourceOsmId()));
        });

        validator.validate(snapshot);
        new CatalogProvenanceValidator().validate(snapshot, readProvenanceManifest());
    }

    @Test
    void acceptsDistantSameNamePlacesAndAdditionalValidCatalogRecords() {
        Place original = snapshot.places().getFirst();
        String addedPlaceSourceId = nextSourceId();
        Place distantSameName = copyPlace(
                original,
                original.cityId() + "-node-" + addedPlaceSourceId,
                original.name(),
                original.category(),
                52.22,
                4.70,
                "node",
                addedPlaceSourceId,
                withTag(original.sourceTags(), "wikidata", "Q" + addedPlaceSourceId));
        assertThat(distanceMeters(original, distantSameName)).isGreaterThan(30.0);

        List<Place> extendedPlaces = new ArrayList<>(snapshot.places());
        extendedPlaces.add(distantSameName);
        extendedPlaces.sort(PLACE_ORDER);

        MobilityHub originalHub = snapshot.hubs().getFirst();
        String addedHubSourceId = nextSourceId();
        String addedHubName = originalHub.name() + " extension";
        MobilityHub additionalHub = copyHub(
                originalHub,
                originalHub.cityId() + "-node-" + addedHubSourceId,
                addedHubName,
                "node",
                addedHubSourceId,
                withTag(originalHub.sourceTags(), "name", addedHubName));
        List<MobilityHub> extendedHubs = new ArrayList<>(snapshot.hubs());
        extendedHubs.add(additionalHub);
        extendedHubs.sort(HUB_ORDER);

        CatalogSnapshot extendedSnapshot = new CatalogSnapshot(snapshot.cities(), extendedPlaces, extendedHubs);
        validator.validate(extendedSnapshot);
        assertThat(extendedSnapshot.places()).contains(distantSameName);
        assertThat(extendedSnapshot.hubs()).contains(additionalHub);
    }

    @Test
    void rejectsDuplicateCatalogIdsAndCanonicalOsmSourceIdentity() {
        Place original = snapshot.places().getFirst();
        Place repeatedId = copyPlace(
                original,
                original.id(),
                original.name() + " alternate record",
                original.category(),
                original.latitude(),
                original.longitude(),
                "node",
                nextSourceId(),
                withTag(original.sourceTags(), "name", original.name() + " alternate record"));
        assertThatThrownBy(() -> validator.validate(snapshotWithAdditionalPlace(repeatedId)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("catalog record IDs must be present and unique");

        Place repeatedSource = copyPlace(
                original,
                original.id() + "-second-record",
                original.name() + " alternate label",
                original.category(),
                original.latitude(),
                original.longitude(),
                original.sourceType(),
                original.sourceOsmId(),
                withTag(original.sourceTags(), "name", original.name() + " alternate label"));
        assertThatThrownBy(() -> validator.validate(snapshotWithAdditionalPlace(repeatedSource)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("duplicate canonical OSM source identity");
    }

    @Test
    void rejectsNearDuplicateOnlyWhenCityCategoryNameAndDistanceMatch() {
        Place original = snapshot.places().getFirst();
        Place originalRecord = copyPlace(
                original,
                original.id(),
                original.name(),
                original.category(),
                original.latitude(),
                original.longitude(),
                original.sourceType(),
                original.sourceOsmId(),
                original.sourceTags());
        double nearbyLatitude = original.latitude() < 52.45 ? original.latitude() + 0.00001 : original.latitude() - 0.00001;
        String nearDuplicateSourceId = nextSourceId();
        Place sameCategoryNearDuplicate = copyPlace(
                original,
                original.cityId() + "-node-" + nearDuplicateSourceId,
                original.name(),
                original.category(),
                nearbyLatitude,
                original.longitude(),
                "node",
                nearDuplicateSourceId,
                original.sourceTags());

        CatalogSnapshot nearDuplicateSnapshot = snapshotWithReplacementAndAdditionalPlace(
                original, originalRecord, sameCategoryNearDuplicate);
        assertThat(distanceMeters(originalRecord, sameCategoryNearDuplicate)).isLessThanOrEqualTo(30.0);
        assertThatThrownBy(() -> validator.validate(nearDuplicateSnapshot))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("near-duplicate OSM representation within 30 m");

        PlaceCategory differentCategory = Stream.of(PlaceCategory.values())
                .filter(category -> category != original.category())
                .findFirst()
                .orElseThrow();
        String differentCategorySourceId = nextSourceId();
        Place differentCategoryNearRecord = copyPlace(
                original,
                original.cityId() + "-node-" + differentCategorySourceId,
                original.name(),
                differentCategory,
                nearbyLatitude,
                original.longitude(),
                "node",
                differentCategorySourceId,
                original.sourceTags());
        CatalogSnapshot differentCategorySnapshot = snapshotWithReplacementAndAdditionalPlace(
                original, originalRecord, differentCategoryNearRecord);
        assertThatCode(() -> validator.validate(differentCategorySnapshot)).doesNotThrowAnyException();
    }

    @Test
    void validatesManifestCountsAtRuntimeOfTheTestAndRejectsMismatchedManifest() throws Exception {
        JsonNode manifest = readProvenanceManifest();
        CatalogProvenanceValidator provenanceValidator = new CatalogProvenanceValidator();
        assertThat(manifest.path("attribution").asString()).isEqualTo("\u00A9 OpenStreetMap contributors");
        assertThat(manifest.path("license").asString()).contains("Open Database License", "ODbL");
        assertThatCode(() -> provenanceValidator.validate(snapshot, manifest)).doesNotThrowAnyException();

        ObjectNode mismatchedManifest = (ObjectNode) manifest.deepCopy();
        ObjectNode placeCounts = (ObjectNode) mismatchedManifest.get("placeCounts");
        int actualUtrechtCount = (int) snapshot.places().stream()
                .filter(place -> place.cityId().equals("utrecht"))
                .count();
        placeCounts.put("utrecht", actualUtrechtCount + 1);
        assertThatThrownBy(() -> provenanceValidator.validate(snapshot, mismatchedManifest))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("placeCounts does not match the snapshot for utrecht");
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
    void rejectsInvalidCoordinatesAndCrossCityRecords() {
        List<Place> invalidCoordinates = new ArrayList<>(snapshot.places());
        Place first = invalidCoordinates.getFirst();
        invalidCoordinates.set(0, copyPlace(
                first,
                first.id(),
                first.name(),
                first.category(),
                200.0,
                first.longitude(),
                first.sourceType(),
                first.sourceOsmId(),
                first.sourceTags()));
        assertThatThrownBy(() -> validator.validate(new CatalogSnapshot(snapshot.cities(), invalidCoordinates, snapshot.hubs())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("place coordinates are invalid");

        List<Place> crossCity = new ArrayList<>(snapshot.places());
        Place amsterdamPlace = crossCity.getFirst();
        crossCity.set(0, copyPlace(
                amsterdamPlace,
                amsterdamPlace.id(),
                amsterdamPlace.name(),
                amsterdamPlace.category(),
                amsterdamPlace.latitude(),
                amsterdamPlace.longitude(),
                amsterdamPlace.sourceType(),
                amsterdamPlace.sourceOsmId(),
                amsterdamPlace.sourceTags(),
                "rotterdam"));
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

    private CatalogSnapshot snapshotWithAdditionalPlace(Place place) {
        List<Place> places = new ArrayList<>(snapshot.places());
        places.add(place);
        places.sort(PLACE_ORDER);
        return new CatalogSnapshot(snapshot.cities(), places, snapshot.hubs());
    }

    private CatalogSnapshot snapshotWithReplacementAndAdditionalPlace(
            Place original,
            Place replacement,
            Place additional) {
        List<Place> places = new ArrayList<>(snapshot.places());
        places.set(places.indexOf(original), replacement);
        places.add(additional);
        places.sort(PLACE_ORDER);
        return new CatalogSnapshot(snapshot.cities(), places, snapshot.hubs());
    }

    private JsonNode readProvenanceManifest() throws IOException {
        try (InputStream inputStream = resourceLoader.getResource("classpath:catalog/provenance.json").getInputStream()) {
            return objectMapper.readTree(inputStream);
        }
    }

    private static Place copyPlace(
            Place place,
            String id,
            String name,
            PlaceCategory category,
            double latitude,
            double longitude,
            String sourceType,
            String sourceOsmId,
            Map<String, String> sourceTags) {
        return copyPlace(place, id, name, category, latitude, longitude, sourceType, sourceOsmId, sourceTags, place.cityId());
    }

    private static Place copyPlace(
            Place place,
            String id,
            String name,
            PlaceCategory category,
            double latitude,
            double longitude,
            String sourceType,
            String sourceOsmId,
            Map<String, String> sourceTags,
            String cityId) {
        return new Place(
                id,
                cityId,
                name,
                category,
                latitude,
                longitude,
                place.tags(),
                place.shortDescription(),
                place.imagePath(),
                place.imageAttributionId(),
                osmUrl(sourceType, sourceOsmId),
                sourceType,
                sourceOsmId,
                sourceTags);
    }

    private static MobilityHub copyHub(
            MobilityHub hub,
            String id,
            String name,
            String sourceType,
            String sourceOsmId,
            Map<String, String> sourceTags) {
        return new MobilityHub(
                id,
                hub.cityId(),
                name,
                hub.latitude(),
                hub.longitude(),
                hub.modes(),
                osmUrl(sourceType, sourceOsmId),
                sourceType,
                sourceOsmId,
                sourceTags);
    }

    private static Map<String, String> withTag(Map<String, String> tags, String key, String value) {
        Map<String, String> updatedTags = new HashMap<>(tags);
        updatedTags.put(key, value);
        return Map.copyOf(updatedTags);
    }

    private static double distanceMeters(Place first, Place second) {
        double firstLatitude = Math.toRadians(first.latitude());
        double secondLatitude = Math.toRadians(second.latitude());
        double latitudeDelta = secondLatitude - firstLatitude;
        double longitudeDelta = Math.toRadians(second.longitude() - first.longitude());
        double haversine = Math.pow(Math.sin(latitudeDelta / 2.0), 2.0)
                + Math.cos(firstLatitude) * Math.cos(secondLatitude)
                * Math.pow(Math.sin(longitudeDelta / 2.0), 2.0);
        return 2.0 * 6_371_000.0 * Math.asin(Math.sqrt(Math.min(1.0, haversine)));
    }

    private static String nextSourceId() {
        return Long.toString(TEST_SOURCE_IDS.getAndIncrement());
    }

    private static String sourceIdentity(String sourceType, String sourceOsmId) {
        return sourceType + "/" + sourceOsmId;
    }

    private static String osmUrl(String sourceType, String sourceOsmId) {
        return "https://www.openstreetmap.org/" + sourceType + "/" + sourceOsmId;
    }
}
