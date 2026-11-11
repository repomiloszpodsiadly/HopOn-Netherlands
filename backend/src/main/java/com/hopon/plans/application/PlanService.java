package com.hopon.plans.application;

import com.hopon.catalog.CatalogSnapshot;
import com.hopon.cities.City;
import com.hopon.places.Place;
import com.hopon.plans.api.InvalidPlanRequestException;
import com.hopon.plans.api.PlanNotFoundException;
import com.hopon.plans.api.PlanResponse;
import com.hopon.plans.api.PlanUpsertRequest;
import com.hopon.plans.persistence.PlanEntity;
import com.hopon.plans.persistence.PlanRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class PlanService {

    private static final int MIN_PLACE_COUNT = 1;
    private static final int MAX_PLACE_COUNT = 12;
    private static final int MAX_NAME_LENGTH = 80;
    private static final Comparator<PlanEntity> PLAN_ORDER = Comparator
            .comparing(PlanEntity::getUpdatedAt, Comparator.reverseOrder())
            .thenComparing(plan -> plan.getId().toString());

    private final PlanRepository planRepository;
    private final Set<String> supportedCityIds;
    private final Map<String, String> placeCityById;

    public PlanService(PlanRepository planRepository, CatalogSnapshot catalogSnapshot) {
        this.planRepository = planRepository;
        this.supportedCityIds = catalogSnapshot.cities().stream()
                .map(City::id)
                .collect(Collectors.toUnmodifiableSet());
        this.placeCityById = catalogSnapshot.places().stream()
                .collect(Collectors.toUnmodifiableMap(Place::id, Place::cityId));
    }

    @Transactional(readOnly = true)
    public List<PlanResponse> getAll() {
        return planRepository.findAll().stream()
                .sorted(PLAN_ORDER)
                .map(PlanService::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public PlanResponse get(UUID id) {
        return toResponse(findPlan(id));
    }

    @Transactional
    public PlanResponse create(PlanUpsertRequest request) {
        NormalizedPlan normalized = validate(request);
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        PlanEntity plan = new PlanEntity(
                UUID.randomUUID(),
                normalized.name(),
                normalized.cityId(),
                normalized.placeIds(),
                now,
                now);
        return toResponse(planRepository.saveAndFlush(plan));
    }

    @Transactional
    public PlanResponse update(UUID id, PlanUpsertRequest request) {
        PlanEntity existing = findPlan(id);
        NormalizedPlan normalized = validate(request);
        if (matches(existing, normalized)) {
            return toResponse(existing);
        }

        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (!now.isAfter(existing.getUpdatedAt())) {
            now = existing.getUpdatedAt().plus(1, ChronoUnit.MICROS);
        }
        existing.replaceWith(normalized.name(), normalized.cityId(), normalized.placeIds(), now);
        return toResponse(planRepository.saveAndFlush(existing));
    }

    @Transactional
    public void delete(UUID id) {
        planRepository.delete(findPlan(id));
    }

    private PlanEntity findPlan(UUID id) {
        return planRepository.findById(id).orElseThrow(PlanNotFoundException::new);
    }

    private NormalizedPlan validate(PlanUpsertRequest request) {
        if (request == null) {
            throw new InvalidPlanRequestException("A plan request body is required.");
        }

        String name = request.name() == null ? null : request.name().strip();
        if (name == null || name.isEmpty()) {
            throw new InvalidPlanRequestException("Plan name must not be blank.");
        }
        if (name.length() > MAX_NAME_LENGTH) {
            throw new InvalidPlanRequestException("Plan name must be at most 80 characters.");
        }

        String cityId = request.cityId();
        if (cityId == null || !supportedCityIds.contains(cityId)) {
            throw new InvalidPlanRequestException("cityId must identify a supported city.");
        }

        List<String> requestedPlaceIds = request.placeIds();
        if (requestedPlaceIds == null
                || requestedPlaceIds.size() < MIN_PLACE_COUNT
                || requestedPlaceIds.size() > MAX_PLACE_COUNT) {
            throw new InvalidPlanRequestException("placeIds must contain between 1 and 12 places.");
        }

        Set<String> seenPlaceIds = new HashSet<>();
        for (String placeId : requestedPlaceIds) {
            if (placeId == null || placeId.isBlank()) {
                throw new InvalidPlanRequestException("placeIds must not contain blank IDs.");
            }
            if (!seenPlaceIds.add(placeId)) {
                throw new InvalidPlanRequestException("placeIds must not contain duplicate IDs.");
            }
            String actualCityId = placeCityById.get(placeId);
            if (actualCityId == null) {
                throw new InvalidPlanRequestException("Every plan place must exist in the catalog.");
            }
            if (!actualCityId.equals(cityId)) {
                throw new InvalidPlanRequestException("All plan places must belong to the selected city.");
            }
        }

        return new NormalizedPlan(name, cityId, List.copyOf(requestedPlaceIds));
    }

    private static boolean matches(PlanEntity existing, NormalizedPlan normalized) {
        return existing.getName().equals(normalized.name())
                && existing.getCityId().equals(normalized.cityId())
                && existing.getPlaceIds().equals(normalized.placeIds());
    }

    private static PlanResponse toResponse(PlanEntity plan) {
        return new PlanResponse(
                plan.getId(),
                plan.getName(),
                plan.getCityId(),
                plan.getPlaceIds(),
                plan.getCreatedAt(),
                plan.getUpdatedAt());
    }

    private record NormalizedPlan(String name, String cityId, List<String> placeIds) {
    }
}
