package com.hopon.places;

import java.util.List;
import java.util.Map;

public record Place(
        String id,
        String cityId,
        String name,
        PlaceCategory category,
        double latitude,
        double longitude,
        List<String> tags,
        String shortDescription,
        String imagePath,
        String imageAttributionId,
        String sourceUrl,
        String sourceType,
        String sourceOsmId,
        Map<String, String> sourceTags) {

    public Place {
        tags = List.copyOf(tags);
        sourceTags = Map.copyOf(sourceTags);
    }
}
