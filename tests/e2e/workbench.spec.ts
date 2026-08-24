import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const APP_PATH = "/";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const REQUIRE_RELEASE_HEADERS = process.env.PLAYWRIGHT_REQUIRE_RELEASE_HEADERS === "1";

type ObservedRequest = {
  readonly url: string;
  readonly resourceType: string;
};

type BrowserAudit = {
  readonly requests: ObservedRequest[];
  readonly consoleMessages: string[];
  readonly pageErrors: string[];
};

type BrowserState = {
  readonly url: string;
  readonly cookie: string;
  readonly localStorage: Record<string, string>;
  readonly sessionStorage: Record<string, string>;
  readonly indexedDb: readonly string[];
  readonly cacheStorage: readonly string[];
  readonly clipboardWrites: number;
};

type TestWindow = Window & {
  __zhiguanClipboardWrites?: number;
};

function monitorPage(page: Page): BrowserAudit {
  const audit: BrowserAudit = { requests: [], consoleMessages: [], pageErrors: [] };
  page.on("request", (request) => {
    audit.requests.push({ url: request.url(), resourceType: request.resourceType() });
  });
  page.on("console", (message) => {
    audit.consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    audit.pageErrors.push(error.message);
  });
  return audit;
}

async function openPage(page: Page, audit: BrowserAudit) {
  // This is a test-only sentinel.  It never writes to the clipboard; it only
  // proves that application code did not attempt to do so.
  await page.addInitScript(() => {
    Object.defineProperty(window, "__zhiguanClipboardWrites", {
      configurable: true,
      writable: true,
      value: 0,
    });
    try {
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === "function") {
        Object.defineProperty(clipboard, "writeText", {
          configurable: true,
          value: async () => {
            (window as TestWindow).__zhiguanClipboardWrites =
              ((window as TestWindow).__zhiguanClipboardWrites ?? 0) + 1;
          },
        });
      }
    } catch {
      // A browser may expose an immutable clipboard object.  The readback
      // below still verifies that the app never asked for clipboard access.
    }
  });
  const response = await page.goto(APP_PATH, { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);
  expect(await page.title()).toBe("值观 · 购买决策工作台");
  expect(new URL(page.url()).pathname).toBe(APP_PATH);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  await expect(page.getByRole("heading", { name: "先看清这次会话的边界" })).toBeVisible();

  const headers = response?.headers() ?? {};
  const securityHeaders = {
    cacheControl: headers["cache-control"] ?? "",
    contentSecurityPolicy: headers["content-security-policy"] ?? "",
    referrerPolicy: headers["referrer-policy"] ?? "",
    contentType: headers["content-type"] ?? "",
    contentTypeOptions: headers["x-content-type-options"] ?? "",
  };
  test.info().annotations.push({
    type: "response-boundary",
    description: JSON.stringify(securityHeaders),
  });
  expect(securityHeaders.contentType).toContain("text/html");
  if (REQUIRE_RELEASE_HEADERS) {
    expect(securityHeaders.cacheControl).toBe("no-store");
    expect(securityHeaders.contentSecurityPolicy).toContain("default-src 'self'");
    expect(securityHeaders.contentSecurityPolicy).toContain("connect-src 'none'");
    expect(securityHeaders.contentSecurityPolicy).toContain("script-src 'self'");
    expect(securityHeaders.referrerPolicy).toBe("no-referrer");
    expect(securityHeaders.contentTypeOptions).toBe("nosniff");
  } else {
    // The requested baseline is `npm run dev`; Vite's dev response exposes
    // no release CSP/header carrier.  Keep that fact explicit so a dev green
    // run cannot be mistaken for release-header evidence.
    expect(securityHeaders.cacheControl).toMatch(/no-cache|no-store/);
    expect(securityHeaders.contentSecurityPolicy).toBe("");
    expect(securityHeaders.referrerPolicy).toBe("");
    expect(await page.locator('meta[name="referrer"]').getAttribute("content")).toBe(
      "no-referrer",
    );
  }

  // Give the dev client one tick to attempt its HMR connection, then ensure
  // every observed request remains on the explicit loopback origin.
  await page.waitForTimeout(150);
  expect(audit.requests.length).toBeGreaterThan(0);
  assertOnlyLoopbackRequests(audit.requests);
}

function assertOnlyLoopbackRequests(requests: readonly ObservedRequest[]) {
  for (const request of requests) {
    const parsed = new URL(request.url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      expect(LOOPBACK_HOSTS.has(parsed.hostname), request.url).toBe(true);
      expect(parsed.port, request.url).toBe("4173");
    } else if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
      // Vite HMR is a local development-only websocket.  It is not accepted
      // as release evidence; it is merely allowed here so the test can run
      // against the requested dev baseline.
      expect(LOOPBACK_HOSTS.has(parsed.hostname), request.url).toBe(true);
      expect(parsed.port, request.url).toBe("4173");
    } else {
      throw new Error(`unexpected-network-protocol:${parsed.protocol}`);
    }
    expect(request.url).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/u);
  }
}

