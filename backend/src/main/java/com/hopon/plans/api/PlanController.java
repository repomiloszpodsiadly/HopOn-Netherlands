package com.hopon.plans.api;

import com.hopon.plans.application.PlanCommand;
import com.hopon.plans.application.PlanResult;
import com.hopon.plans.application.PlanService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/plans")
public class PlanController {

    private final PlanService planService;

    public PlanController(PlanService planService) {
        this.planService = planService;
    }

    @GetMapping
    public List<PlanResponse> getAll() {
        return planService.getAll().stream().map(PlanController::toResponse).toList();
    }

    @GetMapping("/{id}")
    public PlanResponse get(@PathVariable UUID id) {
        return toResponse(planService.get(id));
    }

    @PostMapping
    public ResponseEntity<PlanResponse> create(@Valid @RequestBody PlanUpsertRequest request) {
        PlanResponse response = toResponse(planService.create(toCommand(request)));
        return ResponseEntity.created(URI.create("/api/plans/" + response.id())).body(response);
    }

    @PutMapping("/{id}/autosave")
    public PlanResponse autosave(@PathVariable UUID id, @Valid @RequestBody PlanUpsertRequest request) {
        return toResponse(planService.autosave(id, toCommand(request)));
    }

    @PutMapping("/{id}")
    public PlanResponse update(@PathVariable UUID id, @Valid @RequestBody PlanUpsertRequest request) {
        return toResponse(planService.update(id, toCommand(request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        planService.delete(id);
        return ResponseEntity.noContent().build();
    }

    private static PlanCommand toCommand(PlanUpsertRequest request) {
        return new PlanCommand(request.name(), request.description(), request.cityId(), request.placeIds());
    }

    private static PlanResponse toResponse(PlanResult result) {
        return new PlanResponse(result.id(), result.name(), result.description(), result.cityId(),
                result.placeIds(), result.createdAt(), result.updatedAt());
    }
}
