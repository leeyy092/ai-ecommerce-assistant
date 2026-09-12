/**
 * 固定四角色能力矩阵（TASK-004；唯一来源 02_USER_ROLES.md v1.1）。
 * 不提供自定义 RBAC / 店铺级权限（P1）；角色与能力均服务端映射。
 */

export type Role = "owner" | "admin" | "operator" | "customer_service";

/** 固定能力清单（页面/接口/任务/文件/AI 证据共用） */
export const CAPABILITIES = {
  /** 查看经营数据与广告（Dashboard、报表、指标） */
  viewBusinessData: "view_business_data",
  /** 查看商品经营数据（SKU 统计） */
  viewProductData: "view_product_data",
  /** 客服记录关联的 SKU 名称/编码（无经营统计） */
  viewCsSkuIdentity: "view_cs_sku_identity",
  /** 查看脱敏客服数据 */
  viewCustomerServiceData: "view_customer_service_data",
  /** 查看经营域 AI 建议与证据 */
  viewAiBusiness: "view_ai_business",
  /** 查看客服域 AI 建议（服务端白名单投影） */
  viewAiCustomerService: "view_ai_customer_service",
  /** 维护店铺/数据源/AI与规则配置 */
  manageSettings: "manage_settings",
  /** 管理组织基础信息 */
  manageOrgInfo: "manage_org_info",
  /** 查看成员列表 */
  viewMembers: "view_members",
  /** 修正 VOC 人工标签（审计） */
  correctVocLabels: "correct_voc_labels",
  /** 修改本人行动状态 */
  manageOwnActionState: "manage_own_action_state",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/** 导入文件类型 */
export type ImportKind =
  | "products"
  | "orders"
  | "order_items"
  | "ads"
  | "customer_messages"
  | "after_sales";

const FULL: Role[] = ["owner", "admin", "operator"];

export const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>> = {
  owner: new Set(Object.values(CAPABILITIES)),
  admin: new Set(Object.values(CAPABILITIES)),
  operator: new Set([
    CAPABILITIES.viewBusinessData,
    CAPABILITIES.viewProductData,
    CAPABILITIES.viewCsSkuIdentity,
    CAPABILITIES.viewCustomerServiceData,
    CAPABILITIES.viewAiBusiness,
    CAPABILITIES.viewAiCustomerService,
    CAPABILITIES.correctVocLabels,
    CAPABILITIES.manageOwnActionState,
  ]),
  customer_service: new Set([
    CAPABILITIES.viewCustomerServiceData,
    CAPABILITIES.viewCsSkuIdentity,
    CAPABILITIES.viewAiCustomerService,
    CAPABILITIES.correctVocLabels,
    CAPABILITIES.manageOwnActionState,
  ]),
};

/** 各角色可导入的文件类型（02：C 仅 customer_messages） */
export const ROLE_IMPORT_KINDS: Record<Role, ReadonlySet<ImportKind>> = {
  owner: new Set<ImportKind>([
    "products",
    "orders",
    "order_items",
    "ads",
    "customer_messages",
    "after_sales",
  ]),
  admin: new Set<ImportKind>([
    "products",
    "orders",
    "order_items",
    "ads",
    "customer_messages",
    "after_sales",
  ]),
  operator: new Set<ImportKind>([
    "products",
    "orders",
    "order_items",
    "ads",
    "customer_messages",
    "after_sales",
  ]),
  customer_service: new Set<ImportKind>(["customer_messages"]),
};

/** 各角色可邀请的角色（O→A/P/C；A→P/C） */
export const INVITABLE_ROLES: Record<Role, ReadonlySet<Role>> = {
  owner: new Set(["admin", "operator", "customer_service"]),
  admin: new Set(["operator", "customer_service"]),
  operator: new Set(),
  customer_service: new Set(),
};

/** Admin 可管理的目标角色（不可操作 Owner/Admin） */
export const ADMIN_MANAGEABLE_ROLES: ReadonlySet<Role> = new Set([
  "operator",
  "customer_service",
]);

export function hasCapability(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function canImport(role: Role, kind: ImportKind): boolean {
  return ROLE_IMPORT_KINDS[role].has(kind);
}

/** Dashboard 类经营入口对 C 一律拒绝（含首页聚合与报表导出） */
export function canViewDashboard(role: Role): boolean {
  return FULL.includes(role);
}

/** 客服告警白名单（02：仅 R08 两子通道与 R09；F04） */
export const CS_ALERT_WHITELIST: ReadonlySet<string> = new Set([
  "R08:after_sales_case",
  "R08:complaint_message",
  "R09:message_channel",
]);

export function csAlertVisible(ruleId: string, subchannel: string): boolean {
  return CS_ALERT_WHITELIST.has(`${ruleId}:${subchannel}`);
}

/**
 * 客服字段投影（02：C 只见脱敏客服数据；含经营金额/销量/广告的证据整条不返回）。
 * 白名单按字段名过滤；任何未列名字段一律剔除，宁可少给不可泄露。
 */
export function projectForRole<T extends Record<string, unknown>>(
  dto: T,
  whitelist: readonly string[],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of whitelist) {
    if (key in dto) out[key] = dto[key];
  }
  return out as Partial<T>;
}
