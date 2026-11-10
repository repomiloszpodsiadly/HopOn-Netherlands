package com.hopon.places;

import com.hopon.catalog.CatalogQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/places")
public class PlaceController {

    private final CatalogQueryService catalogQueryService;

    public PlaceController(CatalogQueryService catalogQueryService) {
        this.catalogQueryService = catalogQueryService;
    }

    @GetMapping
    public List<PlaceDto> getPlaces(
            @RequestParam(name = "cityId", required = false) String cityId,
            @RequestParam(name = "q", required = false) String query,
            @RequestParam(name = "category", required = false) String category) {
        return catalogQueryService.getPlaces(cityId, query, category);
    }

    @GetMapping("/{id}")
    public PlaceDto getPlace(@PathVariable("id") String id) {
        return catalogQueryService.getPlace(id);
    }
}
