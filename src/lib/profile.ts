import type { UserProfile } from "./types";

/**
 * The single place to edit demo profile data.
 * SCREENMATE only ever fills form fields from values that exist here.
 */
export const userProfile: UserProfile = {
  name: "Viren Chauhan",
  email: "viren@example.com",
  university: "SCAD",
  degree: "BFA Game Design",
  minor: "Applied AI",
  graduationDate: "2027",
  portfolio: "https://virenchauhan.com",
  linkedin: "https://linkedin.com/in/example",
  location: "Atlanta, Georgia",
  skills: [
    "React",
    "TypeScript",
    "Python",
    "Unreal Engine",
    "Unity",
    "AI integrations",
  ],
};
