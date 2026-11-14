package com.hopon.plans.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record PlanResponse(
        UUID id,
        String name,
        String description,
        String cityId,
        List<String> placeIds,
        Instant createdAt,
        Instant updatedAt) {

    public PlanResponse {
        placeIds = List.copyOf(placeIds);
    }
}
