package com.hopon.plans.persistence;

import com.hopon.catalog.CatalogSnapshot;
import com.hopon.places.Place;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Transactional
class PlanPersistenceIntegrationTest {

    @Autowired
    private PlanRepository planRepository;

    @Autowired
    private CatalogSnapshot catalogSnapshot;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void createsRealH2SchemaAndPersistsOrderedCatalogPlaceIdsAcrossClearAndReorder() {
        List<String> tableNames = jdbcTemplate.queryForList(
                "select table_name from information_schema.tables where table_schema = 'PUBLIC'",
                String.class);
        assertThat(tableNames).contains("SIGHTSEEING_PLAN", "SIGHTSEEING_PLAN_ITEM");

        List<String> originalOrder = catalogSnapshot.places().stream()
                .filter(place -> place.cityId().equals("amsterdam"))
                .limit(3)
                .map(Place::id)
                .toList();
        assertThat(originalOrder).hasSize(3).doesNotHaveDuplicates();

        UUID planId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-11-10T12:00:00Z");
        planRepository.saveAndFlush(new PlanEntity(
                planId,
                "Amsterdam afternoon",
                "Canals first.\nCoffee afterwards.",
                "amsterdam",
                originalOrder,
                createdAt,
                createdAt));

        entityManager.clear();
        PlanEntity reloaded = planRepository.findById(planId).orElseThrow();
        assertThat(reloaded.getPlaceIds()).containsExactlyElementsOf(originalOrder);
        assertThat(reloaded.getDescription()).isEqualTo("Canals first.\nCoffee afterwards.");

        List<String> reordered = List.of(originalOrder.get(2), originalOrder.get(0), originalOrder.get(1));
        reloaded.replaceWith(
                reloaded.getName(),
                reloaded.getDescription(),
                reloaded.getCityId(),
                reordered,
                reloaded.getUpdatedAt());
        entityManager.flush();
        entityManager.clear();

        PlanEntity reorderedFromDatabase = planRepository.findById(planId).orElseThrow();
        assertThat(reorderedFromDatabase.getPlaceIds()).containsExactlyElementsOf(reordered);
        assertThat(reorderedFromDatabase.getCreatedAt()).isEqualTo(createdAt);
    }
}
