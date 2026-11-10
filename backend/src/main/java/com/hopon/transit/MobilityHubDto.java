package com.hopon.transit;

import java.util.List;

public record MobilityHubDto(
        String id,
        String cityId,
        String name,
        double latitude,
        double longitude,
        List<HubMode> modes,
        String source) {

    public MobilityHubDto {
        modes = List.copyOf(modes);
    }
}
