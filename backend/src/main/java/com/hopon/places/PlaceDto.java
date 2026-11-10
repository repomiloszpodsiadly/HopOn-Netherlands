package com.hopon.places;

import java.util.List;

public record PlaceDto(
        String id,
        String cityId,
        String name,
        PlaceCategory category,
        double latitude,
        double longitude,
        List<String> tags,
        String shortDescription,
        String imagePath,
        String imageAttributionId) {

    public PlaceDto {
        tags = List.copyOf(tags);
    }
}
