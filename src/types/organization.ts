export type OrganizationStatus = "active" | "suspended" | "pending";

// Update this to match subscription tiers
export type OrganizationTier = "starter" | "basic" | "advanced" | "premium";

export interface OrganizationSubscription {
  tier: OrganizationTier; // Use the updated type
  seats: number;
  startDate: Date;
  endDate: Date | null;
  status: "active" | "trial" | "expired" | "cancelled";
  trialEndDate?: Date;
  paymentMethod?: string;
  autoRenew: boolean;
}

export interface OrganizationSettings {
  timezone: string;
  currency: string;
  locale: string;
  branding: {
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
  features: {
    aiEnabled: boolean;
    fileUploadsEnabled: boolean;
    advancedAnalytics: boolean;
  };
}

export interface OrganizationMember {
  userId: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: "owner" | "admin" | "member" | "viewer";
  joinedAt: Date;
  status: "active" | "invited" | "removed";
  addedAt?: Date | string;
}

export interface OrganizationMetrics {
  totalProjects: number;
  totalTasks: number;
  totalMembers: number;
  totalFiles: number;
  storageUsed: number;
  activeUsers: number;
}

export interface Organization {
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  logoUrl?: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  createdAt: Date;
  updatedAt: Date;
  status: OrganizationStatus;
  subscription: OrganizationSubscription;
  settings: OrganizationSettings;
  members: OrganizationMember[];
  metrics: OrganizationMetrics;
  country?: string;
}

export interface CreateOrganizationInput {
  name: string;
  description?: string;
  country?: string;
  timezone?: string;
  currency?: string;
  logoFile?: File;
  ownerId: string;
  ownerEmail: string;
  ownerDisplayName: string;
  ownerPhotoURL?: string;
  subscriptionTier?: OrganizationTier; // Add this
  trialEndsAt?: Date | null; // Add this
}

export interface UpdateOrganizationInput {
  name?: string;
  description?: string;
  logoFile?: File;
  settings?: Partial<OrganizationSettings>;
  members?: OrganizationMember[];
  subscription?: Partial<OrganizationSubscription>; // Add this
  /** ISO-3166 alpha-2 country code (e.g. "GB"). Drives default currency. */
  country?: string;
}
