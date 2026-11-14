package com.hopon.plans.api;

public class PlanLimitReachedException extends RuntimeException {
    public PlanLimitReachedException() {
        super("You have 6 of 6 saved plans. Use an existing plan or delete one before creating another. Existing plans can still be updated with up to 12 places.");
    }
}
