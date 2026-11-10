package com.hopon.web;

import com.hopon.catalog.CatalogSnapshot;
import com.hopon.discover.DiscoverResponse;
import com.hopon.discover.DiscoverTheme;
import com.hopon.places.Place;
import com.hopon.places.PlaceCategory;
import com.hopon.places.PlaceDto;
import com.hopon.transit.MobilityHubDto;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CatalogApiIntegrationTest {

    private static final List<String> CITY_IDS = List.of("amsterdam", "rotterdam", "utrecht");
    private static final List<DiscoverTheme> THEMES = List.of(
            DiscoverTheme.ARCHITECTURE,
            DiscoverTheme.CULTURE,
            DiscoverTheme.GREEN);

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private CatalogSnapshot snapshot;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void returnsThreeCitiesInCanonicalOrderWithoutProvenanceFields() throws Exception {
        mockMvc.perform(get("/api/cities"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$[0].id").value("amsterdam"))
                .andExpect(jsonPath("$[1].id").value("rotterdam"))
                .andExpect(jsonPath("$[2].id").value("utrecht"))
                .andExpect(jsonPath("$[0].center.latitude").value(52.3730796))
                .andExpect(jsonPath("$[0].sourceUrl").doesNotExist());
    }

    @Test
    void filtersPlacesByCityQueryAndCategoryTogether() throws Exception {
        Place target = snapshot.places().stream()
                .filter(place -> place.cityId().equals("amsterdam"))
                .filter(place -> place.category() == PlaceCategory.MUSEUMS)
                .filter(place -> place.name().length() <= 100)
                .findFirst()
                .orElseThrow();
        String query = target.name().toUpperCase(Locale.ROOT);

        MvcResult result = mockMvc.perform(get("/api/places")
                        .param("cityId", "amsterdam")
                        .param("q", "  " + query + "  ")
                        .param("category", "MUSEUMS"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andReturn();

        PlaceDto[] places = objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlaceDto[].class);
        assertThat(places).extracting(PlaceDto::id).contains(target.id());
        assertThat(places).allSatisfy(place -> {
            assertThat(place.cityId()).isEqualTo("amsterdam");
            assertThat(place.category()).isEqualTo(PlaceCategory.MUSEUMS);
        });
        assertThat(places[0].imagePath()).isNull();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("sourceTags", "sourceOsmId", "sourceUrl");

        mockMvc.perform(get("/api/places")
                        .param("cityId", "amsterdam")
                        .param("q", query)
                        .param("category", "CULTURE"))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
    }

    @Test
    void blankQueryActsAsNoTextFilterAndPlaceDetailsUseRealCatalogRecords() throws Exception {
        Place target = snapshot.places().stream()
                .filter(place -> place.cityId().equals("utrecht"))
                .findFirst()
                .orElseThrow();

        MvcResult result = mockMvc.perform(get("/api/places")
                        .param("cityId", "utrecht")
                        .param("q", "   "))
                .andExpect(status().isOk())
                .andReturn();
        PlaceDto[] places = objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlaceDto[].class);
        int expectedUtrechtCount = (int) snapshot.places().stream()
                .filter(place -> place.cityId().equals("utrecht"))
                .count();
        assertThat(places).hasSize(expectedUtrechtCount)
                .allSatisfy(place -> assertThat(place.cityId()).isEqualTo("utrecht"));

        mockMvc.perform(get("/api/places/{id}", target.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(target.id()))
                .andExpect(jsonPath("$.cityId").value("utrecht"))
                .andExpect(jsonPath("$.category").value(target.category().name()));
    }

    @Test
    void returnsEveryPlaceForLargeCityCatalogWithoutClippingResults() throws Exception {
        List<String> expectedIds = snapshot.places().stream()
                .filter(place -> place.cityId().equals("amsterdam"))
                .map(Place::id)
                .toList();

        MvcResult result = mockMvc.perform(get("/api/places").param("cityId", "amsterdam"))
                .andExpect(status().isOk())
                .andReturn();
        PlaceDto[] places = objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlaceDto[].class);

        assertThat(expectedIds).hasSizeGreaterThanOrEqualTo(25);
        assertThat(places).hasSize(expectedIds.size());
        assertThat(places).extracting(PlaceDto::id).containsExactlyInAnyOrderElementsOf(expectedIds);
    }

    @Test
    void returnsOnlyTheSelectedCityMobilityHubs() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/stops").param("cityId", "rotterdam"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andReturn();

        MobilityHubDto[] hubs = objectMapper.readValue(result.getResponse().getContentAsByteArray(), MobilityHubDto[].class);
        int expectedRotterdamHubCount = (int) snapshot.hubs().stream()
                .filter(hub -> hub.cityId().equals("rotterdam"))
                .count();
        assertThat(hubs).hasSize(expectedRotterdamHubCount)
                .allSatisfy(hub -> assertThat(hub.cityId()).isEqualTo("rotterdam"));
        assertThat(result.getResponse().getContentAsString()).doesNotContain("sourceTags", "sourceOsmId");
    }

    @Test
    void returnsStableDiscoverResultsForEveryCityAndTheme() throws Exception {
        for (String cityId : CITY_IDS) {
            for (DiscoverTheme theme : THEMES) {
                DiscoverResponse first = getDiscover(cityId, theme);
                DiscoverResponse second = getDiscover(cityId, theme);
                assertThat(first).isEqualTo(second);
                assertThat(first.cityId()).isEqualTo(cityId);
                assertThat(first.theme()).isEqualTo(theme.parameterValue());
                assertThat(first.description()).isNotBlank();
                assertThat(first.placeIds()).hasSizeBetween(3, 5).doesNotHaveDuplicates();
                assertThat(first.placeIds()).allSatisfy(id -> assertThat(snapshot.places())
                        .anyMatch(place -> place.id().equals(id) && place.cityId().equals(cityId)));
            }
        }
    }

    @Test
    void returnsSafeProblemDetailsForInvalidAndMissingQueries() throws Exception {
        expectBadRequest(get("/api/places"));
        expectBadRequest(get("/api/places").param("cityId", "unknown-city"));
        expectBadRequest(get("/api/places").param("cityId", "amsterdam").param("category", "museums"));
        expectBadRequest(get("/api/places").param("cityId", "amsterdam").param("q", "x".repeat(101)));
        expectBadRequest(get("/api/places").param("cityId", "amsterdam").param("q", "bad\u0000query"));
        expectBadRequest(get("/api/stops"));
        expectBadRequest(get("/api/discover").param("cityId", "amsterdam"));
        expectBadRequest(get("/api/discover").param("cityId", "amsterdam").param("theme", "random"));
    }

    @Test
    void returnsProblemDetailWhenPlaceDoesNotExist() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/places/{id}", "unknown-place-id"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.detail").value("Place was not found."))
                .andReturn();
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain("stackTrace", "Exception", "org.springframework", "SQL");
    }

    private DiscoverResponse getDiscover(String cityId, DiscoverTheme theme) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/discover")
                        .param("cityId", cityId)
                        .param("theme", theme.parameterValue()))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsByteArray(), DiscoverResponse.class);
    }

    private void expectBadRequest(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        MvcResult result = mockMvc.perform(request)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.detail").isNotEmpty())
                .andReturn();
        assertThat(result.getResponse().getContentAsString())
                .doesNotContain("stackTrace", "Exception", "org.springframework", "SQL");
    }
}
