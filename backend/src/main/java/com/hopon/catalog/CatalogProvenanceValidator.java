package com.hopon.catalog;

import com.hopon.places.Place;
import com.hopon.transit.MobilityHub;
import tools.jackson.databind.JsonNode;

import java.util.HashMap;
import java.util.Map;

public final class CatalogProvenanceValidator {

    private static final String EXPECTED_ATTRIBUTION = "\u00A9 OpenStreetMap contributors";
    private static final String EXPECTED_LICENSE_URL = "https://www.openstreetmap.org/copyright";

    public void validate(CatalogSnapshot snapshot, JsonNode manifest) {
        if (manifest == null || !manifest.isObject()) {
            throw new IllegalStateException("Catalog provenance manifest must be a JSON object");
        }
        validateCounts("placeCounts", manifest.get("placeCounts"), countPlaces(snapshot));
        validateCounts("curatedHubCounts", manifest.get("curatedHubCounts"), countHubs(snapshot));

        if (!EXPECTED_ATTRIBUTION.equals(manifest.path("attribution").asString())) {
            throw new IllegalStateException("Catalog provenance must contain the UTF-8 OpenStreetMap attribution");
        }
        String license = manifest.path("license").asString();
        if (license == null || !license.contains("Open Database License") || !license.contains("ODbL")
                || !EXPECTED_LICENSE_URL.equals(manifest.path("licenseUrl").asString())) {
            throw new IllegalStateException("Catalog provenance must retain OpenStreetMap ODbL 1.0 attribution");
        }
    }

    private static Map<String, Integer> countPlaces(CatalogSnapshot snapshot) {
        Map<String, Integer> counts = new HashMap<>();
        for (Place place : snapshot.places()) {
            counts.merge(place.cityId(), 1, Integer::sum);
        }
        return counts;
    }

    private static Map<String, Integer> countHubs(CatalogSnapshot snapshot) {
        Map<String, Integer> counts = new HashMap<>();
        for (MobilityHub hub : snapshot.hubs()) {
            counts.merge(hub.cityId(), 1, Integer::sum);
        }
        return counts;
    }

    private static void validateCounts(String field, JsonNode declared, Map<String, Integer> actual) {
        if (declared == null || !declared.isObject() || declared.size() != actual.size()) {
            throw new IllegalStateException("Catalog provenance " + field + " must list every supported city exactly once");
        }
        for (Map.Entry<String, Integer> entry : actual.entrySet()) {
            JsonNode declaredCount = declared.get(entry.getKey());
            if (declaredCount == null || !declaredCount.isIntegralNumber()
                    || declaredCount.intValue() != entry.getValue()) {
                throw new IllegalStateException("Catalog provenance " + field + " does not match the snapshot for "
                        + entry.getKey());
            }
        }
    }
}
