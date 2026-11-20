/** Mode-aware labour task lists for Labour Management. */
export const PET_LABOUR_TASKS = [
  "PET sorting",
  "PET loading",
  "Red bottle cap removal",
  "Bale creation",
] as const;

export const PLASTIC_LABOUR_TASKS = [
  "Plastic sorting",
  "Plastic loading",
  "Plastic grinding",
] as const;

/** Legacy labels kept so older labour rows still validate on edit. */
const LEGACY_LABOUR_TASKS = [
  "Cap Removal",
  "Sorting",
  "Loading",
  "Other",
] as const;

/** Union used by API zod enums (accept either mode's tasks + legacy). */
export const LABOUR_TASKS = Array.from(
  new Set([
    ...PET_LABOUR_TASKS,
    ...PLASTIC_LABOUR_TASKS,
    ...LEGACY_LABOUR_TASKS,
  ])
) as [string, ...string[]];

export const ALL_LABOUR_TASKS = LABOUR_TASKS;

export type LabourTask = (typeof LABOUR_TASKS)[number];

export function labourTasksForMode(mode: "PET" | "PLASTIC") {
  return mode === "PLASTIC" ? [...PLASTIC_LABOUR_TASKS] : [...PET_LABOUR_TASKS];
}
