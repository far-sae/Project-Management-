// @vitest-environment node
import { describe, expect, it } from "vitest";
import { followUpLink, remindDueFollowUps, reminderMessage } from "../../../../api/_automation/followUps";
import { MEMBER, OWNER, world } from "./helpers";

/**
 * A CRM follow-up with no project used to send nothing when it fell due. The
 * scheduled run now reminds the person it is given to, once.
 */
describe("follow-up reminders", () => {
  const at = (w: ReturnType<typeof world>, hours: number) => new Date(w.now().getTime() + hours * 3600_000).toISOString();

  it("reminds the person a follow-up is given to when it is due today or overdue, once", async () => {
    const w = world();
    const today = w.store.seedFollowUp({ title: "Call Elena about the proposal", dueDate: at(w, 0), assignedTo: MEMBER.id });
    const old = w.store.seedFollowUp({ title: "Send the quote", dueDate: at(w, -72), assignedTo: OWNER.id });
    w.store.seedFollowUp({ title: "Next week's check-in", dueDate: at(w, 24 * 7), assignedTo: MEMBER.id });

    await w.cron();
    const sent = w.store.notifications().filter((n) => n.type === "task_reminder");
    expect(sent.map((n) => [n.userId, n.title, n.link]).sort()).toEqual(
      [
        [MEMBER.id, "Follow-up due", followUpLink(today.id)],
        [OWNER.id, "Follow-up due", followUpLink(old.id)],
      ].sort(),
    );
    expect(sent.find((n) => n.userId === MEMBER.id)?.message).toBe("“Call Elena about the proposal” is due today.");
    expect(sent.find((n) => n.userId === OWNER.id)?.message).toMatch(/^“Send the quote” was due on \d+ \w+ and is still open\.$/);

    // The next runs do not repeat it.
    await w.cron();
    await w.cron();
    expect(w.store.notifications().filter((n) => n.type === "task_reminder")).toHaveLength(2);
  });

  it("leaves alone what needs no reminder", async () => {
    const w = world();
    w.store.seedFollowUp({ title: "Done already", dueDate: at(w, -1), assignedTo: MEMBER.id, open: false });
    w.store.seedFollowUp({ title: "Nobody's", dueDate: at(w, -1), assignedTo: null });
    w.store.seedFollowUp({ title: "No date", dueDate: null, assignedTo: MEMBER.id });
    // A follow-up on a project is reminded by the project's own task, not here.
    w.store.seedFollowUp({ title: "On a project", dueDate: at(w, -1), assignedTo: MEMBER.id, projectId: "0e000000-0000-4000-8000-000000000001" });
    await w.cron();
    expect(w.store.notifications().filter((n) => n.type === "task_reminder")).toEqual([]);
    expect(await remindDueFollowUps(w.store, w.now())).toBe(0);
  });

  it("goes out in a workspace that never set up automation, and never stops the run", async () => {
    const w = world();
    w.store.seedFollowUp({ title: "Ring the dentist back", dueDate: at(w, -2), assignedTo: MEMBER.id });
    // No "ready(w)": automation was never switched on here.
    await w.cron();
    expect(w.store.notifications().filter((n) => n.type === "task_reminder")).toHaveLength(1);

    const broken = world();
    broken.store.seedFollowUp({ title: "x", dueDate: at(broken, -2), assignedTo: MEMBER.id });
    broken.store.dueFollowUps = async () => {
      throw new Error("database down");
    };
    await expect(broken.cron()).resolves.not.toThrow();
  });

  it("says in plain words when it was due", () => {
    const now = new Date("2026-11-21T09:00:00Z");
    expect(reminderMessage({ title: "  Call Elena  ", dueDate: "2026-11-21T16:00:00Z" }, now)).toBe("“Call Elena” is due today.");
    expect(reminderMessage({ title: "Call Elena", dueDate: "2026-11-12T10:00:00Z" }, now)).toBe("“Call Elena” was due on 12 Nov and is still open.");
  });
});
