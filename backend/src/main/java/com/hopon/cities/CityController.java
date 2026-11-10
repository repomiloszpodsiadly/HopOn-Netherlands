package com.hopon.cities;

import com.hopon.catalog.CatalogQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/cities")
public class CityController {

    private final CatalogQueryService catalogQueryService;

    public CityController(CatalogQueryService catalogQueryService) {
        this.catalogQueryService = catalogQueryService;
    }

    @GetMapping
    public List<CityDto> getCities() {
        return catalogQueryService.getCities();
    }
}
