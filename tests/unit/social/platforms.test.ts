// @vitest-environment node
// What each platform needs for a post: the boxes it starts with, and what is
// said while something is still missing.
import { describe, expect, it } from "vitest";
import {
  LIMITS, hashtags, mediaNote, postProblems, readTags, startingOptions, youtubeTagsLength,
  type PostMedia, type TikTokOptions, type YouTubeOptions,
} from "../../../api/_social/shared/platforms";

const video: PostMedia = { url: "https://files.example/clip.mp4", kind: "video", mime: "video/mp4", bytes: 12_000_000, name: "clip.mp4" };
const jpeg: PostMedia = { url: "https://files.example/photo.jpg", kind: "image", mime: "image/jpeg", bytes: 400_000, name: "photo.jpg" };
const png: PostMedia = { ...jpeg, mime: "image/png", name: "photo.png" };
const shared = { title: "Five tips for a brighter smile", text: "Our dentist explains what works.", tags: ["Dental care", "tips"] };

describe("tags", () => {
  it("are read from what was typed, without the # and without repeats", () => {
    expect(readTags("#Dental care, tips\nTIPS, , #smile")).toEqual(["Dental care", "tips", "smile"]);
  });

  it("become hashtags for a caption", () => {
    expect(hashtags(["Dental care", "tips", "!!"])).toBe("#Dentalcare #tips");
  });

  it("are counted the way YouTube counts them", () => {
    // "Dental care" has a space, so it is quoted (+2); one comma between the two.
    expect(youtubeTagsLength(["Dental care", "tips"])).toBe(11 + 2 + 4 + 1);
  });
});

describe("what each platform starts with, from what was typed once", () => {
  it("YouTube: a title, a description and tags, and no answer yet about kids", () => {
    expect(startingOptions("youtube", shared)).toEqual({
      title: "Five tips for a brighter smile", description: "Our dentist explains what works.", tags: ["Dental care", "tips"],
      categoryId: "22", privacy: "public", madeForKids: null, notifySubscribers: true,
    });
  });

  it("TikTok: one caption with the hashtags, and nobody chosen yet to see it", () => {
    const o = startingOptions("tiktok", shared);
    expect(o.caption).toBe("Five tips for a brighter smile\n\nOur dentist explains what works.\n\n#Dentalcare #tips");
    expect(o.privacy).toBe("");
    // Duet and Stitch are off until the person turns them on.
    expect([o.allowDuet, o.allowStitch]).toEqual([false, false]);
  });

  it("Instagram and Facebook: the caption; X: the short line, cut to its limit", () => {
    expect(startingOptions("instagram", shared).caption).toContain("#Dentalcare #tips");
    expect(startingOptions("facebook", shared)).toMatchObject({ title: "Five tips for a brighter smile" });
    expect(startingOptions("x", shared).text).toBe("Five tips for a brighter smile\n\n#Dentalcare #tips");
    expect(startingOptions("x", { title: "x".repeat(400), text: "", tags: [] }).text).toHaveLength(LIMITS.xText);
  });

  it("uses the first line of the text as a YouTube title when no title was typed", () => {
    expect(startingOptions("youtube", { title: "", text: "Opening day\nCome and see us.", tags: [] }).title).toBe("Opening day");
  });
});

describe("what is still missing", () => {
  const youtube = (over: Partial<YouTubeOptions> = {}): YouTubeOptions => ({ ...startingOptions("youtube", shared), madeForKids: false, ...over });
  const tiktok = (over: Partial<TikTokOptions> = {}): TikTokOptions => ({ ...startingOptions("tiktok", shared), privacy: "PUBLIC_TO_EVERYONE", ...over });

  it("YouTube needs a video, a title and an answer about kids", () => {
    expect(postProblems("youtube", youtube(), video)).toEqual([]);
    expect(postProblems("youtube", youtube(), jpeg)).toEqual(["YouTube needs a video."]);
    expect(postProblems("youtube", youtube({ title: " " }), video)).toEqual(["YouTube needs a title."]);
    expect(postProblems("youtube", youtube({ madeForKids: null }), video)).toEqual(["Say whether the video is made for kids. YouTube asks this of every video."]);
  });

  it("YouTube keeps to its lengths, and takes no < or >", () => {
    expect(postProblems("youtube", youtube({ title: "t".repeat(103) }), video)).toEqual(["The YouTube title is 3 characters too long (the limit is 100)."]);
    expect(postProblems("youtube", youtube({ title: "Smile <3" }), video)).toEqual(["A YouTube title cannot contain < or >."]);
    expect(postProblems("youtube", youtube({ tags: Array.from({ length: 60 }, (_, n) => `longer tag ${n}`) }), video)[0]).toMatch(/^The YouTube tags together is \d+ characters too long/);
  });

  it("TikTok needs a video and a choice of who can see it", () => {
    expect(postProblems("tiktok", tiktok(), video)).toEqual([]);
    expect(postProblems("tiktok", tiktok({ privacy: "" }), video)).toEqual(["Choose who can see the video on TikTok."]);
    expect(postProblems("tiktok", tiktok(), jpeg)).toEqual(["TikTok needs a video."]);
    expect(postProblems("tiktok", tiktok({ brandContent: true, privacy: "SELF_ONLY" }), video)).toEqual(["A paid partnership on TikTok cannot be set to “Only me”."]);
  });

  it("Instagram needs a file, a JPEG when it is a picture, and at most thirty hashtags", () => {
    const o = startingOptions("instagram", shared);
    expect(postProblems("instagram", o, video)).toEqual([]);
    expect(postProblems("instagram", o, jpeg)).toEqual([]);
    expect(postProblems("instagram", o, null)).toEqual(["Instagram needs a picture or a video."]);
    expect(postProblems("instagram", o, png)).toEqual(["Instagram takes JPEG pictures only. Save the picture as a JPEG and upload it again."]);
    const many = Array.from({ length: 31 }, (_, n) => `#tag${n}`).join(" ");
    expect(postProblems("instagram", { ...o, caption: many }, jpeg)).toEqual(["Instagram allows 30 hashtags in a post."]);
  });

  it("Facebook and X take text alone, a file alone, or both; LinkedIn needs text", () => {
    expect(postProblems("facebook", { message: "", title: "" }, null)).toEqual(["Facebook needs some text, a picture or a video."]);
    expect(postProblems("facebook", { message: "", title: "" }, jpeg)).toEqual([]);
    expect(postProblems("x", { text: "" }, null)).toEqual(["X needs some text, a picture or a video."]);
    expect(postProblems("x", { text: "y".repeat(281) }, null)).toEqual(["The X post is 1 character too long (the limit is 280)."]);
    expect(postProblems("linkedin", { text: " " }, video)).toEqual(["LinkedIn needs some text."]);
  });
});

describe("what happens to the file", () => {
  it("is said for each platform", () => {
    expect(mediaNote("instagram", video)).toBe("Posted as a Reel");
    expect(mediaNote("instagram", jpeg)).toBe("Posted as a picture");
    expect(mediaNote("youtube", video)).toBe("Uploaded as a video");
    expect(mediaNote("linkedin", video)).toBe("The text only. The file is not sent to LinkedIn.");
    expect(mediaNote("x", null)).toBe("Text post");
  });
});
