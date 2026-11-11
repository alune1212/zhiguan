export const PERSONA_TEXT_MAX = 80;
export const PERSONA_MIN_ENABLED = 1;
export const PERSONA_MAX_ENABLED = 5;

export type PersonaStance = "ordinary" | "pushback";

export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly personality: string;
  readonly caresAbout: string;
  readonly moneyAttitude: string;
  readonly stance: PersonaStance;
  readonly enabled: boolean;
}

export const DEFAULT_PERSONAS: readonly Persona[] = [
  {
    id: "family",
    name: "家人",
    relationship: "家人",
    personality: "直接，关心日子稳不稳",
    caresAbout: "钱能不能留出余地",
    moneyAttitude: "先看余量和急用，不评价人",
    stance: "ordinary",
    enabled: true,
  },
  {
    id: "partner",
    name: "伴侣",
    relationship: "伴侣",
    personality: "一起商量，不替对方做主",
    caresAbout: "会不会挤掉已经想做的安排",
    moneyAttitude: "看这笔钱在共同生活里占什么位置",
    stance: "ordinary",
    enabled: true,
  },
  {
    id: "friend",
    name: "朋友",
    relationship: "朋友",
    personality: "说实话，但不比较",
    caresAbout: "会不会真的用，买了开不开心",
    moneyAttitude: "不拿别人的消费当标准",
    stance: "ordinary",
    enabled: true,
  },
  {
    id: "future-self",
    name: "5 年后的你",
    relationship: "5 年后的你",
    personality: "只看以后这件东西还在不在用",
    caresAbout: "使用假设和工时",
    moneyAttitude: "用事实卡上的成本和工时提出反对，反对的是这笔开销的假设",
    stance: "pushback",
    enabled: true,
  },
  {
    id: "boss",
    name: "上司",
    relationship: "上司",
    personality: "只谈工作是否用得上",
    caresAbout: "和工作相关的用途",
    moneyAttitude: "与工作无关时说明自己没有工作上的理由，不引申到人品",
    stance: "ordinary",
    enabled: false,
  },
];

export function characterLength(value: string): number {
  return [...value].length;
}

export function isPersona(value: unknown): value is Persona {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && value.id.length > 0 && value.id.length <= 80
    && isPersonaText(value.name)
    && isPersonaText(value.relationship)
    && isPersonaText(value.personality)
    && isPersonaText(value.caresAbout)
    && isPersonaText(value.moneyAttitude)
    && (value.stance === "ordinary" || value.stance === "pushback")
    && typeof value.enabled === "boolean";
}

export function personaProblems(personas: readonly Persona[]): readonly string[] {
  if (personas.some((persona) => !isPersona(persona))) return ["有人物的设定还不能用。"];
  if (new Set(personas.map((persona) => persona.id)).size !== personas.length) return ["人物标识重复了。"];
  const enabled = personas.filter((persona) => persona.enabled);
  const problems: string[] = [];
  if (enabled.length < PERSONA_MIN_ENABLED || enabled.length > PERSONA_MAX_ENABLED) {
    problems.push("启用的人物需要是 1 到 5 位。");
  }
  if (!enabled.some((persona) => persona.stance === "pushback")) {
    problems.push("至少要有一位反对角色。");
  }
  return problems;
}

export function defaultPersonas(): Persona[] {
  return DEFAULT_PERSONAS.map((persona) => ({ ...persona }));
}

function isPersonaText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && characterLength(value) <= PERSONA_TEXT_MAX;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
