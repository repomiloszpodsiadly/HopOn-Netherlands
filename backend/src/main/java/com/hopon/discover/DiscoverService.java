package com.hopon.discover;

import com.hopon.places.Place;
import com.hopon.places.PlaceCategory;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;

@Service
public class DiscoverService {

    public static final String SCORING_VERSION = "v1";
    private static final int MAX_RESULTS = 5;
    private static final Comparator<ScoredPlace> RECOMMENDATION_ORDER = Comparator
            .comparingInt(ScoredPlace::score)
            .reversed()
            .thenComparing(scoredPlace -> scoredPlace.place().id());

    public List<String> recommend(List<Place> places, DiscoverTheme theme) {
        return places.stream()
                .map(place -> new ScoredPlace(place, score(place, theme)))
                .filter(scoredPlace -> scoredPlace.score() > 0)
                .sorted(RECOMMENDATION_ORDER)
                .map(scoredPlace -> scoredPlace.place().id())
                .distinct()
                .limit(MAX_RESULTS)
                .toList();
    }

    private static int score(Place place, DiscoverTheme theme) {
        int score = 0;
        switch (theme) {
            case ARCHITECTURE -> {
                if (place.category() == PlaceCategory.ARCHITECTURE) {
                    score += 100;
                }
                if (place.tags().contains("architecture")) {
                    score += 40;
                }
                if (hasTagPrefix(place, "building=")
                        || hasAnyTag(place, "historic=castle", "historic=church", "historic=monastery")) {
                    score += 20;
                }
            }
            case CULTURE -> {
                if (place.category() == PlaceCategory.CULTURE) {
                    score += 100;
                }
                if (hasAnyTag(place, "tourism=gallery", "tourism=artwork")) {
                    score += 35;
                }
                if (hasAnyTag(place, "amenity=theatre", "amenity=arts_centre")) {
                    score += 35;
                }
            }
            case GREEN -> {
                if (place.category() == PlaceCategory.PARKS_NATURE) {
                    score += 100;
                }
                if (hasAnyTag(place, "leisure=park", "leisure=garden", "leisure=nature_reserve")) {
                    score += 35;
                }
                if (hasAnyTag(place, "tourism=zoo", "tourism=aquarium", "tourism=theme_park")) {
                    score += 20;
                }
            }
        }
        return score;
    }

    private static boolean hasAnyTag(Place place, String... tags) {
        for (String tag : tags) {
            if (place.tags().contains(tag)) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasTagPrefix(Place place, String prefix) {
        return place.tags().stream().anyMatch(tag -> tag.startsWith(prefix));
    }

    private record ScoredPlace(Place place, int score) {
    }
}
