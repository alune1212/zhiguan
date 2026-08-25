// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../src/app/App";
import * as markdownSerializer from "../../src/domain/export/markdown";
import { clearCleanupBlock } from "../../src/adapters/browser/download-lifecycle";

afterEach(() => {
  cleanup();
  clearCleanupBlock();
});

async function startSession() {
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByRole("heading", { name: "先看清这次会话的边界" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
  return user;
}

async function fillCompleteInput(
  user: ReturnType<typeof userEvent.setup>,
  options: { skipWorkHours?: boolean; includeFixedCosts?: boolean; purchasePrice?: string } = {},
) {
  await user.selectOptions(screen.getByRole("combobox", { name: /比较周期/ }), "month");
  await user.type(screen.getByRole("textbox", { name: /币种/ }), "CNY");
  await user.selectOptions(screen.getByRole("combobox", { name: /收入口径/ }), "after-tax");
  await user.type(screen.getByRole("textbox", { name: /同周期收入/ }), "10000");
  await user.selectOptions(screen.getByRole("combobox", { name: "同周期收入的状态" }), "user-confirmed");
  if (!options.skipWorkHours) {
    await user.type(screen.getByRole("textbox", { name: /同周期工作小时/ }), "160");
    await user.selectOptions(screen.getByRole("combobox", { name: "同周期工作小时的状态" }), "user-confirmed");
  }
  await user.type(screen.getByRole("textbox", { name: /购买价格/ }), options.purchasePrice ?? "800");
  await user.selectOptions(screen.getByRole("combobox", { name: "购买价格的状态" }), "user-confirmed");
  await user.click(screen.getByRole("radio", { name: "计入" }));
  if (options.includeFixedCosts) {
    await user.type(screen.getByRole("textbox", { name: /固定成本汇总/ }), "6000");
    await user.selectOptions(screen.getByRole("combobox", { name: "固定成本汇总的状态" }), "user-confirmed");
    await user.selectOptions(screen.getByRole("combobox", { name: /固定成本覆盖范围/ }), "complete");
    await user.type(screen.getByRole("textbox", { name: /覆盖范围说明/ }), "已确认固定成本覆盖范围");
  }
  await user.type(screen.getByRole("textbox", { name: /个人价值期待/ }), "合成体验期待");
}

async function confirmInput(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
  expect(screen.getByRole("heading", { name: "确认口径与状态" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "确认口径与状态" }));
  await user.click(screen.getByRole("button", { name: "确认口径并查看结果" }));
}

describe("purchase decision workbench", () => {
  const verifiedBuild = {
    status: "verified" as const,
    applicationBuild: {
      app_version: "0.1.0",
      git_commit_sha: "a".repeat(40),
      artifact_manifest_sha256: "b".repeat(64),
      config_version: "research-static-config@1.0.0",
    },
    canStartSession: true,
    canExport: true,
    reason: "none" as const,
  };

  const unverifiedBuild = {
    status: "unverified" as const,
    applicationBuild: null,
    canStartSession: false,
    canExport: false,
    reason: "application-build-metadata-invalid" as const,
  };

  const syntheticFileClock = () => ({
    occurredAtUtc: "2026-01-15T00:00:02.000Z",
    recordedAtUtc: "2026-01-15T00:00:02.000Z",
    clockSource: "device-clock",
    timeZoneId: "Etc/UTC",
    utcOffset: "+00:00",
    timeZoneSource: "utc-fallback",
    timeZoneConfirmation: "unconfirmed",
  });

  it("freezes one verified session snapshot and previews JSON independently", async () => {
    const user = userEvent.setup();
    render(<App buildIdentityGate={verifiedBuild} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    expect(screen.getByRole("heading", { name: "记录你的决定" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    expect(screen.getByRole("button", { name: "预览 JSON" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    expect(screen.getByText(/等待确认/)).toBeTruthy();
    expect(screen.getByText(/zhiguan-purchase-decision-.*\.json/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览 Markdown" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "预览 Markdown" }));
    expect(screen.getByText(/zhiguan-purchase-decision-.*\.md/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认并发起 Markdown 下载请求" })).toBeTruthy();
  });

  it("confirms one format synchronously and leaves the other format untouched", async () => {
    const anchor = { href: "", download: "", rel: "", click: () => undefined, remove: () => undefined };
    const listeners = new Map<string, EventListener>();
    const lifecycleListeners = new Set<(event: unknown) => void>();
    const urlApi = {
      createObjectURL: () => "blob:synthetic",
      revokeObjectURL: () => undefined,
    };
    const user = userEvent.setup();
    render(
      <App
        buildIdentityGate={verifiedBuild}
        exportOptions={{
          fileClock: () => ({
            occurredAtUtc: "2026-01-15T00:00:02.000Z",
            recordedAtUtc: "2026-01-15T00:00:02.000Z",
            clockSource: "device-clock",
            timeZoneId: "Etc/UTC",
            utcOffset: "+00:00",
            timeZoneSource: "utc-fallback",
            timeZoneConfirmation: "unconfirmed",
          }),
          downloadEnvironment: {
            document: { createElement: () => anchor } as unknown as Document,
            window: {
              addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
              removeEventListener: (type: string) => listeners.delete(type),
            } as unknown as Window,
            URL: urlApi,
            Blob,
            setTimeout,
          },
          lifecycleTarget: {
            addEventListener: (_type: "pagehide", listener: (event: unknown) => void) => { lifecycleListeners.add(listener); },
            removeEventListener: (_type: "pagehide", listener: (event: unknown) => void) => { lifecycleListeners.delete(listener); },
          },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    await user.click(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" }));
    expect(screen.getByText("已发起下载请求")).toBeTruthy();
    expect(screen.getByText(/页面已发起下载请求；浏览器或设备是否保存/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "预览 Markdown" })).toBeTruthy();
    expect(anchor.download.endsWith(".json")).toBe(true);
    for (const listener of lifecycleListeners) listener(new Event("pagehide"));
    await waitFor(() => expect(screen.getByText("已发起下载请求")).toBeTruthy());
    expect(screen.getByText(/页面已发起下载请求；浏览器或设备是否保存/)).toBeTruthy();
  });

  it("invalidates an existing snapshot when the build gate or application build changes on rerender", async () => {
    const user = userEvent.setup();
    const view = render(<App buildIdentityGate={verifiedBuild} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    expect(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeTruthy();

    const changedBuild = {
      ...verifiedBuild,
      applicationBuild: { ...verifiedBuild.applicationBuild, git_commit_sha: "c".repeat(40) },
    };
    view.rerender(<App buildIdentityGate={changedBuild} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeNull());
    expect(screen.getByRole("button", { name: "打开导出预览" })).toBeTruthy();

    view.rerender(<App buildIdentityGate={unverifiedBuild} />);
    await waitFor(() => expect(screen.getByText("未验证实现预览，不能导出。")).toBeTruthy());
    expect(screen.getByRole("button", { name: "打开导出预览" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps cleanup failure fail-closed across unmount and a later controller request", async () => {
    const anchor = { href: "", download: "", rel: "", click: () => undefined, remove: () => undefined };
    const listeners = new Map<string, EventListener>();
    const failingEnvironment = {
      document: { createElement: () => anchor } as unknown as Document,
      window: {
        addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      } as unknown as Window,
      URL: {
        createObjectURL: () => "blob:cleanup-failure",
        revokeObjectURL: () => { throw new Error("synthetic cleanup failure"); },
      },
      Blob,
      setTimeout: (() => undefined) as unknown as typeof setTimeout,
    };
    const exportOptions = { fileClock: syntheticFileClock, downloadEnvironment: failingEnvironment };
    const user = userEvent.setup();
    const first = render(<App buildIdentityGate={verifiedBuild} exportOptions={exportOptions} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    await user.click(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" }));
    expect(screen.getByText("已发起下载请求")).toBeTruthy();

    first.unmount();
    const second = render(<App buildIdentityGate={verifiedBuild} exportOptions={exportOptions} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    await user.click(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" }));
    expect(screen.getAllByText("导出临时资源未能安全清理，请刷新或关闭当前会话。").length).toBeGreaterThan(0);
    const cleanupAlerts = screen.getAllByRole("alert");
    expect(cleanupAlerts).toHaveLength(1);
    expect(cleanupAlerts[0]?.textContent).toContain("导出临时资源未能安全清理");
    second.unmount();
  });

  it("pauses the whole export surface and clears both previews on a contract breach", async () => {
    const user = userEvent.setup();
    const view = render(<App buildIdentityGate={verifiedBuild} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    await user.click(screen.getByRole("button", { name: "预览 Markdown" }));
    expect(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认并发起 Markdown 下载请求" })).toBeTruthy();

    const breach = {
      ok: false as const,
      error: {
        code: "export-contract-breach" as const,
        message: "导出合同验证失败，当前构建已暂停，请联系研究者处理。",
      },
    };
    const serialized = vi.spyOn(markdownSerializer, "serializeMarkdownSnapshot").mockReturnValue(breach);
    await user.click(screen.getByRole("button", { name: "确认并发起 Markdown 下载请求" }));
    serialized.mockRestore();

    await waitFor(() => expect(screen.getByText("导出合同验证失败，当前构建已暂停，请联系研究者处理。")).toBeTruthy());
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeNull();
    expect(screen.queryByRole("button", { name: "确认并发起 Markdown 下载请求" })).toBeNull();
    expect(screen.queryByText("等待确认")).toBeNull();
    expect(screen.getByRole("button", { name: "打开导出预览" }).hasAttribute("disabled")).toBe(true);
    view.unmount();
  });

  it("invalidates the frozen export snapshot when a decision changes the session revision", async () => {
    const user = userEvent.setup();
    render(<App buildIdentityGate={verifiedBuild} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    expect(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "等待" }));
    await user.type(screen.getByRole("textbox", { name: /依据或尚待确认条件/ }), "继续核对条件");
    await user.click(screen.getByRole("button", { name: "记录我的决定" }));
    expect(screen.queryByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeNull();
    expect(screen.getByRole("button", { name: "打开导出预览" })).toBeTruthy();
  });

  it("keeps a verified export available when a legal result is locally insufficient", async () => {
    const user = userEvent.setup();
    render(<App buildIdentityGate={verifiedBuild} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user, { skipWorkHours: true });
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    expect(screen.getByText(/数据不足仍按不可用结果保留/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeTruthy();
  });

  it("retains one confirmed revision in the shared snapshot without exporting the edit draft", async () => {
    const user = userEvent.setup();
    render(<App buildIdentityGate={verifiedBuild} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "返回修改" }));
    const income = screen.getByRole("textbox", { name: /同周期收入/ });
    await user.clear(income);
    await user.type(income, "11000");
    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
    await user.click(screen.getByRole("button", { name: "重新确认当前输入" }));
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));
    await user.click(screen.getByRole("button", { name: "预览 JSON" }));
    expect(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" })).toBeTruthy();
  });

  it("shows privacy boundary before the first input and keeps exit reachable", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("textbox", { name: /同周期收入/ })).toBeNull();
    expect(screen.getByRole("button", { name: "退出当前会话" })).toBeTruthy();
    expect(screen.getByText(/受控静态托管/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    expect(screen.getByRole("heading", { name: "先放回你的口径" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出当前会话" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "先放回你的口径" }));
  });

  it("reports empty input without manufacturing a result", async () => {
    const user = await startSession();
    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
    expect(screen.getByText(/先填写你愿意用于这次判断的最少信息/)).toBeTruthy();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.queryByText("Income Rate")).toBeNull();
  });

  it("confirms synthetic input and shows five independent result states with evidence", async () => {
    const user = await startSession();
    await fillCompleteInput(user);
    await confirmInput(user);
    expect(screen.getByRole("heading", { name: "理解与推演" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "理解与推演" }));
    expect(screen.getByText("Income Rate")).toBeTruthy();
    expect(screen.getByText("Work-time Equivalent")).toBeTruthy();
    expect(screen.getByText("覆盖范围内可用余量")).toBeTruthy();
    expect(screen.getByText("购买后余量")).toBeTruthy();
    expect(screen.getByText("购买影响")).toBeTruthy();
    const details = screen.getAllByText("查看依据");
    expect(details.length).toBe(5);
    await user.click(details[0]);
    const firstCard = screen.getByRole("article", { name: "Income Rate" });
    expect(within(firstCard).getByText("来源")).toBeTruthy();
    expect(within(firstCard).getByText("公式/规则")).toBeTruthy();
    expect(within(firstCard).getByText(/\(I × Hd\) \/ \(S × Hn\) · 规则版本/)).toBeTruthy();
    expect(within(firstCard).getByText("ruleset-derived（规则内核）")).toBeTruthy();
    expect(within(firstCard).getByText("比较周期")).toBeTruthy();
    expect(within(firstCard).getByText(/月 · period:month/)).toBeTruthy();
  });

  it("composes the complete fixed-cost path without blocking purchase results", async () => {
    const user = await startSession();
    await fillCompleteInput(user, { includeFixedCosts: true, purchasePrice: "1000" });
    await confirmInput(user);

    const purchaseAfterMargin = screen.getByRole("article", { name: "购买后余量" });
    const purchaseImpact = screen.getByRole("article", { name: "购买影响" });
    expect(purchaseAfterMargin.classList.contains("is-available")).toBe(true);
    expect(purchaseImpact.classList.contains("is-available")).toBe(true);
    expect(within(purchaseAfterMargin).queryByText("数据不足")).toBeNull();
    expect(within(purchaseImpact).queryByText("数据不足")).toBeNull();

    await user.click(within(purchaseAfterMargin).getByText("查看依据"));
    await user.click(within(purchaseImpact).getByText("查看依据"));
    for (const card of [purchaseAfterMargin, purchaseImpact]) {
      expect(within(card).queryByText("尚未确认购买是否计入所选周期")).toBeNull();
      expect(within(card).queryByText("规则内核未能完成这项计算")).toBeNull();
    }
  });

  it("keeps empty evidence unconfirmed and shows source/status for every summary field", async () => {
    const user = await startSession();
    await user.selectOptions(screen.getByRole("combobox", { name: /比较周期/ }), "month");
    await user.type(screen.getByRole("textbox", { name: /币种/ }), "CNY");
    await user.selectOptions(screen.getByRole("combobox", { name: /收入口径/ }), "after-tax");
    await user.type(screen.getByRole("textbox", { name: /同周期收入/ }), "10000");
    await user.type(screen.getByRole("textbox", { name: /同周期工作小时/ }), "160");
    await user.type(screen.getByRole("textbox", { name: /购买价格/ }), "800");
    await user.click(screen.getByRole("radio", { name: "计入" }));
    await user.type(screen.getByRole("textbox", { name: /个人价值期待/ }), "合成体验期待");
    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));

    const summary = screen.getByRole("heading", { name: "确认口径与状态" }).closest("section");
    expect(summary).toBeTruthy();
    expect(within(summary as HTMLElement).getAllByText("来源：用户输入").length).toBe(8);
    expect(within(summary as HTMLElement).getAllByText("状态：未标记").length).toBe(3);
    expect(within(summary as HTMLElement).getAllByText("状态：待确认").length).toBe(5);
    expect(within(summary as HTMLElement).queryByText("用户确认")).toBeNull();
  });

  it("associates purchase inclusion and fixed-cost coverage errors with their controls", async () => {
    const user = await startSession();
    await user.type(screen.getByRole("textbox", { name: /购买价格/ }), "800");
    await user.type(screen.getByRole("textbox", { name: /固定成本汇总/ }), "1200");
    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
    await user.click(screen.getByRole("button", { name: "确认口径并查看结果" }));
    await user.click(screen.getByRole("button", { name: "返回修改" }));

    const inclusion = screen.getByRole("group", { name: /是否计入所选周期/ });
    expect(inclusion.getAttribute("aria-invalid")).toBe("true");
    expect(inclusion.getAttribute("aria-describedby")).toBe("purchase-period-inclusion-error");
    const coverage = screen.getByRole("combobox", { name: /固定成本覆盖范围/ });
    expect(coverage.getAttribute("aria-invalid")).toBe("true");
    expect(coverage.getAttribute("aria-describedby")).toBe("fixed-cost-coverage-error");
  });

  it("keeps a safe partial result when work hours are missing", async () => {
    const user = await startSession();
    await fillCompleteInput(user, { skipWorkHours: true });
    await confirmInput(user);
    expect(screen.getByRole("heading", { name: "理解与推演" })).toBeTruthy();
    const incomeRate = screen.getByRole("article", { name: /Income Rate/ });
    expect(within(incomeRate).getAllByText("数据不足").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("数据不足").length).toBeGreaterThanOrEqual(2);
  });

  it("invalidates results when an evidence status is edited, and cancel does not restore old results", async () => {
    const user = await startSession();
    await fillCompleteInput(user);
    await confirmInput(user);
    expect(screen.getByText("62.50 CNY/小时")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.getByRole("heading", { name: "先放回你的口径" })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "同周期收入的状态" }), "estimated");
    await user.click(screen.getByRole("button", { name: "取消这次编辑" }));
    expect(screen.getByText(/旧结果不会恢复/)).toBeTruthy();
    expect(screen.queryByText("62.50 CNY/小时")).toBeNull();
    expect(screen.getByRole("heading", { name: "先放回你的口径" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
    expect(screen.getByRole("heading", { name: "确认口径与状态" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重新确认当前输入" }));
    expect(screen.getByRole("heading", { name: "理解与推演" })).toBeTruthy();
    expect(screen.getAllByText("估算").length).toBeGreaterThan(0);
  });

  it("records all five decision options and an optional product-external review condition", async () => {
    const user = await startSession();
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    expect(screen.getByRole("heading", { name: "记录你的决定" })).toBeTruthy();
    expect(screen.getAllByRole("radio", { name: /购买|等待|调整条件|不购买|暂不决定/ }).length).toBe(5);
    await user.click(screen.getByRole("radio", { name: "暂不决定" }));
    await user.type(screen.getByRole("textbox", { name: /依据或尚待确认条件/ }), "等待更多信息");
    await user.click(screen.getByRole("button", { name: "记录我的决定" }));
    expect(screen.getByText("决定交接已完成")).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: /复盘方式/ }), "condition");
    await user.type(screen.getByRole("textbox", { name: /复盘条件/ }), "使用后回看");
    await user.click(screen.getByRole("button", { name: "记录复盘交接" }));
    expect(screen.getByText("复盘交接条件已记录在当前会话内存中。")).toBeTruthy();
    expect(screen.getByText(/未验证实现预览，不能导出/)).toBeTruthy();
  });

  it("links decision and review errors to the field needing attention", async () => {
    const user = await startSession();
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));

    await user.click(screen.getByRole("button", { name: "记录我的决定" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("group", { name: "决定状态" }).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "购买" }));

    await user.click(screen.getByRole("radio", { name: "购买" }));
    await user.click(screen.getByRole("button", { name: "记录我的决定" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /依据或尚待确认条件/ }));

    await user.type(screen.getByRole("textbox", { name: /依据或尚待确认条件/ }), "先核对条件");
    await user.click(screen.getByRole("button", { name: "记录我的决定" }));
    await user.selectOptions(screen.getByRole("combobox", { name: /复盘方式/ }), "condition");
    await user.click(screen.getByRole("button", { name: "记录复盘交接" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /复盘条件/ }).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /复盘条件/ }));
  });

  it("supports keyboard focus and clears the in-memory session on exit", async () => {
    const user = await startSession();
    await user.tab();
    expect(document.activeElement).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "退出当前会话" }));
    expect(screen.getByRole("heading", { name: "当前页面内存已清除" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "当前页面内存已清除" }));
    await user.click(screen.getByRole("button", { name: "开始新的空白会话" }));
    expect(screen.getByRole("heading", { name: "把一次购买放回你的时间与口径" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "先放回你的口径" }));
    expect(screen.queryByDisplayValue("10000")).toBeNull();
  });

  it("keeps field names exact and exposes hint plus error as descriptions", async () => {
    const user = await startSession();
    const income = screen.getByRole("textbox", { name: "同周期收入" });
    const currency = screen.getByRole("textbox", { name: "币种" });

    expect(screen.queryByRole("textbox", { name: /同周期收入.*正数/u })).toBeNull();
    expect(currency.getAttribute("aria-describedby")).toBe("currency-hint");
    expect(income.getAttribute("aria-describedby")).toBe("income-hint");

    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
    const erroredIncome = screen.getByRole("textbox", { name: "同周期收入" });
    const descriptionIds = (erroredIncome.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);

    expect(erroredIncome.getAttribute("aria-invalid")).toBe("true");
    expect(descriptionIds).toEqual(expect.arrayContaining(["income-hint", "income-error"]));
    expect(descriptionIds.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain("正数");
    expect(descriptionIds.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain("请补充");
  });

  it("focuses the evidence status select when that status is the missing control", async () => {
    const user = await startSession();
    await fillCompleteInput(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "购买价格的状态" }), "");
    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
    await user.click(screen.getByRole("button", { name: "确认口径并查看结果" }));
    expect(screen.getByRole("heading", { name: "理解与推演" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回修改" }));

    const evidence = screen.getByRole("combobox", { name: "购买价格的状态" });
    await waitFor(() => expect(document.activeElement).toBe(evidence));
    expect(evidence.getAttribute("aria-invalid")).toBe("true");
    const descriptionIds = (evidence.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);
    expect(descriptionIds.some((id) => (document.getElementById(id)?.textContent ?? "").includes("请标记"))).toBe(true);
  });

  it("focuses the custom period name when the custom period is incomplete", async () => {
    const user = await startSession();
    await user.selectOptions(screen.getByRole("combobox", { name: "比较周期" }), "custom");
    await user.type(screen.getByRole("textbox", { name: "币种" }), "CNY");
    await user.selectOptions(screen.getByRole("combobox", { name: "收入口径" }), "after-tax");
    await user.type(screen.getByRole("textbox", { name: "同周期收入" }), "10000");
    await user.selectOptions(screen.getByRole("combobox", { name: "同周期收入的状态" }), "user-confirmed");
    await user.type(screen.getByRole("textbox", { name: "同周期工作小时" }), "160");
    await user.selectOptions(screen.getByRole("combobox", { name: "同周期工作小时的状态" }), "user-confirmed");
    await user.type(screen.getByRole("textbox", { name: "购买价格" }), "800");
    await user.selectOptions(screen.getByRole("combobox", { name: "购买价格的状态" }), "user-confirmed");
    await user.click(screen.getByRole("radio", { name: "计入" }));
    await user.type(screen.getByRole("textbox", { name: "个人价值期待" }), "合成体验期待");
    await user.click(screen.getByRole("button", { name: "检查输入与口径" }));
    await user.click(screen.getByRole("button", { name: "确认口径并查看结果" }));
    expect(screen.getByRole("heading", { name: "理解与推演" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回修改" }));

    const customPeriod = screen.getByRole("textbox", { name: "自定义周期名称" });
    await waitFor(() => expect(document.activeElement).toBe(customPeriod));
    expect(customPeriod.getAttribute("aria-invalid")).toBe("true");
    const descriptionIds = (customPeriod.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);
    expect(descriptionIds.some((id) => (document.getElementById(id)?.textContent ?? "").includes("简短名称"))).toBe(true);
  });

  it("announces the current, completed, and not-started stage states", async () => {
    const user = await startSession();
    const navigation = screen.getByRole("navigation", { name: "会话阶段" });
    const statuses = (label: string) => within(navigation).getAllByRole("listitem", { name: new RegExp(label, "u") });

    expect(statuses("当前阶段")).toHaveLength(1);
    expect(statuses("未开始")).toHaveLength(3);

    await fillCompleteInput(user);
    await confirmInput(user);
    expect(statuses("已完成")).toHaveLength(2);
    expect(statuses("当前阶段")).toHaveLength(1);
    expect(statuses("未开始")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    expect(statuses("已完成")).toHaveLength(3);
    expect(statuses("当前阶段")).toHaveLength(1);
  });

  it("keeps focus on a surviving export control through preview, cancel, and confirmation", async () => {
    const user = userEvent.setup();
    render(<App buildIdentityGate={verifiedBuild} />);
    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    await fillCompleteInput(user);
    await confirmInput(user);
    await user.click(screen.getByRole("button", { name: "继续到决定" }));
    await user.click(screen.getByRole("button", { name: "打开导出预览" }));

    const previewJson = screen.getByRole("button", { name: "预览 JSON" });
    await waitFor(() => expect(document.activeElement).toBe(previewJson));
    await user.click(previewJson);
    const confirmJson = screen.getByRole("button", { name: "确认并发起 JSON 下载请求" });
    await waitFor(() => expect(document.activeElement).toBe(confirmJson));

    const previewMarkdown = screen.getByRole("button", { name: "预览 Markdown" });
    await user.click(previewMarkdown);
    const confirmMarkdown = screen.getByRole("button", { name: "确认并发起 Markdown 下载请求" });
    await waitFor(() => expect(document.activeElement).toBe(confirmMarkdown));
    await user.click(screen.getByRole("button", { name: "取消 Markdown 导出" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("已取消")));

    await user.click(screen.getByRole("button", { name: "确认并发起 JSON 下载请求" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("已发起下载请求")));
    expect(screen.getByText("已发起下载请求")).toBeTruthy();
  });
});
