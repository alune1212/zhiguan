import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IncomeApp } from "../src/app/IncomeApp";

describe("IncomeApp first use", () => {
  it("starts with only monthly take-home income and shows the folded, local estimate defaults", () => {
    const html = renderToStaticMarkup(<IncomeApp />);
    const form = html.match(/<form class="income-form"[\s\S]*?<\/form>/u)?.[0];
    const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    expect(form).toBeDefined();
    expect(form).toMatch(/<input\b(?=[^>]*\bid="income-monthly")(?=[^>]*\bname="income")(?=[^>]*\binputMode="decimal")(?=[^>]*\bvalue="")[^>]*>/u);
    expect(form).toContain("只填这一项也能开始");
    expect(form).toContain("默认按周一至周五（双休），每天 09:00–12:00、13:00–18:00（合计 8 小时）");
    expect(form).toContain(`时区 ${deviceTimeZone} 估算`);
    expect(form).toContain("资料仅保存在此浏览器中；清除浏览器数据可能会丢失。");

    expect(form).toContain('data-slot="collapsible"');
    expect(form).toContain('aria-expanded="false"');
    expect(form).toContain("展开详细设置");
    expect(form).not.toContain("每周工作日");
    expect(form).not.toContain("特殊日期");
    expect(form).toContain("保存并开始");
    expect(html).toContain("导入备份");
    expect(html).toContain("没有购买计划也可以直接使用。");
    expect(html).not.toContain('name="purchaseAmount"');
    expect(html).not.toContain('name="fixedExpenses"');
    expect(html).not.toContain("整理这句话");
  });
});
