package com.hopon.discover;

import com.hopon.web.InvalidCatalogRequestException;

public enum DiscoverTheme {
    ARCHITECTURE(
            "architecture",
            "Architecture highlights selected from the verified catalog"),
    CULTURE(
            "culture",
            "Cultural highlights selected from the verified catalog"),
    GREEN(
            "green",
            "Green spaces and nature highlights selected from the verified catalog");

    private final String parameterValue;
    private final String description;

    DiscoverTheme(String parameterValue, String description) {
        this.parameterValue = parameterValue;
        this.description = description;
    }

    public String parameterValue() {
        return parameterValue;
    }

    public String description() {
        return description;
    }

    public static DiscoverTheme fromParameter(String value) {
        for (DiscoverTheme theme : values()) {
            if (theme.parameterValue.equals(value)) {
                return theme;
            }
        }
        throw new InvalidCatalogRequestException("theme must be architecture, culture, or green.");
    }
}
