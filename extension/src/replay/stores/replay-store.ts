import { writable } from 'svelte/store';
import type { CaptureSession, NetworkRequest, CorrelationBundle } from 'underpixel-shared';
import { type FilterState, EMPTY_FILTERS } from '../lib/search';
import type { EventSection } from '../lib/event-sections';

// ---- Pure functions (exported for testing) ----

/** Find requests whose time range overlaps currentTime */
export function findCallsAtTime(requests: NetworkRequest[], currentTime: number): NetworkRequest[] {
  return requests.filter(
    (r) => r.startTime <= currentTime && (r.endTime ?? r.startTime) >= currentTime,
  );
}

/** Find the event section active at a given absolute time */
export function findActiveEvent(
  sections: EventSection[],
  currentTime: number,
): EventSection | null {
  let active: EventSection | null = null;
  for (const s of sections) {
    if (s.timestamp <= currentTime) {
      active = s;
    } else {
      break;
    }
  }
  return active;
}

// ---- Store shape ----

export interface ReplayState {
  currentTime: number;
  session: CaptureSession | null;
  allRequests: NetworkRequest[];
  bundles: CorrelationBundle[];
  eventSections: EventSection[];
  detailCallId: string | null;
  searchQuery: string;
  filters: FilterState;
  isPlaying: boolean;
}

const initial: ReplayState = {
  currentTime: 0,
  session: null,
  allRequests: [],
  bundles: [],
  eventSections: [],
  detailCallId: null,
  searchQuery: '',
  filters: EMPTY_FILTERS,
  isPlaying: false,
};

export const replayStore = writable<ReplayState>(initial);

// Convenience updaters
export function setCurrentTime(time: number) {
  replayStore.update((s) => ({ ...s, currentTime: time }));
}

export function openDetail(requestId: string | null) {
  replayStore.update((s) => ({ ...s, detailCallId: requestId }));
}

export function closeDetail() {
  replayStore.update((s) => ({ ...s, detailCallId: null }));
}

export function setSearch(query: string) {
  replayStore.update((s) => ({ ...s, searchQuery: query }));
}

export function setFilters(filters: FilterState) {
  replayStore.update((s) => ({ ...s, filters }));
}

export function setPlaying(playing: boolean) {
  replayStore.update((s) => ({ ...s, isPlaying: playing }));
}

export function loadSessionData(
  session: CaptureSession,
  requests: NetworkRequest[],
  bundles: CorrelationBundle[],
  eventSections: EventSection[],
) {
  replayStore.set({
    ...initial,
    session,
    allRequests: requests,
    bundles,
    eventSections,
  });
}
