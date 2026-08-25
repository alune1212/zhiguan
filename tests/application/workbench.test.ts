// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWorkbenchController } from "../../src/application/workbench";

describe("workbench input error ownership", () => {
  it("assigns a missing custom period name to period-custom-label", () => {
    const { result } = renderHook(() => useWorkbenchController({ lifecycleTarget: null }));

    act(() => result.current.start());
    act(() => result.current.setField("comparison-period", "custom"));
    act(() => result.current.confirmInput());

    expect(result.current.inputErrors["comparison-period"]).toBeUndefined();
    expect(result.current.inputErrors["period-custom-label"]).toBe("自定义周期需要一个简短名称。");

    act(() => result.current.setField("period-custom-label", "一季度"));
    expect(result.current.inputErrors["period-custom-label"]).toBeUndefined();

    act(() => result.current.setField("comparison-period", "month"));
    expect(result.current.inputErrors["period-custom-label"]).toBeUndefined();
  });

  it("assigns a missing evidence status to the corresponding evidence control", () => {
    const { result } = renderHook(() => useWorkbenchController({ lifecycleTarget: null }));

    act(() => result.current.start());
    act(() => result.current.setField("income", "10000"));
    act(() => result.current.confirmInput());

    expect(result.current.inputErrors.income).toBeUndefined();
    expect(result.current.inputErrors["income-evidence"]).toBe("请标记这是用户确认的输入还是近似输入。");

    act(() => result.current.setEvidence("income", "estimated"));
    expect(result.current.inputErrors["income-evidence"]).toBeUndefined();
  });
});
