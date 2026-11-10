package com.hopon.discover;

import com.hopon.catalog.CatalogQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/discover")
public class DiscoverController {

    private final CatalogQueryService catalogQueryService;
    private final DiscoverService discoverService;

    public DiscoverController(CatalogQueryService catalogQueryService, DiscoverService discoverService) {
        this.catalogQueryService = catalogQueryService;
        this.discoverService = discoverService;
    }

    @GetMapping
    public DiscoverResponse discover(
            @RequestParam(name = "cityId", required = false) String cityId,
            @RequestParam(name = "theme", required = false) String themeValue) {
        DiscoverTheme theme = DiscoverTheme.fromParameter(themeValue);
        return new DiscoverResponse(
                cityId,
                theme.parameterValue(),
                theme.description(),
                discoverService.recommend(catalogQueryService.placesForCity(cityId), theme));
    }
}
