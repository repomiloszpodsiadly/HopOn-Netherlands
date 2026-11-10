package com.hopon.transit;

import java.util.List;
import java.util.Map;

public record MobilityHub(
        String id,
        String cityId,
        String name,
        double latitude,
        double longitude,
        List<HubMode> modes,
        String source,
        String sourceType,
        String sourceOsmId,
        Map<String, String> sourceTags) {

    public MobilityHub {
        modes = List.copyOf(modes);
        sourceTags = Map.copyOf(sourceTags);
    }
}
