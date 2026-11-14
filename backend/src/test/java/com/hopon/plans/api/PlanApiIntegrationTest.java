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
    void allocatesNumberedNamesAndBlocksOnlyTheSeventhCreation() throws Exception {
        List<String> ids = placeIds("amsterdam", 12);
        PlanResponse first = createPlan("My day out", "amsterdam", List.of());
        for (int index = 1; index < 6; index++) {
            assertThat(createPlan("My day out", "amsterdam", List.of()).name()).isEqualTo("My day out-" + index);
        }
        mockMvc.perform(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                        .content(json("My day out", "amsterdam", ids)))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("Use an existing plan or delete one")));
        mockMvc.perform(put(API_PATH + "/{id}/autosave", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                        .content(json("My day out", "amsterdam", ids)))
                .andExpect(status().isConflict());
        mockMvc.perform(put(API_PATH + "/{id}", first.id()).contentType(MediaType.APPLICATION_JSON)
                        .content(json("Updated full plan", "amsterdam", ids)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.placeIds.length()").value(12));
        mockMvc.perform(put(API_PATH + "/{id}/autosave", first.id()).contentType(MediaType.APPLICATION_JSON)
                        .content(json("Original retry name", "amsterdam", ids)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("Updated full plan"));
        assertThat(planRepository.count()).isEqualTo(6);
        mockMvc.perform(delete(API_PATH + "/{id}", first.id())).andExpect(status().isNoContent());
        assertThat(createPlan("My day out", "amsterdam", List.of()).name()).isEqualTo("My day out");
        assertThat(planRepository.count()).isEqualTo(6);
    }

    @Test
    void autosaveRetriesKeepOneIdOneAllocatedNameAndOriginalCreationTime() throws Exception {
        createPlan("My day out", "amsterdam", List.of());
        UUID id = UUID.randomUUID();
        List<String> ids = List.of(placeIds("amsterdam", 1).getFirst(), placeIds("rotterdam", 1).getFirst(),
                placeIds("utrecht", 1).getFirst());
        MvcResult first = mockMvc.perform(put(API_PATH + "/{id}/autosave", id).contentType(MediaType.APPLICATION_JSON)
                        .content(json("My day out", "amsterdam", ids.subList(0, 1))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("My day out-1")).andReturn();
        PlanResponse created = objectMapper.readValue(first.getResponse().getContentAsByteArray(), PlanResponse.class);
        mockMvc.perform(put(API_PATH + "/{id}/autosave", id).contentType(MediaType.APPLICATION_JSON)
                        .content(json("My day out", "amsterdam", ids)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id.toString()))
                .andExpect(jsonPath("$.name").value("My day out-1"))
                .andExpect(jsonPath("$.placeIds.length()").value(3));
        assertThat(planRepository.count()).isEqualTo(2);
        assertThat(planRepository.findById(id).orElseThrow().getCreatedAt()).isEqualTo(created.createdAt());
    }

    @Test
    void concurrentCreationCannotExceedSixOrAllocateDuplicateNames() throws Exception {
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(8)) {
            var barrier = new java.util.concurrent.CyclicBarrier(8);
            var futures = java.util.stream.IntStream.range(0, 8).mapToObj(index -> executor.submit(() -> {
                barrier.await();
                return mockMvc.perform(put(API_PATH + "/{id}/autosave", UUID.randomUUID())
                                .contentType(MediaType.APPLICATION_JSON).content(json("My day out", "amsterdam", List.of())))
                        .andReturn().getResponse().getStatus();
            })).toList();
            var statuses = new java.util.ArrayList<Integer>();
            for (var future : futures) statuses.add(future.get(15, java.util.concurrent.TimeUnit.SECONDS));
            assertThat(statuses.stream().filter(code -> code == 200).count()).isEqualTo(6);
            assertThat(statuses.stream().filter(code -> code == 409).count()).isEqualTo(2);
        }
        assertThat(planRepository.findAll()).hasSize(6).extracting(PlanEntity::getName)
                .containsExactlyInAnyOrder("My day out", "My day out-1", "My day out-2", "My day out-3", "My day out-4", "My day out-5");
    }

    @Test
    void numberedNamesStayWithinThirtyCharacters() throws Exception {
        createPlan("x".repeat(30), "amsterdam", List.of());
        assertThat(createPlan("x".repeat(30), "amsterdam", List.of()).name()).isEqualTo("x".repeat(28) + "-1");
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
    void acceptsZeroOneAndTwelvePlacesButRejectsThirteen() throws Exception {
        List<String> cityPlaceIds = placeIds("amsterdam", 13);

        assertThat(createPlan("One place", "amsterdam", cityPlaceIds.subList(0, 1)).placeIds()).hasSize(1);
        PlanResponse full = createPlan("Twelve places", "amsterdam", cityPlaceIds.subList(0, 12));
        assertThat(full.placeIds()).hasSize(12);
        expectProblem(put(API_PATH + "/{id}", full.id()).contentType(MediaType.APPLICATION_JSON)
                .content(json(full.name(), "amsterdam", cityPlaceIds)), 400);
        mockMvc.perform(get(API_PATH + "/{id}", full.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.placeIds.length()").value(12));
        PlanResponse empty = createPlan("Places to come", "amsterdam", List.of());
        assertThat(empty.placeIds()).isEmpty();
        mockMvc.perform(get(API_PATH + "/{id}", empty.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.placeIds").isEmpty());
        PlanResponse withPlace = updatePlan(empty.id(), empty.name(), empty.cityId(), cityPlaceIds.subList(0, 1));
        assertThat(withPlace.placeIds()).hasSize(1);
        PlanResponse cleared = updatePlan(empty.id(), empty.name(), empty.cityId(), List.of());
        assertThat(cleared.placeIds()).isEmpty();
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content(json("Too many places", "amsterdam", cityPlaceIds)), 400);
    }

    @Test
    void validatesNameCityAndCatalogIdentityWhileAllowingPlacesAcrossCities() throws Exception {
        List<String> amsterdamIds = placeIds("amsterdam", 2);
        String rotterdamId = placeIds("rotterdam", 1).getFirst();
        String utrechtId = placeIds("utrecht", 1).getFirst();

        expectInvalid("   ", "amsterdam", amsterdamIds);
        expectInvalid("x".repeat(31), "amsterdam", amsterdamIds);
        expectInvalid("A plan", "unknown-city", amsterdamIds);
        expectInvalid("A plan", "amsterdam", List.of("   "));
        expectInvalid("A plan", "amsterdam", List.of(amsterdamIds.getFirst(), amsterdamIds.getFirst()));
        expectInvalid("A plan", "amsterdam", List.of("unknown-catalog-place"));
        List<String> mixedPlaces = List.of(amsterdamIds.getFirst(), rotterdamId, utrechtId);
        PlanResponse mixedCityPlan = createPlan("Three city day", "amsterdam", mixedPlaces);
        assertThat(mixedCityPlan.placeIds()).containsExactlyElementsOf(mixedPlaces);
        assertThat(updatePlan(mixedCityPlan.id(), mixedCityPlan.name(), "utrecht", mixedPlaces).placeIds())
                .containsExactlyElementsOf(mixedPlaces);

        assertThat(createPlan("x".repeat(30), "amsterdam", amsterdamIds.subList(0, 1)).name())
                .hasSize(30);
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

    @Test
    void persistsUpdatesAndClearsMultilineDescriptionsWithoutChangingOtherPlanFields() throws Exception {
        String description = "Canals & cafés.\nMeet at 10:00 <near the bridge>.";
        MvcResult result = mockMvc.perform(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                        .content(json("A city day", "  " + description + "  ", "amsterdam", List.of())))
                .andExpect(status().isCreated()).andReturn();
        PlanResponse created = objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlanResponse.class);
        assertThat(created.description()).isEqualTo(description);
        mockMvc.perform(get(API_PATH + "/{id}", created.id()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.description").value(description));

        String updatedDescription = "Museums first.\nLunch by the water.";
        MvcResult updatedResult = mockMvc.perform(put(API_PATH + "/{id}", created.id()).contentType(MediaType.APPLICATION_JSON)
                        .content(json(created.name(), updatedDescription, created.cityId(), created.placeIds())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.description").value(updatedDescription)).andReturn();
        PlanResponse updated = objectMapper.readValue(updatedResult.getResponse().getContentAsByteArray(), PlanResponse.class);
        assertThat(updated.createdAt()).isEqualTo(created.createdAt());
        assertThat(updated.updatedAt()).isAfter(created.updatedAt());
        mockMvc.perform(get(API_PATH)).andExpect(jsonPath("$[0].description").value(updatedDescription));
        mockMvc.perform(put(API_PATH + "/{id}", created.id()).contentType(MediaType.APPLICATION_JSON)
                        .content(json(created.name(), "  " + updatedDescription + "  ", created.cityId(), created.placeIds())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.updatedAt").value(updated.updatedAt().toString()));
        mockMvc.perform(put(API_PATH + "/{id}", created.id()).contentType(MediaType.APPLICATION_JSON)
                        .content(json(created.name(), null, created.cityId(), created.placeIds())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.description").value(""))
                .andExpect(jsonPath("$.name").value(created.name())).andExpect(jsonPath("$.placeIds").isEmpty());
        mockMvc.perform(get(API_PATH + "/{id}", created.id())).andExpect(jsonPath("$.description").value(""));
    }

    @Test
    void acceptsTheDescriptionBoundaryAndRejectsOversizedDescriptionsWithoutMutatingThePlan() throws Exception {
        String description = "x".repeat(500);
        MvcResult result = mockMvc.perform(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                        .content(json("A city day", description, "utrecht", List.of())))
                .andExpect(status().isCreated()).andReturn();
        PlanResponse created = objectMapper.readValue(result.getResponse().getContentAsByteArray(), PlanResponse.class);
        assertThat(created.description()).isEqualTo(description);
        expectProblem(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                .content(json("Too long", description + "x", "utrecht", List.of())), 400);
        expectProblem(put(API_PATH + "/{id}", created.id()).contentType(MediaType.APPLICATION_JSON)
                .content(json("Changed name", description + "x", "utrecht", List.of())), 400);
        mockMvc.perform(get(API_PATH + "/{id}", created.id()))
                .andExpect(jsonPath("$.name").value(created.name()))
                .andExpect(jsonPath("$.description").value(description))
                .andExpect(jsonPath("$.updatedAt").value(created.updatedAt().toString()));
        assertThat(planRepository.count()).isEqualTo(1);
    }

    @Test
    void treatsAnOmittedDescriptionAsEmptyForExistingApiClients() throws Exception {
        mockMvc.perform(post(API_PATH).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"A city day\",\"cityId\":\"amsterdam\",\"placeIds\":[]}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.description").value(""));
    }

    @Test
    void enforcesThirtyCharacterNamesAndFiveHundredCharacterDescriptionsOnAutosaveAndUpdate() throws Exception {
        UUID id = UUID.randomUUID();
        List<String> ids = placeIds("amsterdam", 1);
        mockMvc.perform(put(API_PATH + "/{id}/autosave", id).contentType(MediaType.APPLICATION_JSON)
                        .content(json("n".repeat(30), "d".repeat(500), "amsterdam", ids)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("n".repeat(30)))
                .andExpect(jsonPath("$.description").value("d".repeat(500)));
        expectProblem(put(API_PATH + "/{id}", id).contentType(MediaType.APPLICATION_JSON)
                .content(json("n".repeat(31), "", "amsterdam", ids)), 400);
        expectProblem(put(API_PATH + "/{id}/autosave", id).contentType(MediaType.APPLICATION_JSON)
                .content(json("n".repeat(30), "d".repeat(501), "amsterdam", ids)), 400);
        expectProblem(put(API_PATH + "/{id}/autosave", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content(json("n".repeat(31), "", "amsterdam", ids)), 400);
        mockMvc.perform(get(API_PATH + "/{id}", id)).andExpect(jsonPath("$.description").value("d".repeat(500)));
        assertThat(planRepository.count()).isEqualTo(1);
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
        return json(name, null, cityId, placeIds);
    }

    private String json(String name, String description, String cityId, List<String> placeIds) throws Exception {
        return objectMapper.writeValueAsString(new PlanUpsertRequest(name, description, cityId, placeIds));
    }

    private List<String> placeIds(String cityId, int count) {
        return catalogSnapshot.places().stream()
                .filter(place -> place.cityId().equals(cityId))
                .limit(count)
                .map(Place::id)
                .toList();
    }

    private static PlanEntity plan(UUID id, String name, List<String> placeIds, Instant updatedAt) {
        return new PlanEntity(id, name, "", "utrecht", placeIds, updatedAt, updatedAt);
    }
}
