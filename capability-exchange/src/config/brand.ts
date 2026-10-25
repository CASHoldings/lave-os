/**
 * All product naming lives here so the working name can be changed in one place.
 * "African Capability Exchange" and the module names are working names:
 * availability and trademark checks are still outstanding.
 */
export const brand = {
  name: "African Capability Exchange",
  shortName: "ACE",
  tagline: "Connecting African expertise with opportunity.",
  /** Inclusive positioning: talent across Africa and its diaspora, opportunities in Africa and globally. */
  positioning:
    "For professionals across Africa and its diaspora, connected to opportunities within Africa and around the world.",
  modules: {
    profile: { name: "Living Profile", description: "Each professional's evolving record of what they can do and how they work." },
    evidence: { name: "Evidence Portfolio", description: "Projects, contributions and achievements, with clear evidence and verification labels." },
    opportunities: { name: "Opportunities", description: "Employment, projects, fractional roles and advisory engagements." },
  },
  supportEmail: "support@example.invalid",
  workingNameNotice: "Working name. Availability and trademark checks are outstanding.",
} as const;

export type Brand = typeof brand;
