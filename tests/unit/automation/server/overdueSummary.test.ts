// @vitest-environment node
import { describe, expect, it } from "vitest";
import { overdueLink, overdueMessage, remindOverdueDaily } from "../../../../api/_automation/followUps";
import { MEMBER, OWNER, world } from "./helpers";

/**
 * A follow-up is reminded once, on the day it is due. After that nothing said
 * it was still open, so an overdue follow-up was easy to forget for good. Each
 * morning the person now gets one line about everything overdue.
 */
describe("the morning line about overdue follow-ups", () => {
  const summaries = (w: ReturnType<typeof world>) => w.store.notifications().filter((n) => n.title === "Overdue follow-ups");

  it("goes once a day to each person with something overdue, and names the oldest", async () => {
    const w = world();
    w.setNow("2026-11-20T08:00:00.000Z");
    w.store.seedFollowUp({ title: "Send the quote", dueDate: "2026-11-12T10:00:00.000Z", assignedTo: MEMBER.id });
    w.store.seedFollowUp({ title: "Call Elena", dueDate: "2026-11-19T10:00:00.000Z", assignedTo: MEMBER.id });
    w.store.seedFollowUp({ title: "Ring the dentist", dueDate: "2026-11-20T10:00:00.000Z", assignedTo: OWNER.id });
    // The day they are first seen each gets its own reminder, and no morning line on top.
    await w.cron();
    expect(w.store.notifications().filter((n) => n.title === "Follow-up due")).toHaveLength(3);
    expect(summaries(w)).toEqual([]);

    w.setNow("2026-11-21T08:00:00.000Z");
    // Due today is not overdue: it has its own reminder.
    w.store.seedFollowUp({ title: "Today's call", dueDate: "2026-11-21T15:00:00.000Z", assignedTo: OWNER.id });
    await w.cron();
    expect(summaries(w).map((n) => [n.userId, n.message, n.link]).sort()).toEqual(
      [
        [MEMBER.id, "2 follow-ups are overdue. The oldest is “Send the quote”, due 12 Nov.", overdueLink("2026-11-21", MEMBER.id)],
        [OWNER.id, "“Ring the dentist” has been open since 20 Nov.", overdueLink("2026-11-21", OWNER.id)],
      ].sort(),
    );

    // Not again today, whatever the number of runs.
    await w.cron();
    w.advance(6 * 3600_000);
    await w.cron();
    expect(summaries(w)).toHaveLength(2);

    // Tomorrow morning it comes again, because they are still open.
    w.setNow("2026-11-22T07:05:00.000Z");
    await w.cron();
    expect(summaries(w)).toHaveLength(4);
  });

  it("waits for the morning, and says nothing to people with nothing overdue", async () => {
    const w = world();
    w.store.seedFollowUp({ title: "Send the quote", dueDate: "2026-11-12T10:00:00.000Z", assignedTo: MEMBER.id });
    const done = w.store.seedFollowUp({ title: "Done later", dueDate: "2026-11-12T10:00:00.000Z", assignedTo: OWNER.id });
    w.setNow("2026-11-20T09:00:00.000Z");
    await w.cron();
    done.open = false;
    w.setNow("2026-11-21T03:00:00.000Z");
    await w.cron();
    expect(summaries(w)).toEqual([]);
    w.setNow("2026-11-21T07:00:00.000Z");
    await w.cron();
    expect(summaries(w).map((n) => n.userId)).toEqual([MEMBER.id]);
  });

  it("never stops the run it is part of", async () => {
    const w = world();
    w.setNow("2026-11-20T08:00:00.000Z");
    w.store.seedFollowUp({ title: "x", dueDate: "2026-11-12T10:00:00.000Z", assignedTo: MEMBER.id });
    await w.cron();
    w.setNow("2026-11-21T08:00:00.000Z");
    w.store.notify = async () => { throw new Error("database down"); };
    await expect(w.cron()).resolves.not.toThrow();
    await expect(remindOverdueDaily(w.store, w.now())).rejects.toThrow();
  });

  it("says it in plain words", () => {
    expect(overdueMessage([{ title: " Send the quote ", dueDate: "2026-11-12T10:00:00.000Z" }])).toBe("“Send the quote” has been open since 12 Nov.");
    expect(overdueMessage([{ title: "A", dueDate: "2026-11-12T10:00:00.000Z" }, { title: "B", dueDate: "2026-11-15T10:00:00.000Z" }, { title: "C", dueDate: "2026-11-18T10:00:00.000Z" }]))
      .toBe("3 follow-ups are overdue. The oldest is “A”, due 12 Nov.");
  });
});
