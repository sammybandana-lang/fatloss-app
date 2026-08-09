import type { HevyRawWorkout } from "./mapper";

const HEVY_API_BASE_URL = "https://api.hevyapp.com/v1";
const PAGE_SIZE = 10; // Hevy's documented maximum
const REQUEST_TIMEOUT_MS = 15_000;

interface HevyWorkoutsPage {
  page: number;
  page_count: number;
  workouts: HevyRawWorkout[];
}

function getApiKey(): string {
  const apiKey = process.env.HEVY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "HEVY_API_KEY is not set. Add it to your server environment before syncing Hevy workouts.",
    );
  }
  return apiKey;
}

async function fetchWorkoutsPage(
  apiKey: string,
  page: number,
): Promise<HevyWorkoutsPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${HEVY_API_BASE_URL}/workouts?page=${page}&pageSize=${PAGE_SIZE}`,
      { headers: { "api-key": apiKey }, signal: controller.signal },
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Hevy API request timed out after ${REQUEST_TIMEOUT_MS}ms (page ${page}).`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(
      `Hevy API request failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as HevyWorkoutsPage;
}

/** Fetches every workout from Hevy, following pagination until pages run out. */
export async function fetchAllHevyWorkouts(): Promise<HevyRawWorkout[]> {
  const apiKey = getApiKey();
  const workouts: HevyRawWorkout[] = [];
  let page = 1;

  for (;;) {
    const result = await fetchWorkoutsPage(apiKey, page);
    workouts.push(...result.workouts);

    if (result.workouts.length === 0 || page >= result.page_count) {
      break;
    }
    page += 1;
  }

  return workouts;
}

/**
 * Fetches only the single most recent page of workouts from Hevy (the API
 * returns workouts newest-first), rather than paging through the caller's
 * entire history. Used for routine syncs where only recently-logged
 * workouts are expected to be new; `fetchAllHevyWorkouts` remains
 * available for a full resync.
 */
export async function fetchRecentHevyWorkouts(): Promise<HevyRawWorkout[]> {
  const apiKey = getApiKey();
  const result = await fetchWorkoutsPage(apiKey, 1);
  return result.workouts;
}
