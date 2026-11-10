package com.hopon.discover;

import com.hopon.places.Place;
import com.hopon.places.PlaceCategory;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DiscoverServiceTest {

    private final DiscoverService discoverService = new DiscoverService();

    @Test
    void breaksEqualScoresByStablePlaceId() {
        List<Place> places = List.of(
                place("place-z", PlaceCategory.ARCHITECTURE, List.of("architecture")),
                place("place-a", PlaceCategory.ARCHITECTURE, List.of("architecture")));

        assertThat(discoverService.recommend(places, DiscoverTheme.ARCHITECTURE))
                .containsExactly("place-a", "place-z");
    }

    @Test
    void returnsAvailableMatchesWhenFewerThanThreeExist() {
        List<Place> places = List.of(
                place("park-b", PlaceCategory.PARKS_NATURE, List.of("parks_nature")),
                place("park-a", PlaceCategory.PARKS_NATURE, List.of("parks_nature")));

        assertThat(discoverService.recommend(places, DiscoverTheme.GREEN))
                .containsExactly("park-a", "park-b");
    }

    @Test
    void returnsNoIdsWhenThereAreNoThemeMatches() {
        assertThat(discoverService.recommend(
                List.of(place("museum", PlaceCategory.MUSEUMS, List.of("museums"))),
                DiscoverTheme.GREEN))
                .isEmpty();
    }

    private static Place place(String id, PlaceCategory category, List<String> tags) {
        return new Place(
                id,
                "amsterdam",
                id,
                category,
                52.37,
                4.89,
                tags,
                "A test catalog place.",
                null,
                null,
                "https://www.openstreetmap.org/node/1",
                "node",
                "1",
                Map.of("name", id));
    }
}
