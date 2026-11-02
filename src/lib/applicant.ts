import { z } from "zod";

export const PROFILE_CONTEXT_FIELDS = [
  ["professionalSummary", "Professional summary"],
  ["experience", "Work experience and accomplishments"],
  ["projects", "Projects and examples"],
] as const;
export const PROFILE_CONTEXT_LIMIT = 6000;
export const isProfileContextKey = (key: string) => PROFILE_CONTEXT_FIELDS.some(([candidate]) => candidate === key);
export const profileFieldLimit = (key: string) => isProfileContextKey(key) ? PROFILE_CONTEXT_LIMIT : 500;

export const PROFILE_FIELDS = [
  ["name", "Full name"], ["firstName", "First / given name"], ["lastName", "Last / family name"],
  ["email", "Email"], ["phone", "Phone"], ["location", "City and region"],
  ["city", "City"], ["state", "State / province"], ["postalCode", "Postal code"],
  ["addressLine1", "Street address"], ["addressLine2", "Apartment / address line 2"],
  ["country", "Country"], ["university", "School or university"], ["degree", "Degree"], ["fieldOfStudy", "Field of study"],
  ["minor", "Minor"], ["graduationDate", "Graduation date"],
  ["portfolio", "Portfolio"], ["linkedin", "LinkedIn"], ["github", "GitHub"],
  ...PROFILE_CONTEXT_FIELDS,
] as const;
export type ProfileKey = typeof PROFILE_FIELDS[number][0];
export type ApplicantProfile = Record<ProfileKey, string> & { skills: string[] };
export const EMPTY_PROFILE = Object.fromEntries([
  ...PROFILE_FIELDS.map(([key]) => [key, ""]), ["skills", []],
]) as ApplicantProfile;

const shape = Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, z.string().max(profileFieldLimit(key)).default("")])) as Record<ProfileKey, z.ZodDefault<z.ZodString>>;
export const ApplicantSchema = z.object({ ...shape, skills: z.array(z.string().min(1).max(100)).max(60).default([]) });

export function parseApplicant(value: unknown): ApplicantProfile {
  return ApplicantSchema.parse(value);
}
