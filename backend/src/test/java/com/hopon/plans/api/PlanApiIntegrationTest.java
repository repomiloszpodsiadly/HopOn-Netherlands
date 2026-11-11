package com.hopon.plans.api;

import com.hopon.catalog.CatalogSnapshot;
import com.hopon.places.Place;
import com.hopon.plans.persistence.PlanEntity;
import com.hopon.plans.persistence.PlanRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class PlanApiIntegrationTest {

    private static final String API_PATH = "/api/plans";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private CatalogSnapshot catalogSnapshot;

    @Autowired
    private PlanRepository planRepository;

    @Autowired
    private EntityManager entityManager;

    private TransactionTemplate transactionTemplate;

    @Autowired
    void setTransactionManager(PlatformTransactionManager transactionManager) {
        transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @BeforeEach
    void clearSavedPlans() {
        planRepository.deleteAll();
    }

    @Test
    void createsPlanAndReadsExactPersistedOrderAfterClearingPersistenceContext() throws Exception {
        List<String> placeIds = placeIds("amsterdam", 3);
        MvcResult createResult = mockMvc.perform(post(API_PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("  Amsterdam afternoon  ", "amsterdam", placeIds)))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andReturn();

        PlanResponse created = objectMapper.readValue(createResult.getResponse().getContentAsByteArray(), PlanResponse.class);
        assertThat(created.id()).isNotNull();
        assertThat(createResult.getResponse().getHeader("Location")).isEqualTo(API_PATH + "/" + created.id());
        assertThat(created.name()).isEqualTo("Amsterdam afternoon");
        assertThat(created.cityId()).isEqualTo("amsterdam");
        assertThat(created.placeIds()).containsExactlyElementsOf(placeIds);
        assertThat(created.createdAt()).isEqualTo(created.updatedAt());

        transactionTemplate.executeWithoutResult(status -> {
            entityManager.flush();
            entityManager.clear();
        });

        mockMvc.perform(get(API_PATH + "/{id}", created.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(created.id().toString()))
                .andExpect(jsonPath("$.placeIds").isArray())
                .andExpect(jsonPath("$.placeIds[0]").value(placeIds.get(0)))
                .andExpect(jsonPath("$.placeIds[1]").value(placeIds.get(1)))
                .andExpect(jsonPath("$.placeIds[2]").value(placeIds.get(2)));
    }

    @Test
    void allowsThePlaywrightAngularOriginToCreatePlans() throws Exception {
        String browserOrigin = "http://127.0.0.1:4300";
        mockMvc.perform(post(API_PATH)
                        .header("Origin", browserOrigin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json("Playwright origin", "amsterdam", placeIds("amsterdam", 1))))
                .andExpect(status().isCreated())
                .andExpect(header().string("Access-Control-Allow-Origin", browserOrigin));
    }

    @Test
    void returnsListSortedByUpdatedAtDescendingThenUuidStringAscending() throws Exception {
        mockMvc.perform(get(API_PATH))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));

        List<String> ids = placeIds("utrecht", 1);
        Instant older = Instant.parse("2026-11-10T10:59:00Z");
        Instant sameUpdatedAt = Instant.parse("2026-11-10T11:00:00Z");
        UUID firstTieId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID secondTieId = UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID olderId = UUID.fromString("00000000-0000-0000-0000-000000000003");

        planRepository.saveAllAndFlush(List.of(
                plan(firstTieId, "First tie", ids, sameUpdatedAt),
                plan(secondTieId, "Second tie", ids, sameUpdatedAt),
                plan(olderId, "Older", ids, older)));

        MvcResult result = mockMvc.perform(get(API_PATH))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andReturn();
        PlanResponse[] plans = objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlanResponse[].class);

        assertThat(plans).extracting(PlanResponse::id).containsExactly(firstTieId, secondTieId, olderId);
    }

    @Test
    void replacesPlanOrderPreservesCreationTimeAndKeepsTimestampForNormalizedNoOpPut() throws Exception {
        List<String> originalIds = placeIds("rotterdam", 2);
        PlanResponse created = createPlan("Rotterdam walk", "rotterdam", originalIds);

        PlanResponse noOp = updatePlan(created.id(), "  Rotterdam walk  ", "rotterdam", originalIds);
        assertThat(noOp.name()).isEqualTo("Rotterdam walk");
        assertThat(noOp.createdAt()).isEqualTo(created.createdAt());
        assertThat(noOp.updatedAt()).isEqualTo(created.updatedAt());

        List<String> reorderedIds = List.of(originalIds.get(1), originalIds.get(0));
        PlanResponse updated = updatePlan(created.id(), "Rotterdam in a new order", "rotterdam", reorderedIds);
        assertThat(updated.id()).isEqualTo(created.id());
        assertThat(updated.createdAt()).isEqualTo(created.createdAt());
        assertThat(updated.updatedAt()).isAfter(created.updatedAt());
        assertThat(updated.placeIds()).containsExactlyElementsOf(reorderedIds);

        mockMvc.perform(get(API_PATH + "/{id}", created.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Rotterdam in a new order"))
                .andExpect(jsonPath("$.placeIds[0]").value(reorderedIds.get(0)))
                .andExpect(jsonPath("$.placeIds[1]").value(reorderedIds.get(1)));
    }

    @Test
    void deletesOnlyExistingPlansAndReturnsAnEmptyNoContentResponse() throws Exception {
        PlanResponse created = createPlan("Delete me", "amsterdam", placeIds("amsterdam", 1));

        MvcResult deleteResult = mockMvc.perform(delete(API_PATH + "/{id}", created.id()))
                .andExpect(status().isNoContent())
                .andReturn();
        assertThat(deleteResult.getResponse().getContentAsByteArray()).isEmpty();

        expectProblem(delete(API_PATH + "/{id}", created.id()), 404);
        expectProblem(get(API_PATH + "/{id}", created.id()), 404);
    }

    @Test
    void returnsBadRequestForMalformedUuidOnEveryItemRoute() throws Exception {
        String malformedId = "not-a-uuid";
        String validBody = json("Plan", "amsterdam", placeIds("amsterdam", 1));

        expectProblem(get(API_PATH + "/{id}", malformedId), 400);
        expectProblem(put(API_PATH + "/{id}", malformedId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(validBody), 400);
        expectProblem(delete(API_PATH + "/{id}", malformedId), 400);
    }

    @Test
    void returnsNotFoundForWellFormedMissingUuidOnEveryItemRoute() throws Exception {
        UUID missingId = UUID.fromString("00000000-0000-0000-0000-000000000099");
        String validBody = json("Plan", "amsterdam", placeIds("amsterdam", 1));

        expectProblem(get(API_PATH + "/{id}", missingId), 404);
        expectProblem(put(API_PATH + "/{id}", missingId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(validBody), 404);
        expectProblem(delete(API_PATH + "/{id}", missingId), 404);
    }

    @Test
    void acceptsOneAndTwelvePlacesButRejectsZeroAndThirteen() throws Exception {
        List<String> cityPlaceIds = placeIds("amsterdam", 13);

        assertThat(createPlan("One place", "amsterdam", cityPlaceIds.subList(0, 1)).placeIds()).hasSize(1);
        assertThat(createPlan("Twelve places", "amsterdam", cityPlaceIds.subList(0, 12)).placeIds()).hasSize(12);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content(json("No places", "amsterdam", List.of())), 400);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content(json("Too many places", "amsterdam", cityPlaceIds)), 400);
    }

    @Test
    void validatesNameCityAndCatalogIdentityWithoutDeduplicatingOrMixingCities() throws Exception {
        List<String> amsterdamIds = placeIds("amsterdam", 2);
        String rotterdamId = placeIds("rotterdam", 1).getFirst();

        expectInvalid("   ", "amsterdam", amsterdamIds);
        expectInvalid("x".repeat(81), "amsterdam", amsterdamIds);
        expectInvalid("A plan", "unknown-city", amsterdamIds);
        expectInvalid("A plan", "amsterdam", List.of("   "));
        expectInvalid("A plan", "amsterdam", List.of(amsterdamIds.getFirst(), amsterdamIds.getFirst()));
        expectInvalid("A plan", "amsterdam", List.of("unknown-catalog-place"));
        expectInvalid("A plan", "amsterdam", List.of(rotterdamId));

        assertThat(createPlan("x".repeat(80), "amsterdam", amsterdamIds.subList(0, 1)).name())
                .hasSize(80);
    }

    @Test
    void invalidPutLeavesPersistedPlanFieldsOrderAndTimestampsUntouched() throws Exception {
        List<String> originalIds = placeIds("amsterdam", 2);
        PlanResponse created = createPlan("Stable plan", "amsterdam", originalIds);
        String invalidReplacement = json("Changed name", "amsterdam", List.of(originalIds.getFirst(), originalIds.getFirst()));

        expectProblem(put(API_PATH + "/{id}", created.id())
                .contentType(MediaType.APPLICATION_JSON)
                .content(invalidReplacement), 400);

        MvcResult result = mockMvc.perform(get(API_PATH + "/{id}", created.id()))
                .andExpect(status().isOk())
                .andReturn();
        PlanResponse persisted = objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlanResponse.class);
        assertThat(persisted.id()).isEqualTo(created.id());
        assertThat(persisted.name()).isEqualTo(created.name());
        assertThat(persisted.cityId()).isEqualTo(created.cityId());
        assertThat(persisted.placeIds()).containsExactlyElementsOf(originalIds);
        assertThat(persisted.createdAt()).isEqualTo(created.createdAt());
        assertThat(persisted.updatedAt()).isEqualTo(created.updatedAt());
    }

    @Test
    void rejectsNullOrMissingFieldsWithSafeProblemDetails() throws Exception {
        String placeId = placeIds("amsterdam", 1).getFirst();
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content("{\"cityId\":\"amsterdam\",\"placeIds\":[\"" + placeId + "\"]}"), 400);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Plan\",\"placeIds\":[\"" + placeId + "\"]}"), 400);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Plan\",\"cityId\":\"amsterdam\"}"), 400);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content(json(null, "amsterdam", List.of(placeId))), 400);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content(json("Plan", "amsterdam", java.util.Arrays.asList((String) null))), 400);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content("null"), 400);
    }

    private PlanResponse createPlan(String name, String cityId, List<String> placeIds) throws Exception {
        MvcResult result = mockMvc.perform(post(API_PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(name, cityId, placeIds)))
                .andExpect(status().isCreated())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlanResponse.class);
    }

    private PlanResponse updatePlan(UUID id, String name, String cityId, List<String> placeIds) throws Exception {
        MvcResult result = mockMvc.perform(put(API_PATH + "/{id}", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(name, cityId, placeIds)))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlanResponse.class);
    }

    private void expectInvalid(String name, String cityId, List<String> placeIds) throws Exception {
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content(json(name, cityId, placeIds)), 400);
    }

    private MvcResult expectProblem(MockHttpServletRequestBuilder request, int expectedStatus) throws Exception {
        MvcResult result = mockMvc.perform(request)
                .andExpect(status().is(expectedStatus))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(expectedStatus))
                .andExpect(jsonPath("$.detail").isNotEmpty())
                .andReturn();
        String body = result.getResponse().getContentAsString();
        assertThat(body).doesNotContain("stackTrace", "org.springframework", "org.hibernate", "SQL", "Exception");
        return result;
    }

    private String json(String name, String cityId, List<String> placeIds) throws Exception {
        return objectMapper.writeValueAsString(new PlanUpsertRequest(name, cityId, placeIds));
    }

    private List<String> placeIds(String cityId, int count) {
        return catalogSnapshot.places().stream()
                .filter(place -> place.cityId().equals(cityId))
                .limit(count)
                .map(Place::id)
                .toList();
    }

    private static PlanEntity plan(UUID id, String name, List<String> placeIds, Instant updatedAt) {
        return new PlanEntity(id, name, "utrecht", placeIds, updatedAt, updatedAt);
    }
}
