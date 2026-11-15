import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { CityId, PlaceDto, isCityId } from '../models/catalog.models';
import { DraftAddResult, DraftPlan } from '../models/draft-plan.models';
import { MAX_PLAN_PLACES, PLAN_NAME_MAX_LENGTH, PLAN_DESCRIPTION_MAX_LENGTH } from '../models/plan.models';

export const DRAFT_PLAN_STORAGE_KEY = 'hopon:draft:v1';
const DEFAULT_PLAN_NAME = 'My day out';

@Injectable({ providedIn: 'root' })
export class DraftPlanStore {
  private readonly document = inject(DOCUMENT);
  private pendingDraft: DraftPlan | null = null;

  readonly draft = signal<DraftPlan | null>(null);
  readonly isValidating = signal(false);
  readonly validationError = signal<string | null>(null);
  readonly restoreMessage = signal<string | null>(null);
  readonly storageUnavailable = signal(false);
  private readonly storage = this.resolveStorage();

  constructor() {
    this.restoreFromSession();
  }

  pendingCityId(): CityId | null {
    return this.pendingDraft?.cityId ?? null;
  }

  initializeDraft(cityId: CityId): boolean {
    if (this.pendingDraft !== null || this.draft() !== null) {
      return false;
    }
    this.commit({
      schemaVersion: 1,
      cityId,
      name: DEFAULT_PLAN_NAME,
      description: '',
      placeIds: [],
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  renameDraft(name: string): boolean {
    const existing = this.draft();
    if (existing === null || this.pendingDraft !== null || existing.name === name) {
      return false;
    }
    this.commit({ ...existing, name, updatedAt: new Date().toISOString() });
    return true;
  }

  updateDescription(description: string): boolean {
    const existing = this.draft();
    if (existing === null || this.pendingDraft !== null || existing.description === description) {
      return false;
    }
    this.commit({ ...existing, description, updatedAt: new Date().toISOString() });
    return true;
  }

  movePlace(placeId: string, direction: 'up' | 'down'): boolean {
    const existing = this.draft();
    if (existing === null || this.pendingDraft !== null) {
      return false;
    }
    const currentIndex = existing.placeIds.indexOf(placeId);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= existing.placeIds.length) {
      return false;
    }
    const placeIds = [...existing.placeIds];
    [placeIds[currentIndex], placeIds[targetIndex]] = [placeIds[targetIndex], placeIds[currentIndex]];
    this.commit({ ...existing, placeIds, updatedAt: new Date().toISOString() });
    return true;
  }

  removePlace(placeId: string): boolean {
    const existing = this.draft();
    if (existing === null || this.pendingDraft !== null || !existing.placeIds.includes(placeId)) {
      return false;
    }
    this.commit({
      ...existing,
      placeIds: existing.placeIds.filter((id) => id !== placeId),
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  requestCityChange(cityId: CityId): boolean {
    if (this.pendingDraft !== null) {
      return false;
    }
    const existing = this.draft();
    if (existing === null) {
      return this.initializeDraft(cityId);
    }
    if (existing.cityId === cityId) {
      return true;
    }
    this.commit({ ...existing, cityId, updatedAt: new Date().toISOString() });
    return true;
  }

  clearAfterSuccessfulSave(expectedDraft: DraftPlan): boolean {
    if (this.pendingDraft !== null || this.draft() !== expectedDraft) {
      return false;
    }
    this.draft.set(null);
    this.removeStoredDraft();
    this.validationError.set(null);
    this.restoreMessage.set(null);
    return true;
  }

  prepareAutosave(): DraftPlan | null {
    const draft = this.draft();
    if (draft === null || this.pendingDraft !== null) return null;
    if (draft.autosaveId) return draft;
    const next = { ...draft, autosaveId: globalThis.crypto.randomUUID() };
    this.commit(next);
    return next;
  }

  beginValidation(): void {
    if (this.pendingDraft !== null) {
      this.isValidating.set(true);
      this.validationError.set(null);
    }
  }

  validatePendingDraft(cityId: CityId, catalog: readonly PlaceDto[]): boolean {
    const pending = this.pendingDraft;
    if (pending === null || pending.cityId !== cityId) {
      return false;
    }

    const validIds = new Set(catalog.map((place) => place.id));
    const placeIds = unique(pending.placeIds).filter((placeId) => validIds.has(placeId));
    if (placeIds.length !== pending.placeIds.length) {
      this.restoreMessage.set('Places missing from the current catalog were removed from this tab draft.');
    }

    const validated = { ...pending, placeIds } satisfies DraftPlan;
    this.pendingDraft = null;
    this.isValidating.set(false);
    this.validationError.set(null);
    this.commit(validated);
    return true;
  }

  failValidation(message: string): void {
    if (this.pendingDraft !== null) {
      this.isValidating.set(false);
      this.validationError.set(message);
    }
  }

  addPlaces(
    requestedPlaceIds: readonly string[],
    catalog: readonly PlaceDto[],
  ): DraftAddResult {
    if (this.pendingDraft !== null) {
      return { status: 'validation-pending' };
    }

    const placesById = new Map(catalog.map((place) => [place.id, place]));
    const validIds = new Set(placesById.keys());
    const placeIds = unique(requestedPlaceIds).filter((placeId) => validIds.has(placeId));
    if (placeIds.length === 0) {
      return { status: 'no-verified-places' };
    }
    if (placeIds.length > MAX_PLAN_PLACES) {
      return { status: 'limit-reached' };
    }

    const existing = this.draft();
    const existingIds = new Set(existing?.placeIds ?? []);
    const newIds = placeIds.filter((placeId) => !existingIds.has(placeId));
    const alreadyPresentCount = placeIds.length - newIds.length;
    if (newIds.length === 0) {
      return { status: 'already-added' };
    }
    if ((existing?.placeIds.length ?? 0) + newIds.length > MAX_PLAN_PLACES) {
      return { status: 'limit-reached' };
    }

    const startingCityId = existing?.cityId ?? placesById.get(newIds[0] ?? '')?.cityId;
    if (startingCityId === undefined) {
      return { status: 'no-verified-places' };
    }

    const nextDraft: DraftPlan = existing === null
      ? {
          schemaVersion: 1,
          cityId: startingCityId,
          name: DEFAULT_PLAN_NAME,
          description: '',
          placeIds: newIds,
          updatedAt: new Date().toISOString(),
        }
      : {
          ...existing,
          placeIds: [...existing.placeIds, ...newIds],
          updatedAt: new Date().toISOString(),
        };
    this.commit(nextDraft);
    return { status: 'added', addedCount: newIds.length, alreadyPresentCount };
  }

  private restoreFromSession(): void {
    if (this.storage === null) {
      return;
    }
    try {
      const raw = this.storage.getItem(DRAFT_PLAN_STORAGE_KEY);
      if (raw === null) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!isDraftPlan(parsed)) {
        this.removeStoredDraft();
        this.restoreMessage.set('An invalid tab draft was cleared.');
        return;
      }
      this.pendingDraft = { ...parsed, description: parsed.description ?? '', placeIds: unique(parsed.placeIds) };
      this.isValidating.set(true);
    } catch {
      this.removeStoredDraft();
      this.restoreMessage.set('An unreadable tab draft was cleared.');
    }
  }

  private resolveStorage(): Storage | null {
    try {
      return this.document.defaultView?.sessionStorage ?? null;
    } catch {
      this.storageUnavailable.set(true);
      return null;
    }
  }

  private commit(draft: DraftPlan): void {
    this.draft.set(draft);
    this.persist(draft);
  }

  private persist(draft: DraftPlan): void {
    if (this.storage === null) {
      this.storageUnavailable.set(true);
      return;
    }
    try {
      this.storage.setItem(DRAFT_PLAN_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      this.storageUnavailable.set(true);
    }
  }

  private removeStoredDraft(): void {
    try {
      this.storage?.removeItem(DRAFT_PLAN_STORAGE_KEY);
    } catch {
      this.storageUnavailable.set(true);
    }
  }
}

type StoredDraftPlan = Omit<DraftPlan, 'description'> & Readonly<{ description?: string }>;

function isDraftPlan(value: unknown): value is StoredDraftPlan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate['schemaVersion'] === 1
    && isCityId(candidate['cityId'] as string | undefined)
    && typeof candidate['name'] === 'string'
    && candidate['name'].length <= PLAN_NAME_MAX_LENGTH
    && (candidate['description'] === undefined || typeof candidate['description'] === 'string'
      && candidate['description'].length <= PLAN_DESCRIPTION_MAX_LENGTH)
    && Array.isArray(candidate['placeIds'])
    && candidate['placeIds'].every((placeId) => typeof placeId === 'string' && placeId.length > 0)
    && typeof candidate['updatedAt'] === 'string'
    && (candidate['autosaveId'] === undefined || typeof candidate['autosaveId'] === 'string'
      && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(candidate['autosaveId']))
    && Number.isFinite(Date.parse(candidate['updatedAt']));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
