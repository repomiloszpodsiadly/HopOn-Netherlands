package com.hopon.plans.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record PlanResult(
        UUID id,
        String name,
        String description,
        String cityId,
        List<String> placeIds,
        Instant createdAt,
        Instant updatedAt) {

    public PlanResult {
        placeIds = List.copyOf(placeIds);
    }
}
