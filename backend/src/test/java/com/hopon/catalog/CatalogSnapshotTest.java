package com.hopon.catalog;

import com.hopon.HopOnApplication;
import com.hopon.cities.City;
import com.hopon.cities.CityDto;
import com.hopon.places.Place;
import com.hopon.places.PlaceDto;
import com.hopon.transit.MobilityHub;
import com.hopon.transit.MobilityHubDto;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.exc.MismatchedInputException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
class CatalogSnapshotTest {

    private static final String CITIES = "classpath:changed/cities.json";
    private static final String PLACES = "classpath:changed/places.json";
    private static final String HUBS = "classpath:changed/stops.json";

    @Autowired
    private CatalogSnapshot snapshot;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void loadsAddedCityPlaceAndHubAndMakesThemAvailableToQueries() throws Exception {
        City addedCity = new City("new-city", "New city", new Coordinates(50.0, 3.0), 12.0,
                "https://www.openstreetmap.org/node/1", Map.of("name", "New city"));
        Place original = snapshot.places().getFirst();
        Place addedPlace = new Place("new-place", addedCity.id(), "New place", original.category(),
                50.0, 3.0, original.tags(), original.shortDescription(), null, null,
                original.sourceUrl(), original.sourceType(), original.sourceOsmId(), original.sourceTags());
        MobilityHub originalHub = snapshot.hubs().getFirst();
        MobilityHub addedHub = new MobilityHub("new-hub", addedCity.id(), "New hub", 50.0, 3.0,
                originalHub.modes(), originalHub.source(), originalHub.sourceType(),
                originalHub.sourceOsmId(), originalHub.sourceTags());

        List<City> cities = new ArrayList<>(snapshot.cities());
        cities.addFirst(addedCity);
        List<Place> places = new ArrayList<>(snapshot.places());
        places.addFirst(addedPlace);
        List<MobilityHub> hubs = new ArrayList<>(snapshot.hubs());
        hubs.addFirst(addedHub);

        CatalogSnapshot loaded = loadCatalog(cities, places, hubs);
        assertThat(loaded).isEqualTo(new CatalogSnapshot(cities, places, hubs));
        CatalogQueryService queries = new CatalogQueryService(loaded);
        assertThat(queries.getCities()).extracting(CityDto::id).contains(addedCity.id());
        assertThat(queries.getPlaces(addedCity.id(), null, null)).extracting(PlaceDto::id)
                .containsExactly(addedPlace.id());
        assertThat(queries.getHubs(addedCity.id())).extracting(MobilityHubDto::id)
                .containsExactly(addedHub.id());
    }

    @Test
    void loadsRemovedCitiesPlacesAndHubsWithoutRequiringMatchingMetadata() throws Exception {
        List<City> cities = snapshot.cities().subList(1, snapshot.cities().size());
        List<Place> places = snapshot.places().subList(1, snapshot.places().size());
        List<MobilityHub> hubs = snapshot.hubs().subList(1, snapshot.hubs().size());

        CatalogSnapshot loaded = loadCatalog(cities, places, hubs);
        assertThat(loaded).isEqualTo(new CatalogSnapshot(cities, places, hubs));
        assertThat(new CatalogQueryService(loaded).getCities()).extracting(CityDto::id)
                .doesNotContain(snapshot.cities().getFirst().id());
    }

    @Test
    void applicationStartsWithEmptyCatalogs() {
        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(HopOnApplication.class)
                .web(WebApplicationType.NONE)
                .properties(
                        "hopon.catalog.cities=classpath:catalog/empty/records.json",
                        "hopon.catalog.places=classpath:catalog/empty/records.json",
                        "hopon.catalog.stops=classpath:catalog/empty/records.json")
                .run()) {
            CatalogSnapshot loaded = context.getBean(CatalogSnapshot.class);
            assertThat(loaded.cities()).isEmpty();
            assertThat(loaded.places()).isEmpty();
            assertThat(loaded.hubs()).isEmpty();
        }
    }

    @Test
    void applicationReportsUnreadableCatalogFormat() {
        assertThatThrownBy(() -> new SpringApplicationBuilder(HopOnApplication.class)
                .web(WebApplicationType.NONE)
                .properties("hopon.catalog.places=classpath:catalog/invalid/places-malformed.json")
                .run())
                .isInstanceOf(RuntimeException.class)
                .hasRootCauseInstanceOf(MismatchedInputException.class);
    }

    private CatalogSnapshot loadCatalog(List<City> cities, List<Place> places, List<MobilityHub> hubs)
            throws Exception {
        Map<String, Resource> resources = Map.of(
                CITIES, new ByteArrayResource(objectMapper.writeValueAsBytes(cities)),
                PLACES, new ByteArrayResource(objectMapper.writeValueAsBytes(places)),
                HUBS, new ByteArrayResource(objectMapper.writeValueAsBytes(hubs)));
        DefaultResourceLoader resourceLoader = new DefaultResourceLoader() {
            @Override
            public Resource getResource(String location) {
                return resources.get(location);
            }
        };
        return new CatalogSnapshotLoader(objectMapper, resourceLoader, CITIES, PLACES, HUBS).snapshot();
    }
}
