// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cleanEmailHtml, oneLine, textOf } from "../../../api/_mcp/html";

/**
 * An email body written by Claude is later opened in the Email page by a
 * person, as HTML. These are the rules for what may be in it.
 */

describe("an email body from Claude", () => {
  it("keeps what the editor itself can make", () => {
    const body = '<p>Hi {{first_name}},</p><p><b>Bold</b> <strong>strong</strong> <i>i</i> <em>em</em> <u>u</u><br>next line</p><ul><li>one</li></ul><ol><li>two</li></ol><p><a href="https://example.test/offer?a=1&amp;b=2">See it</a></p>';
    expect(cleanEmailHtml(body)).toBe(body);
  });

  it("turns plain text into paragraphs", () => {
    expect(cleanEmailHtml("Hi {{first_name}},\n\nLine one\nLine two\n\n5 < 6 & more")).toBe("<p>Hi {{first_name}},</p><p>Line one<br>Line two</p><p>5 &lt; 6 &amp; more</p>");
    expect(cleanEmailHtml("")).toBe("");
    expect(cleanEmailHtml(42)).toBe("");
  });

  it("drops scripts and styles together with what is inside them", () => {
    expect(cleanEmailHtml("<p>a</p><script>alert(1)</script><style>p{color:red}</style><p>b</p>")).toBe("<p>a</p><p>b</p>");
    expect(cleanEmailHtml("<p>a</p><script>alert(1)")).toBe("<p>a</p>");
    expect(cleanEmailHtml("<p>a</p><!-- hidden --><p>b</p>")).toBe("<p>a</p><p>b</p>");
    expect(cleanEmailHtml("<p>a</p><iframe src='https://evil.test'></iframe><svg onload=alert(1)><circle/></svg>")).toBe("<p>a</p>");
  });

  it("never lets a tag keep an attribute, so nothing can run", () => {
    const hostile = [
      '<p onclick="alert(1)" style="x">a</p>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      '<a href=\'https://ok.test/?a=" onmouseover="alert(1)\'>x</a>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      '<b title="1 > 2" onmouseover=alert(1)>x</b>',
      "<scr<script></script>ipt>alert(1)</scr<script></script>ipt>",
      '<form action="https://evil.test"><input name=a></form>',
      "<p>a</p><img src=x onerror=alert(1)",
      '<math><mtext><img src=x onerror=alert(1)></mtext></math>',
    ];
    for (const h of hostile) {
      const out = cleanEmailHtml(h);
      // What is left is only the kept tags, with nothing inside the brackets but the name (and a safe href on a link).
      const tags = out.match(/<[^>]*>/g) ?? [];
      for (const t of tags) expect(t, `${h} -> ${out}`).toMatch(/^<\/?(b|strong|i|em|u|br|p|ul|ol|li|a)>$|^<a href="(https?:\/\/|mailto:)[^"<>]*">$/);
      expect(out, h).not.toMatch(/<script|<img|<svg|<form|<input|javascript:|data:text/i);
    }
    expect(cleanEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(cleanEmailHtml('<a href=\'https://ok.test/?a=" onmouseover="alert(1)\'>x</a>')).toBe('<a href="https://ok.test/?a=&quot; onmouseover=&quot;alert(1)">x</a>');
  });

  it("keeps the words of tags it does not know, and makes headings bold lines", () => {
    expect(cleanEmailHtml("<div><span>Hello</span></div><h2>Offer</h2><table><tr><td>cell</td></tr></table>")).toBe("Hello<br><p><strong>Offer</strong></p>cell<br>");
    expect(cleanEmailHtml("<p>1 < 2 and 3 > 2</p>")).toBe("<p>1 &lt; 2 and 3 &gt; 2</p>");
  });

  it("gives the plain words back for a sample", () => {
    expect(textOf("<p>Hi Sam,</p><p>One<br>Two</p><ul><li>a</li><li>b</li></ul><p>5 &lt; 6 &amp; <a href=\"https://x.test\">link</a></p>")).toBe("Hi Sam,\nOne\nTwo\n- a\n- b\n\n5 < 6 & link");
  });

  it("keeps a subject on one line", () => {
    expect(oneLine("  A quick\r\nquestion\tfor you  ", 300)).toBe("A quick question for you");
    expect(oneLine("x".repeat(400), 300)).toHaveLength(300);
    expect(oneLine(undefined, 300)).toBe("");
    // A cut never leaves half a character behind (an emoji is two units long).
    expect(oneLine("ab\u{1F600}", 3)).toBe("ab\u{1F600}");
    expect(oneLine("ab\u{1F600}cd", 3)).toBe("ab\u{1F600}");
  });

  it("takes out characters that are not text, and stays quick on a body made to be slow", () => {
    expect(cleanEmailHtml("<p>a\u0000b\u0007c</p>")).toBe("<p>abc</p>");
    expect(cleanEmailHtml("a\u0000b\n\nc")).toBe("<p>ab</p><p>c</p>");
    const started = Date.now();
    cleanEmailHtml("<b>" + "<a ".repeat(40_000));
    cleanEmailHtml('<b>' + '<a "'.repeat(30_000));
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
