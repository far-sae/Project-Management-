import { UserSubscription } from "./subscription";

export type { UserSubscription };

export interface UserMetrics {
  projectsCreated: number;
  tasksCreated: number;
  lastActiveDate: Date;
}

export interface User {
  userId: string;
  email: string;
  displayName: string;
  photoURL: string;
  provider: "email" | "google" | "apple";
  country: string;
  role: "user" | "admin";
  organizationId: string | null;
  organizationRole: "owner" | "admin" | "member" | null;
  createdAt: Date;
  lastLoginAt: Date;
  subscription: UserSubscription;
  metrics: UserMetrics;
}

export interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}
