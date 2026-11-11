package com.hopon.catalog;

import com.hopon.cities.City;
import com.hopon.places.Place;
import com.hopon.transit.MobilityHub;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

@Component
public final class CatalogSnapshotLoader {

    private final CatalogSnapshot snapshot;

    public CatalogSnapshotLoader(
            ObjectMapper objectMapper,
            ResourceLoader resourceLoader,
            CatalogSnapshotValidator validator,
            CatalogProvenanceValidator provenanceValidator,
            @Value("${hopon.catalog.cities:classpath:catalog/cities.json}") String citiesLocation,
            @Value("${hopon.catalog.places:classpath:catalog/places.json}") String placesLocation,
            @Value("${hopon.catalog.stops:classpath:catalog/stops.json}") String stopsLocation,
            @Value("${hopon.catalog.provenance:classpath:catalog/provenance.json}") String provenanceLocation) {
        List<City> cities = readRecords(objectMapper, resourceLoader, citiesLocation, City.class);
        List<Place> places = readRecords(objectMapper, resourceLoader, placesLocation, Place.class);
        List<MobilityHub> hubs = readRecords(objectMapper, resourceLoader, stopsLocation, MobilityHub.class);

        CatalogSnapshot loadedSnapshot = new CatalogSnapshot(cities, places, hubs);
        validator.validate(loadedSnapshot);
        JsonNode provenance = readManifest(objectMapper, resourceLoader, provenanceLocation);
        provenanceValidator.validate(loadedSnapshot, provenance);
        this.snapshot = loadedSnapshot;
    }

    public CatalogSnapshot snapshot() {
        return snapshot;
    }

    private static <T> List<T> readRecords(
            ObjectMapper objectMapper,
            ResourceLoader resourceLoader,
            String location,
            Class<T> recordType) {
        if (!location.startsWith("classpath:")) {
            throw new IllegalArgumentException("Catalog resources must be loaded from the classpath: " + location);
        }
        Resource resource = resourceLoader.getResource(location);
        if (!resource.exists()) {
            throw new IllegalStateException("Catalog resource does not exist: " + location);
        }

        try (InputStream inputStream = resource.getInputStream()) {
            return objectMapper.readValue(
                    inputStream,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, recordType));
        } catch (IOException exception) {
            throw new IllegalStateException("Could not read catalog resource: " + location, exception);
        }
    }

    private static JsonNode readManifest(
            ObjectMapper objectMapper,
            ResourceLoader resourceLoader,
            String location) {
        if (!location.startsWith("classpath:")) {
            throw new IllegalArgumentException("Catalog provenance must be loaded from the classpath: " + location);
        }
        Resource resource = resourceLoader.getResource(location);
        if (!resource.exists()) {
            throw new IllegalStateException("Catalog provenance resource does not exist: " + location);
        }

        try (InputStream inputStream = resource.getInputStream()) {
            return objectMapper.readTree(inputStream);
        } catch (IOException exception) {
            throw new IllegalStateException("Could not read catalog provenance resource: " + location, exception);
        }
    }
}
