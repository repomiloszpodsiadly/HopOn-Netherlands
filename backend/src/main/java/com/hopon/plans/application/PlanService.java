package com.hopon.plans.application;

import com.hopon.catalog.CatalogSnapshot;
import com.hopon.cities.City;
import com.hopon.places.Place;
import com.hopon.plans.api.InvalidPlanRequestException;
import com.hopon.plans.api.PlanNotFoundException;
import com.hopon.plans.api.PlanLimitReachedException;
import com.hopon.plans.api.PlanResponse;
import com.hopon.plans.api.PlanUpsertRequest;
import com.hopon.plans.persistence.PlanEntity;
import com.hopon.plans.persistence.PlanRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class PlanService {

    private static final int MAX_PLACE_COUNT = 12;
    private static final int MAX_PLAN_COUNT = 6;
    private static final int MAX_NAME_LENGTH = 30;
    private static final int MAX_DESCRIPTION_LENGTH = 500;
    private static final Comparator<PlanEntity> PLAN_ORDER = Comparator
            .comparing(PlanEntity::getUpdatedAt, Comparator.reverseOrder())
            .thenComparing(plan -> plan.getId().toString());

    private final PlanRepository planRepository;
    private final TransactionTemplate writeTransaction;
    private final Object creationLock = new Object();
    private final Set<String> supportedCityIds;
    private final Set<String> supportedPlaceIds;

    public PlanService(PlanRepository planRepository, CatalogSnapshot catalogSnapshot,
                       PlatformTransactionManager transactionManager) {
        this.planRepository = planRepository;
        this.writeTransaction = new TransactionTemplate(transactionManager);
        this.supportedCityIds = catalogSnapshot.cities().stream()
                .map(City::id)
                .collect(Collectors.toUnmodifiableSet());
        this.supportedPlaceIds = catalogSnapshot.places().stream()
                .map(Place::id)
                .collect(Collectors.toUnmodifiableSet());
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

    public PlanResponse create(PlanUpsertRequest request) {
        NormalizedPlan normalized = validate(request);
        // Keep allocation locked through commit: concurrent tabs cannot take a seventh slot
        // or allocate the same generated name in this single-process, in-memory app.
        synchronized (creationLock) {
            return writeTransaction.execute(status -> createNew(UUID.randomUUID(), normalized));
        }
    }

    public PlanResponse autosave(UUID id, PlanUpsertRequest request) {
        NormalizedPlan normalized = validate(request);
        synchronized (creationLock) {
            return writeTransaction.execute(status -> {
                PlanEntity existing = planRepository.findById(id).orElse(null);
                if (existing == null) {
                    return createNew(id, normalized);
                }
                // Retries use the same ID and preserve the name allocated on first creation.
                return replace(existing, new NormalizedPlan(existing.getName(), normalized.description(),
                        normalized.cityId(), normalized.placeIds()));
            });
        }
    }

    private PlanResponse createNew(UUID id, NormalizedPlan normalized) {
        List<PlanEntity> existing = planRepository.findAll();
        if (existing.size() >= MAX_PLAN_COUNT) {
            throw new PlanLimitReachedException();
        }
        Set<String> names = existing.stream().map(plan -> plan.getName().toLowerCase(Locale.ROOT))
                .collect(Collectors.toSet());
        String name = normalized.name();
        int suffix = 0;
        while (names.contains(name.toLowerCase(Locale.ROOT))) {
            String ending = "-" + ++suffix;
            name = normalized.name().substring(0, Math.min(normalized.name().length(), MAX_NAME_LENGTH - ending.length()))
                    + ending;
        }
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        PlanEntity plan = new PlanEntity(
                id,
                name,
                normalized.description(),
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
        return replace(existing, normalized);
    }

    private PlanResponse replace(PlanEntity existing, NormalizedPlan normalized) {
        if (matches(existing, normalized)) {
            return toResponse(existing);
        }

        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (!now.isAfter(existing.getUpdatedAt())) {
            now = existing.getUpdatedAt().plus(1, ChronoUnit.MICROS);
        }
        existing.replaceWith(normalized.name(), normalized.description(), normalized.cityId(), normalized.placeIds(), now);
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
            throw new InvalidPlanRequestException("Plan name must be at most 30 characters.");
        }

        String description = request.description() == null ? "" : request.description();
        if (description.length() > MAX_DESCRIPTION_LENGTH) {
            throw new InvalidPlanRequestException("Plan description must be at most 500 characters.");
        }
        description = description.strip();

        String cityId = request.cityId();
        if (cityId == null || !supportedCityIds.contains(cityId)) {
            throw new InvalidPlanRequestException("cityId must identify a supported city.");
        }

        List<String> requestedPlaceIds = request.placeIds();
        if (requestedPlaceIds == null
                || requestedPlaceIds.size() > MAX_PLACE_COUNT) {
            throw new InvalidPlanRequestException("placeIds must be a list of at most 12 places.");
        }

        Set<String> seenPlaceIds = new HashSet<>();
        for (String placeId : requestedPlaceIds) {
            if (placeId == null || placeId.isBlank()) {
                throw new InvalidPlanRequestException("placeIds must not contain blank IDs.");
            }
            if (!seenPlaceIds.add(placeId)) {
                throw new InvalidPlanRequestException("placeIds must not contain duplicate IDs.");
            }
            if (!supportedPlaceIds.contains(placeId)) {
                throw new InvalidPlanRequestException("Every plan place must exist in the catalog.");
            }
        }

        return new NormalizedPlan(name, description, cityId, List.copyOf(requestedPlaceIds));
    }

    private static boolean matches(PlanEntity existing, NormalizedPlan normalized) {
        return existing.getName().equals(normalized.name())
                && existing.getDescription().equals(normalized.description())
                && existing.getCityId().equals(normalized.cityId())
                && existing.getPlaceIds().equals(normalized.placeIds());
    }

    private static PlanResponse toResponse(PlanEntity plan) {
        return new PlanResponse(
                plan.getId(),
                plan.getName(),
                plan.getDescription(),
                plan.getCityId(),
                plan.getPlaceIds(),
                plan.getCreatedAt(),
                plan.getUpdatedAt());
    }

    private record NormalizedPlan(String name, String description, String cityId, List<String> placeIds) {
    }
}
