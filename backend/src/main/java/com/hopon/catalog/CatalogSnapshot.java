package com.hopon.catalog;

import com.hopon.cities.City;
import com.hopon.places.Place;
import com.hopon.transit.MobilityHub;

import java.util.List;

public record CatalogSnapshot(List<City> cities, List<Place> places, List<MobilityHub> hubs) {

    public CatalogSnapshot {
        cities = List.copyOf(cities);
        places = List.copyOf(places);
        hubs = List.copyOf(hubs);
    }
}