async function readBrowserState(page: Page): Promise<BrowserState> {
  return page.evaluate(async () => {
    const readStorage = (storage: Storage): Record<string, string> =>
      Object.fromEntries(Object.keys(storage).map((key) => [key, storage.getItem(key) ?? ""]));
    const databases = typeof indexedDB.databases === "function"
      ? await indexedDB.databases()
      : [];
    const cacheStorage = typeof caches === "undefined" ? [] : await caches.keys();
    return {
      url: window.location.href,
      cookie: document.cookie,
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage),
      indexedDb: databases.map((database) => database.name ?? ""),
      cacheStorage,
      clipboardWrites: (window as TestWindow).__zhiguanClipboardWrites ?? 0,
    };
  });
}

async function assertNoBrowserPersistence(page: Page, audit: BrowserAudit) {
  const state = await readBrowserState(page);
  expect(await page.context().cookies()).toEqual([]);
  expect(state.cookie).toBe("");
  expect(state.localStorage).toEqual({});
  expect(state.sessionStorage).toEqual({});
  expect(state.indexedDb).toEqual([]);
  expect(state.cacheStorage).toEqual([]);
  expect(state.clipboardWrites).toBe(0);
  expect(new URL(state.url).search).toBe("");
  expect(new URL(state.url).hash).toBe("");
  const unexpectedConsoleMessages = audit.consoleMessages.filter(
    (message) =>
      !message.startsWith("debug: [vite]") &&
      !message.includes("React DevTools for a better development experience"),
  );
  expect(unexpectedConsoleMessages).toEqual([]);
  expect(audit.consoleMessages.filter((message) => /^(error|warning):/u.test(message))).toEqual([]);
  expect(audit.pageErrors).toEqual([]);
  assertOnlyLoopbackRequests(audit.requests);
}

async function assertA11y(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, results.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
}

async function startSession(page: Page) {
  const start = page.getByRole("button", { name: "我了解，开始输入" });
  await start.focus();
  await start.press("Enter");
  await expect(page.getByRole("heading", { name: "先放回你的口径" })).toBeVisible();
}

async function fillCompleteSyntheticInput(page: Page) {
  await page.getByRole("combobox", { name: /比较周期/ }).selectOption("month");
  await page.getByRole("textbox", { name: /币种/ }).fill("CNY");
  await page.getByRole("combobox", { name: /收入口径/ }).selectOption("after-tax");
  await page.getByRole("textbox", { name: /同周期收入/ }).fill("10000");
  await page.getByRole("combobox", { name: "同周期收入的状态" }).selectOption("user-confirmed");
  await page.getByRole("textbox", { name: /同周期工作小时/ }).fill("160");
  await page.getByRole("combobox", { name: "同周期工作小时的状态" }).selectOption("user-confirmed");
  await page.getByRole("textbox", { name: /购买价格/ }).fill("800");
  await page.getByRole("combobox", { name: "购买价格的状态" }).selectOption("user-confirmed");
  await page.getByRole("radio", { name: "计入", exact: true }).check();
  await page.getByRole("textbox", { name: /个人价值期待/ }).fill("合成体验期待");
}

async function proceedToUnderstanding(page: Page) {
  await page.getByRole("button", { name: "检查输入与口径" }).click();
  await expect(page.getByRole("heading", { name: "确认口径与状态" })).toBeVisible();
  await page.getByRole("button", { name: "确认口径并查看结果" }).click();
  await expect(page.getByRole("heading", { name: "理解与推演" })).toBeVisible();
}

async function proceedToDecision(page: Page) {
  await page.getByRole("button", { name: "继续到决定" }).click();
  await expect(page.getByRole("heading", { name: "记录你的决定" })).toBeVisible();
}

