package com.hopon.plans.persistence;

import jakarta.persistence.Access;
import jakarta.persistence.AccessType;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "sightseeing_plan")
@Access(AccessType.FIELD)
public class PlanEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "name", nullable = false, length = 80)
    private String name;

    @Column(name = "city_id", nullable = false, length = 40)
    private String cityId;

    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(
            name = "sightseeing_plan_item",
            joinColumns = @JoinColumn(name = "plan_id", nullable = false))
    @OrderColumn(name = "position", nullable = false)
    @Column(name = "place_id", nullable = false, length = 160)
    private List<String> placeIds = new ArrayList<>();

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected PlanEntity() {
    }

    public PlanEntity(
            UUID id,
            String name,
            String cityId,
            List<String> placeIds,
            Instant createdAt,
            Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.cityId = cityId;
        this.placeIds = new ArrayList<>(placeIds);
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getCityId() {
        return cityId;
    }

    public List<String> getPlaceIds() {
        return List.copyOf(placeIds);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void replaceWith(
            String name,
            String cityId,
            List<String> orderedPlaceIds,
            Instant updatedAt) {
        this.name = name;
        this.cityId = cityId;
        placeIds.clear();
        placeIds.addAll(orderedPlaceIds);
        this.updatedAt = updatedAt;
    }
}
