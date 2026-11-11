import { HttpErrorResponse } from '@angular/common/http';
import { ProblemDetailDto } from '../models/catalog.models';

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }
  if (error.status === 0) {
    return 'Could not connect to the API. Check that the backend is running, then retry.';
  }
  const problem = asProblemDetail(error.error);
  return problem?.detail?.trim() || `${fallback} (HTTP ${error.status}).`;
}

function asProblemDetail(payload: unknown): ProblemDetailDto | null {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'status' in payload &&
    typeof payload.status === 'number'
  ) {
    const detail = 'detail' in payload && typeof payload.detail === 'string'
      ? payload.detail
      : undefined;
    return { status: payload.status, detail };
  }
  return null;
}
