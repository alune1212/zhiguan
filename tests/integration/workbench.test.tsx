// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../../src/app/App";

afterEach(() => cleanup());

describe("workbench application composition", () => {
  it("binds pagehide to clearing the active in-memory session", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "我了解，开始输入" }));
    expect(screen.getByRole("heading", { name: "先放回你的口径" })).toBeTruthy();

    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "当前页面内存已清除" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "开始新的空白会话" }));
    expect(screen.getByRole("heading", { name: "先放回你的口径" })).toBeTruthy();

    // A bfcache-style return keeps the lifecycle binding alive.  A subsequent
    // pagehide must still clear the newly started in-memory session.
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "当前页面内存已清除" })).toBeTruthy();
    });
  });
});
