package com.hopon.plans.api;

public final class InvalidPlanRequestException extends RuntimeException {

    public InvalidPlanRequestException(String message) {
        super(message);
    }
}
