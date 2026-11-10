package com.hopon.web;

public class PlaceNotFoundException extends RuntimeException {

    public PlaceNotFoundException() {
        super("Place was not found.");
    }
}