async function installVerifiedCarrier(page: Page) {
  // This is a browser-test carrier injection only.  Production startup and
  // export code still validate the same four fixed carriers fail-closed.
  await page.addInitScript(() => {
    const values: Record<string, string> = {
      "application-build-app-version": "0.1.0",
      "application-build-git-commit-sha": "a".repeat(40),
      "artifact-manifest-sha256": "b".repeat(64),
      "application-build-config-version": "research-static-config@1.0.0",
    };
    const applyCarriers = () => {
      let applied = 0;
      for (const [name, content] of Object.entries(values)) {
        const carrier = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
        if (carrier) {
          carrier.content = content;
          applied += 1;
        }
      }
      return applied === Object.keys(values).length;
    };
    if (applyCarriers()) return;
    const observer = new MutationObserver(() => {
      if (applyCarriers()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

test.describe("local research workbench browser boundary", () => {
  test("captures the local response boundary and accessible privacy entry", async ({ page }) => {
    const audit = monitorPage(page);
    await openPage(page, audit);
    await assertA11y(page);
    expect(await page.getByRole("main").innerText()).toContain("浏览器内存");
    await assertNoBrowserPersistence(page, audit);
  });

  test("runs a synthetic main flow with keyboard and pagehide cleanup", async ({ page }) => {
    const audit = monitorPage(page);
    await openPage(page, audit);
    await startSession(page);
    await fillCompleteSyntheticInput(page);

    const focusedBeforeTab = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["INPUT", "TEXTAREA"]).toContain(focusedBeforeTab);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).not.toBe("BODY");

    await proceedToUnderstanding(page);
    for (const resultName of [
      "Income Rate",
      "Work-time Equivalent",
      "覆盖范围内可用余量",
      "购买后余量",
      "购买影响",
    ]) {
      await expect(page.getByRole("article", { name: resultName })).toBeVisible();
    }
    await proceedToDecision(page);
    await expect(page.getByText("未验证实现预览，不能导出。")).toBeVisible();
    await expect(page.getByRole("button", { name: "打开导出预览" })).toBeDisabled();

    const undecided = page.getByRole("radio", { name: "暂不决定" });
    await undecided.press("Space");
    await expect(undecided).toBeChecked();
    await page.getByRole("textbox", { name: /依据或尚待确认条件/ }).fill("合成测试条件");
    const recordDecision = page.getByRole("button", { name: "记录我的决定" });
    await recordDecision.focus();
    await recordDecision.press("Enter");
    await expect(page.getByText("决定交接已完成")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(APP_PATH);

    await assertA11y(page);
    await assertNoBrowserPersistence(page, audit);

    await page.evaluate(() => {
      const event = document.createEvent("Event");
      event.initEvent("pagehide", false, false);
      window.dispatchEvent(event);
    });
    await expect(page.getByRole("heading", { name: "当前页面内存已清除" })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "先看清这次会话的边界" })).toBeVisible();
    await assertNoBrowserPersistence(page, audit);
  });

  test("keeps empty and invalid synthetic input in a local failure state", async ({ page }) => {
    const audit = monitorPage(page);
    await openPage(page, audit);
    await startSession(page);
    await page.getByRole("button", { name: "检查输入与口径" }).click();
    await expect(page.getByText("先填写你愿意用于这次判断的最少信息")).toBeVisible();
    await expect(page.getByText("Income Rate")).not.toBeVisible();

    await page.getByRole("textbox", { name: /同周期收入/ }).fill("-1");
    await page.getByRole("button", { name: "检查输入与口径" }).click();
    await expect(page.getByRole("heading", { name: "确认口径与状态" })).toBeVisible();
    await page.getByRole("button", { name: "确认口径并查看结果" }).click();
    await expect(page.getByRole("heading", { name: "理解与推演" })).toBeVisible();
    await expect(page.getByText("数据不足").first()).toBeVisible();
    await expect(page.getByText("Income Rate")).toBeVisible();
    await assertA11y(page);
    await assertNoBrowserPersistence(page, audit);
  });

  test("keeps the narrow layout inside the viewport", async ({ page }, testInfo) => {
    const audit = monitorPage(page);
    await openPage(page, audit);
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowX: getComputedStyle(document.documentElement).overflowX,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.overflowX).not.toBe("scroll");
    testInfo.annotations.push({ type: "viewport", description: testInfo.project.name });
    await startSession(page);
    await expect(page.getByRole("heading", { name: "先放回你的口径" })).toBeFocused();
    await assertA11y(page);
    await assertNoBrowserPersistence(page, audit);
  });

  test("allows only an explicit synthetic local download with a verified test carrier", async ({ page }) => {
    await installVerifiedCarrier(page);
    const audit = monitorPage(page);
    await openPage(page, audit);
    await startSession(page);
    await fillCompleteSyntheticInput(page);
    await proceedToUnderstanding(page);
    await proceedToDecision(page);

    const openExport = page.getByRole("button", { name: "打开导出预览" });
    await expect(openExport).toBeEnabled();
    await openExport.click();
    await expect(page.getByRole("button", { name: "预览 JSON" })).toBeVisible();
    await expect(page.getByRole("button", { name: "预览 Markdown" })).toBeVisible();

    await page.getByRole("button", { name: "预览 JSON" }).click();
    await expect(page.getByText("等待确认")).toBeVisible();
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await page.getByRole("button", { name: "确认并发起 JSON 下载请求" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^zhiguan-purchase-decision-\d{8}T\d{6}Z\.json$/u);
    await expect(page.getByText("页面已发起下载请求；浏览器或设备是否保存、最终名称和位置未知。")).toBeVisible();

    await page.getByRole("button", { name: "预览 Markdown" }).click();
    await expect(page.getByText("等待确认")).toBeVisible();
    await page.getByRole("button", { name: "取消 Markdown 导出" }).click();
    await expect(page.getByText("已取消本格式导出；当前会话保持不变。")).toBeVisible();
    await assertNoBrowserPersistence(page, audit);
  });
});
