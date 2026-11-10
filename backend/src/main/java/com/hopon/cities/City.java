package com.hopon.cities;

import com.hopon.catalog.Coordinates;

import java.util.Map;

public record City(
        String id,
        String name,
        Coordinates center,
        double defaultZoom,
        String sourceUrl,
        Map<String, String> sourceTags) {

    public City {
        sourceTags = Map.copyOf(sourceTags);
    }
}
