import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export const ACTIVE_PLAN_STORAGE_KEY = 'hopon:active-plan:v1';
const PLAN_ID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

@Injectable({ providedIn: 'root' })
export class ActivePlanStore {
  private readonly document = inject(DOCUMENT);
  private readonly selection = signal<string | null>(null);
  readonly selectedId = this.selection.asReadonly();

  constructor() {
    try {
      const stored = this.document.defaultView?.sessionStorage.getItem(ACTIVE_PLAN_STORAGE_KEY);
      if (stored && PLAN_ID.test(stored)) {
        this.selection.set(stored.toLowerCase());
      } else if (stored !== null) {
        this.document.defaultView?.sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
      }
    } catch {
      // Selection still works in memory when tab storage is unavailable.
    }
  }

  select(id: string): void {
    if (!PLAN_ID.test(id)) {
      return;
    }
    const normalized = id.toLowerCase();
    this.selection.set(normalized);
    try {
      this.document.defaultView?.sessionStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, normalized);
    } catch {
      // Do not block planning when tab storage is unavailable.
    }
  }

  clear(expectedId?: string): void {
    if (expectedId !== undefined && this.selectedId() !== expectedId.toLowerCase()) {
      return;
    }
    this.selection.set(null);
    try {
      this.document.defaultView?.sessionStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
    } catch {
      // The in-memory selection has already been cleared.
    }
  }
}
