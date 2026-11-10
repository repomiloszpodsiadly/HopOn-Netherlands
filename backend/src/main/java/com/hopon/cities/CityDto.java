package com.hopon.cities;

import com.hopon.catalog.Coordinates;

public record CityDto(String id, String name, Coordinates center, double defaultZoom) {
}
