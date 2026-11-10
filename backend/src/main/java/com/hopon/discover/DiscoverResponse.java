package com.hopon.discover;

import java.util.List;

public record DiscoverResponse(String cityId, String theme, String description, List<String> placeIds) {

    public DiscoverResponse {
        placeIds = List.copyOf(placeIds);
    }
}
