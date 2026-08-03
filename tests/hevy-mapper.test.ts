import { describe, it, expect } from "vitest";
import {
  mapHevyWorkout,
  type HevyRawWorkout,
} from "../lib/hevy/mapper";

function baseWorkout(overrides: Partial<HevyRawWorkout> = {}): HevyRawWorkout {
  return {
    id: "hevy-workout-1",
    routine_id: "routine-1",
    title: "Morning Workout",
    description: "Felt great today",
    start_time: "2026-08-01T12:00:00Z",
    end_time: "2026-08-01T12:45:00Z",
    exercises: [],
    ...overrides,
  };
}

describe("mapHevyWorkout", () => {
  it("maps a normal workout with one exercise and one set", () => {
    const raw = baseWorkout({
      exercises: [
        {
          index: 0,
          title: "Bench Press (Barbell)",
          notes: "Focused on form",
          exercise_template_id: "D04AC939",
          supersets_id: null,
          sets: [
            {
              index: 0,
              type: "normal",
              weight_kg: 100,
              reps: 5,
              distance_meters: null,
              duration_seconds: null,
              rpe: 8.5,
              custom_metric: null,
            },
          ],
        },
      ],
    });

    const mapped = mapHevyWorkout(raw);

    expect(mapped.workout).toEqual({
      hevy_id: "hevy-workout-1",
      routine_id: "routine-1",
      title: "Morning Workout",
      description: "Felt great today",
      start_time: "2026-08-01T12:00:00Z",
      end_time: "2026-08-01T12:45:00Z",
    });

    expect(mapped.exercises).toHaveLength(1);
    expect(mapped.exercises[0].exercise).toEqual({
      order_index: 0,
      title: "Bench Press (Barbell)",
      notes: "Focused on form",
      exercise_template_id: "D04AC939",
      superset_id: null,
    });
    expect(mapped.exercises[0].sets).toEqual([
      {
        set_index: 0,
        set_type: "normal",
        weight_kg: 100,
        reps: 5,
        distance_meters: null,
        duration_seconds: null,
        rpe: 8.5,
        custom_metric: null,
      },
    ]);
  });

  it("turns an empty workout description and exercise notes into null", () => {
    const raw = baseWorkout({
      description: "",
      exercises: [
        {
          index: 0,
          title: "Squat (Barbell)",
          notes: "",
          sets: [],
        },
      ],
    });

    const mapped = mapHevyWorkout(raw);

    expect(mapped.workout.description).toBeNull();
    expect(mapped.exercises[0].exercise.notes).toBeNull();
  });

  it("passes through null/missing set fields as null instead of undefined", () => {
    const raw = baseWorkout({
      exercises: [
        {
          index: 0,
          title: "Plank",
          sets: [
            {
              index: 0,
              type: "normal",
              // weight_kg, reps, distance_meters, duration_seconds, rpe,
              // custom_metric all omitted, as Hevy does for non-applicable
              // exercise types.
            },
          ],
        },
      ],
    });

    const mapped = mapHevyWorkout(raw);

    expect(mapped.exercises[0].sets[0]).toEqual({
      set_index: 0,
      set_type: "normal",
      weight_kg: null,
      reps: null,
      distance_meters: null,
      duration_seconds: null,
      rpe: null,
      custom_metric: null,
    });
  });

  it("maps multiple exercises, each with multiple sets, preserving order", () => {
    const raw = baseWorkout({
      exercises: [
        {
          index: 0,
          title: "Bench Press (Barbell)",
          supersets_id: 1,
          sets: [
            { index: 0, type: "warmup", weight_kg: 40, reps: 10 },
            { index: 1, type: "normal", weight_kg: 80, reps: 5 },
          ],
        },
        {
          index: 1,
          title: "Overhead Press (Barbell)",
          supersets_id: 1,
          sets: [{ index: 0, type: "normal", weight_kg: 40, reps: 8 }],
        },
      ],
    });

    const mapped = mapHevyWorkout(raw);

    expect(mapped.exercises).toHaveLength(2);
    expect(mapped.exercises[0].exercise.order_index).toBe(0);
    expect(mapped.exercises[0].exercise.superset_id).toBe(1);
    expect(mapped.exercises[0].sets).toHaveLength(2);
    expect(mapped.exercises[0].sets.map((s) => s.set_index)).toEqual([0, 1]);

    expect(mapped.exercises[1].exercise.order_index).toBe(1);
    expect(mapped.exercises[1].sets).toHaveLength(1);
  });
});
