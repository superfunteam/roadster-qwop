import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Apply the actual configured header values to intercepted HTTPS responses.
// This exercises browser enforcement without posting to X or claiming that a
// local Vite server implements Netlify's routing layer.
const config = await readFile(
  new URL("../netlify.toml", import.meta.url),
  "utf8",
);
const rules = config
  .split("[[headers]]")
  .slice(1)
  .map((block) => {
    const pattern = JSON.parse(block.match(/for\s*=\s*("[^"]+")/)[1]);
    const values = Object.fromEntries(
      [...block.matchAll(/^\s*([\w-]+)\s*=\s*("[^"\n]*")\s*$/gm)]
        .filter((match) => match[1] !== "for")
        .map((match) => [match[1].toLowerCase(), JSON.parse(match[2])]),
    );
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return { path: new RegExp(`^${escaped}$`), values };
  });
function headersFor(path) {
  return Object.assign(
    {},
    ...rules.filter((rule) => rule.path.test(path)).map((rule) => rule.values),
  );
}

for (const [host, allowed] of [
  ["x.com", true],
  ["twitter.com", true],
  ["unrelated.example", false],
  ["x.com.unrelated.example", false],
]) {
  test(`configured frame policy ${allowed ? "permits" : "blocks"} ${host}`, async ({
    page,
  }) => {
    const audio = await readFile(
      new URL("../public/audio/pilot-oh-no.mp3", import.meta.url),
    );
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === host) {
        await route.fulfill({
          contentType: "text/html",
          body: '<iframe title="X media wrapper" src="https://cards-frame.twitter.com/probe"></iframe>',
        });
      } else if (url.hostname === "cards-frame.twitter.com") {
        await route.fulfill({
          contentType: "text/html",
          body: '<iframe title="Game" sandbox="allow-scripts" src="https://roadster.superfun.games/player/"></iframe>',
        });
      } else if (url.pathname === "/player/") {
        await route.fulfill({
          headers: { ...headersFor(url.pathname), "content-type": "text/html" },
          body: '<p id="status">Loading</p><script type="module" src="/assets/probe.js"></script>',
        });
      } else if (url.pathname === "/assets/probe.js") {
        await route.fulfill({
          headers: {
            ...headersFor(url.pathname),
            "content-type": "application/javascript",
          },
          body: 'const r=await fetch("/audio/pilot-oh-no.mp3");const b=await r.arrayBuffer();document.querySelector("#status").textContent=b.byteLength>1000?"Module and sound loaded":"Failed";',
        });
      } else if (url.pathname === "/audio/pilot-oh-no.mp3") {
        await route.fulfill({
          headers: {
            ...headersFor(url.pathname),
            "content-type": "audio/mpeg",
          },
          body: audio,
        });
      } else await route.abort();
    });
    const consoleMessages = [];
    page.on("console", (message) => consoleMessages.push(message.text()));
    await page.goto(`https://${host}/policy-test`);
    if (allowed) {
      const game = page
        .frameLocator('iframe[title="X media wrapper"]')
        .frameLocator('iframe[title="Game"]');
      await expect(game.locator("#status")).toHaveText(
        "Module and sound loaded",
      );
    } else {
      await expect
        .poll(() =>
          consoleMessages.some((message) =>
            message.includes("frame-ancestors"),
          ),
        )
        .toBe(true);
      expect(
        page
          .frames()
          .some(
            (frame) =>
              frame.url() === "https://roadster.superfun.games/player/",
          ),
      ).toBe(false);
    }
  });
}
