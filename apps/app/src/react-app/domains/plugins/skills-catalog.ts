export type SkillCategory = "sourcing" | "research";

export type SkillItem = {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  enabled: boolean;
};

export const LEGACY_SKILLS: SkillItem[] = [
  {
    id: "1688-buying",
    name: "1688 Sourcing",
    description:
      "Use image search on the 1688 platform to find matching products and gather supplier leads.",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "supplier-sourcing",
    name: "Product Supplier Sourcing",
    description:
      "Search global procurement platforms for products and suppliers to surface the best source candidates.",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "sales-negotiation",
    name: "Sales Negotiation Expert",
    description:
      "Prepare and guide B2B sales negotiations, including pricing and bargaining strategy.",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "cj-api",
    name: "CJ Dropshipping API Integration",
    description:
      "Integrate the CJ Dropshipping API for product management, inventory tracking, and order sync.",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "product-sourcing",
    name: "Image-based Product Sourcing",
    description:
      "Quickly find similar products, suppliers, and price ranges from images or keywords.",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "listing-optimizer",
    name: "Listing Title Optimizer",
    description:
      "Generate product titles, selling points, and keyword sets optimized for search and conversion.",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "supplier-shortlist",
    name: "Supplier Shortlist",
    description:
      "Compare supplier credentials, pricing, lead times, and risk to produce a shortlist.",
    category: "sourcing",
    enabled: false,
  },
  {
    id: "product-trend-finder",
    name: "Trending Product Discovery",
    description:
      "Combine public market signals and user demand to identify potential breakout product directions.",
    category: "research",
    enabled: false,
  },
  {
    id: "review-summary",
    name: "Review Insights",
    description:
      "Aggregate user reviews to extract pain points, praise drivers, and product improvement ideas.",
    category: "research",
    enabled: false,
  },
  {
    id: "campaign-planner",
    name: "Campaign Planner",
    description:
      "Design marketing campaigns around target audience, channels, and budget.",
    category: "research",
    enabled: false,
  },
  {
    id: "copy-variants",
    name: "Copy Variants",
    description:
      "Generate multi-style copy candidates for products, campaigns, or social content.",
    category: "research",
    enabled: false,
  },
  {
    id: "prd-outline",
    name: "PRD Outline",
    description:
      "Generate a product requirements document structure and key questions from goals and constraints.",
    category: "research",
    enabled: false,
  },
  {
    id: "bug-triage",
    name: "Bug Triage",
    description:
      "Help assess severity, reproduction paths, and initial troubleshooting suggestions.",
    category: "research",
    enabled: false,
  },
  {
    id: "refactor-checklist",
    name: "Refactor Checklist",
    description:
      "Outline pre/post-refactor risks, verification paths, and regression testing suggestions.",
    category: "research",
    enabled: false,
  },
  {
    id: "pr-brief",
    name: "PR Brief",
    description:
      "Summarize merge request changes, risks, and testing recommendations.",
    category: "research",
    enabled: false,
  },
  {
    id: "project-radar",
    name: "Project Radar",
    description:
      "Continuously track project risks, blockers, and key milestone status.",
    category: "research",
    enabled: false,
  },
  {
    id: "ux-critique",
    name: "UX Walkthrough",
    description:
      "Review product experience for usability, information hierarchy, and interaction details.",
    category: "research",
    enabled: false,
  },
  {
    id: "meeting-followup",
    name: "Meeting Follow-up",
    description:
      "Capture meeting outcomes, owners, and follow-up action plans.",
    category: "research",
    enabled: false,
  },
];

export const ALL_SKILLS: SkillItem[] = [...LEGACY_SKILLS];
