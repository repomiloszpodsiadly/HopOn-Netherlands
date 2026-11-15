package com.hopon.plans.application;

import java.util.List;

public record PlanCommand(String name, String description, String cityId, List<String> placeIds) {
}
