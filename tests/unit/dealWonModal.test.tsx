// tests/unit/dealWonModal.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DealWonModal } from "@/components/clients/DealWonModal";

vi.mock("@/services/supabase/deals", () => ({
  closeDealToWon: vi.fn().mockResolvedValue({ dealId: "d1", projectId: "p1" }),
}));
vi.mock("@/services/supabase/projectTemplates", () => ({
  getOrganizationTemplates: vi.fn().mockResolvedValue([
    { templateId: "t1", organizationId: "o1", name: "Onboarding", description: null, taskDefinitions: [], createdAt: new Date() },
  ]),
}));

describe("DealWonModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls closeDealToWon with skip=true when 'Skip' clicked", async () => {
    const { closeDealToWon } = await import("@/services/supabase/deals");
    render(
      <DealWonModal
        deal={{
          dealId: "d1",
          organizationId: "o1",
          clientId: "c1",
          clientName: "Acme",
          title: "Renew",
          ownerId: "u1",
          ownerName: "Faraz",
        } as any}
        targetStage={{ stageId: "swon", isWon: true } as any}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Skip"));
    await waitFor(() => expect(closeDealToWon).toHaveBeenCalledWith("d1", expect.objectContaining({ skip: true })));
  });
});
