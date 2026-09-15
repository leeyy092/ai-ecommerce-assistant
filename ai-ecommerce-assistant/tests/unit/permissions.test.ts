import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  canImport,
  canViewDashboard,
  csAlertVisible,
  hasCapability,
  INVITABLE_ROLES,
  projectForRole,
  ROLE_CAPABILITIES,
  type Role,
} from "@/services/access/permissions";

const ROLES: Role[] = ["owner", "admin", "operator", "customer_service"];

describe("TASK-004｜固定能力矩阵（02_USER_ROLES）", () => {
  it("经营数据/商品数据：O/A/P 允许，C 拒绝（含 Dashboard 类入口）", () => {
    for (const role of ["owner", "admin", "operator"] as Role[]) {
      expect(hasCapability(role, CAPABILITIES.viewBusinessData)).toBe(true);
      expect(hasCapability(role, CAPABILITIES.viewProductData)).toBe(true);
      expect(canViewDashboard(role)).toBe(true);
    }
    expect(hasCapability("customer_service", CAPABILITIES.viewBusinessData)).toBe(false);
    expect(hasCapability("customer_service", CAPABILITIES.viewProductData)).toBe(false);
    expect(canViewDashboard("customer_service")).toBe(false);
  });

  it("设置/组织管理：仅 O/A", () => {
    for (const role of ROLES) {
      const allowed = role === "owner" || role === "admin";
      expect(hasCapability(role, CAPABILITIES.manageSettings)).toBe(allowed);
      expect(hasCapability(role, CAPABILITIES.manageOrgInfo)).toBe(allowed);
    }
  });

  it("导入范围：C 仅 customer_messages", () => {
    const kinds = [
      "products",
      "orders",
      "order_items",
      "ads",
      "customer_messages",
      "after_sales",
    ] as const;
    for (const role of ["owner", "admin", "operator"] as Role[]) {
      for (const kind of kinds) expect(canImport(role, kind)).toBe(true);
    }
    for (const kind of kinds) {
      expect(canImport("customer_service", kind)).toBe(kind === "customer_messages");
    }
  });

  it("邀请范围：O→A/P/C；A→P/C；P/C 无", () => {
    expect([...INVITABLE_ROLES.owner].sort()).toEqual(["admin", "customer_service", "operator"]);
    expect([...INVITABLE_ROLES.admin].sort()).toEqual(["customer_service", "operator"]);
    expect(INVITABLE_ROLES.operator.size).toBe(0);
    expect(INVITABLE_ROLES.customer_service.size).toBe(0);
  });

  it("矩阵完整性：每个角色都有客服可见与本人行动状态能力", () => {
    for (const role of ROLES) {
      expect(ROLE_CAPABILITIES[role].has(CAPABILITIES.viewCustomerServiceData)).toBe(true);
      expect(ROLE_CAPABILITIES[role].has(CAPABILITIES.manageOwnActionState)).toBe(true);
    }
  });
});

describe("TASK-004｜客服投影", () => {
  it("csAlertVisible：仅 R08 两子通道与 R09；R03/R10 即使售后类也拒绝（F04）", () => {
    expect(csAlertVisible("R08", "after_sales_case")).toBe(true);
    expect(csAlertVisible("R08", "complaint_message")).toBe(true);
    expect(csAlertVisible("R09", "message_channel")).toBe(true);
    expect(csAlertVisible("R03", "default")).toBe(false);
    expect(csAlertVisible("R10", "default")).toBe(false);
  });

  it("projectForRole：未列入白名单的字段一律剔除（含金额/销量）", () => {
    const dto = {
      title: "投诉上升",
      message_count: 12,
      gmv: "2300.00",
      units_sold: 40,
      ad_spend: "500.00",
      sample: "漏水",
    };
    const projected = projectForRole(dto, ["title", "message_count", "sample"]);
    expect(projected).toEqual({ title: "投诉上升", message_count: 12, sample: "漏水" });
    expect("gmv" in projected).toBe(false);
    expect("units_sold" in projected).toBe(false);
    expect("ad_spend" in projected).toBe(false);
  });
});
