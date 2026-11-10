package com.hopon.transit;

import com.hopon.catalog.CatalogQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/stops")
public class StopsController {

    private final CatalogQueryService catalogQueryService;

    public StopsController(CatalogQueryService catalogQueryService) {
        this.catalogQueryService = catalogQueryService;
    }

    @GetMapping
    public List<MobilityHubDto> getStops(@RequestParam(name = "cityId", required = false) String cityId) {
        return catalogQueryService.getHubs(cityId);
    }
}
