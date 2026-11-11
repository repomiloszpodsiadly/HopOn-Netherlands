package com.hopon.plans.api;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record PlanUpsertRequest(
        @NotNull String name,
        @NotNull String cityId,
        @NotNull List<@NotNull String> placeIds) {
}
