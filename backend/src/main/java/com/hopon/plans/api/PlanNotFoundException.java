package com.hopon.plans.api;

public final class PlanNotFoundException extends RuntimeException {

    public PlanNotFoundException() {
        super("Plan was not found.");
    }
}
