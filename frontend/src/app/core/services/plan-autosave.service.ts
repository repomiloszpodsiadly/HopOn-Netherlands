import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { apiErrorMessage } from '../api/api-error';
import { PlansApiService, UnexpectedPlanResponseError } from '../api/plans-api.service';
import { isAllocatedPlanName, PLAN_NAME_MAX_LENGTH, PLAN_DESCRIPTION_MAX_LENGTH, PlanResponse, PlanUpsertRequest } from '../models/plan.models';
import { ActivePlanStore } from './active-plan.store';
import { DraftPlanStore } from './draft-plan.store';

/** Lives across navigation. A persisted request ID makes interrupted creation safe to retry. */
@Injectable({ providedIn: 'root' })
export class PlanAutosaveService {
  private readonly api = inject(PlansApiService);
  private readonly drafts = inject(DraftPlanStore);
  private readonly active = inject(ActivePlanStore);
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);
  readonly capacityReached = signal(false);
  readonly lastSaved = signal<PlanResponse | null>(null);

  constructor() {
    effect(() => {
      const draft = this.drafts.draft();
      if (draft?.autosaveId && !this.drafts.isValidating() && !this.drafts.validationError()
        && !this.pending() && !this.error()) {
        untracked(() => this.save());
      }
    });
  }

  save(): void {
    if (this.pending()) return;
    const current = this.drafts.draft();
    if (!current || current.placeIds.length > 12 || current.name.trim().length > PLAN_NAME_MAX_LENGTH
      || current.description.length > PLAN_DESCRIPTION_MAX_LENGTH) {
      this.error.set('Use a plan name of up to 30 characters, a description of up to 500 characters and at most 12 places before saving.');
      return;
    }
    const draft = this.drafts.prepareAutosave();
    if (!draft?.autosaveId) return;
    this.pending.set(true);
    this.error.set(null);
    this.capacityReached.set(false);
    const request: PlanUpsertRequest = {
      name: draft.name.trim() || 'My day out', description: draft.description.trim(),
      cityId: draft.cityId, placeIds: [...draft.placeIds],
    };
    // Deliberately not tied to a component's lifetime: navigation must not cancel saving.
    this.api.autosaveDraft(draft.autosaveId, request).subscribe({
      next: plan => {
        if (!isAllocatedPlanName(request.name, plan.name) || plan.description !== request.description
          || plan.cityId !== request.cityId || plan.placeIds.length !== request.placeIds.length
          || !plan.placeIds.every((id, index) => id === request.placeIds[index])) {
          this.fail(new UnexpectedPlanResponseError());
          return;
        }
        if (this.drafts.clearAfterSuccessfulSave(draft)) {
          if (this.active.selectedId() === null) this.active.select(plan.id);
          this.lastSaved.set(plan);
        } else {
          this.error.set('An earlier version was saved. Your newer draft is still here. Retry saving to include it.');
        }
        this.pending.set(false);
      },
      error: error => this.fail(error),
    });
  }

  private fail(error: unknown): void {
    this.capacityReached.set(error instanceof HttpErrorResponse && error.status === 409);
    this.error.set(apiErrorMessage(error, 'Automatic saving was not confirmed. Your places are kept in this tab. Retry saving.'));
    this.pending.set(false);
  }
}
