import { existsSync } from "node:fs";
import { readJsonObject, pyGet } from "./jsonio.js";

export interface Config {
  finish: string | null;
  auto_arm: boolean;
  // string[] in the common case, but an explicit JSON `null` for this key
  // must flow through unchanged (Python: data.get("gate_cmds", []) returns
  // the present value, null included) so that validateGateCmds can reject
  // it downstream instead of the loader silently defaulting to [].
  gate_cmds: string[] | null;
  // superpowers 由編排 skill 消費(引擎不分支):true/false/null(未設,
  // SKILL 第一次啟動時問使用者再寫回)。非布林值原樣保留,消費端視為未設。
  superpowers: boolean | null;
  // auto_approve 同為編排層開關:true 時跳過「批准設計/批准提案」人工關卡
  // (escalated 安全閥不受影響)。只認 JSON true——它管的是略過人工,
  // 解析錯誤必須朝「要人工」的保守方向退化。
  auto_approve: boolean;
  // model_profile / models 由編排 skill 消費(引擎不分支):
  // profile 選檔位(quality=全程繼承 session 模型、budget=apply/機械 fix 用 sonnet),
  // models 逐階段 override(值是 alias 不是完整 model id——alias 跟著 harness 換代)。
  model_profile: string | null;
  models: Record<string, string>;
}

function defaultConfig(): Config {
  return {
    finish: null,
    auto_arm: true,
    gate_cmds: [],
    superpowers: null,
    auto_approve: false,
    model_profile: null,
    models: {},
  };
}

export const VALID_MODEL_PROFILES = ["quality", "budget"] as const;
export const VALID_MODEL_STAGES = ["brainstorm", "apply", "review", "fix"] as const;
export const VALID_MODEL_ALIASES = ["sonnet", "opus", "haiku", "fable"] as const;

/**
 * model_profile/models 值域驗證,非法拋 Error(fail loudly,
 * 與 finish/gate_cmds 同精神——設定 typo 不得靜默退化)。
 */
export function validateModelConfig(modelProfile: string | null, models: unknown): void {
  if (modelProfile !== null && !(VALID_MODEL_PROFILES as readonly string[]).includes(modelProfile)) {
    throw new Error(
      `model_profile=${JSON.stringify(modelProfile)} (valid: ${VALID_MODEL_PROFILES.join("/")})`,
    );
  }
  if (typeof models !== "object" || models === null || Array.isArray(models)) {
    throw new Error(`models must be a dict, got ${JSON.stringify(models)}`);
  }
  for (const [stage, alias] of Object.entries(models as Record<string, unknown>)) {
    if (!(VALID_MODEL_STAGES as readonly string[]).includes(stage)) {
      throw new Error(`models key ${JSON.stringify(stage)} (valid stages: ${VALID_MODEL_STAGES.join("/")})`);
    }
    if (!(VALID_MODEL_ALIASES as readonly string[]).includes(alias as string)) {
      throw new Error(
        `models[${JSON.stringify(stage)}]=${JSON.stringify(alias)} (valid aliases: `
        + `${VALID_MODEL_ALIASES.join("/")} — full model ids are rejected; aliases track the harness)`,
      );
    }
  }
}

// budget 只路由 output 大戶:執行段換便宜模型,把關段(brainstorm/review)繼承。
// fix 回 budget 建議值 sonnet;「架構性 fix 忽略建議改繼承」是編排層判斷,引擎不碰。
const BUDGET_ROUTES: Record<string, string> = { apply: "sonnet", fix: "sonnet" };

/**
 * 階段 model 決議(單一真理來源):models override → profile 查表 → null(繼承)。
 * stage 不合法拋 Error(呼叫端 bug,fail loudly)。
 */
export function resolveModel(stage: string, config: Config): string | null {
  if (!(VALID_MODEL_STAGES as readonly string[]).includes(stage)) {
    throw new Error(`stage ${JSON.stringify(stage)} (valid: ${VALID_MODEL_STAGES.join("/")})`);
  }
  if (Object.prototype.hasOwnProperty.call(config.models, stage)) {
    return config.models[stage] as string;
  }
  if (config.model_profile === "budget") {
    return BUDGET_ROUTES[stage] ?? null;
  }
  return null;
}

export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    return defaultConfig();
  }
  const data = readJsonObject(path, "config");
  // pyGet, not `?? default`: Python's data.get(key, default) substitutes
  // default only when the key is ABSENT. `??` also substitutes on explicit
  // JSON `null`, which is wrong for every field below whose Python default
  // is non-null (auto_arm=True, models={}) — see F1. Fields whose Python
  // default is already None (finish, superpowers, model_profile) are
  // unaffected either way, but pyGet is used uniformly so the loader
  // doesn't silently regress if a default ever changes.
  const modelProfile = pyGet(data, "model_profile", null) as string | null;
  const models = pyGet<unknown>(data, "models", {});
  // 設定壞掉要在 loop 一開始就炸,不是跑到 apply dispatch 才發現
  // (explicit `models: null` must reach here and throw, matching Python's
  // isinstance(None, dict) check inside validate_model_config — it must
  // NOT be silently defaulted to {} first.)
  validateModelConfig(modelProfile, models);
  return {
    finish: pyGet(data, "finish", null) as string | null,
    // Python: bool(data.get("auto_arm", True)). Explicit `auto_arm: null`
    // is a *present* key, so Python's .get returns None (not True), and
    // bool(None) is False — the same value must come out here.
    auto_arm: Boolean(pyGet(data, "auto_arm", true)),
    // Explicit `gate_cmds: null` must survive as null (Python's .get
    // returns the present None, not []), for validateGateCmds to reject.
    gate_cmds: pyGet(data, "gate_cmds", [] as string[]),
    // superpowers: a non-boolean JSON value (e.g. "yes") passes through
    // unchanged at runtime despite the `boolean | null` type — intentional
    // Python parity (原始碼註解:非布林值原樣保留,消費端視為未設). Do not
    // "fix" this into a Boolean() coercion; that would break parity.
    superpowers: pyGet(data, "superpowers", null) as boolean | null,
    // Python: (data.get("auto_approve", False) is True). Present-null and
    // absent both yield None/False respectively, both !== True -> False;
    // pyGet + strict === true reproduces this without special-casing.
    auto_approve: pyGet<unknown>(data, "auto_approve", false) === true,
    model_profile: modelProfile,
    // Past validateModelConfig, models is guaranteed to be a non-null,
    // non-array object (or it would have thrown above).
    models: models as Record<string, string>,
  };
}

/**
 * gate_cmds 必須是非空字串的 list;非法拋 Error(fail loudly,
 * 與 finish 值域驗證同精神——設定 typo 不得靜默退化)。
 */
export function validateGateCmds(gateCmds: unknown): string[] {
  if (
    !Array.isArray(gateCmds)
    || !gateCmds.every((c) => typeof c === "string" && c.trim() !== "")
  ) {
    throw new Error(`gate_cmds must be a list of non-empty strings, got ${JSON.stringify(gateCmds)}`);
  }
  return gateCmds;
}

export const VALID_FINISH_VALUES = ["merge", "pr", "ask"] as const;

/**
 * 決定收尾策略:change metadata 的 finish override 全域 config;皆無 → ask。
 *
 * config.finish 與 meta.finish 各自獨立驗證——即使被合法值 override,
 * 非法值(typo)也不得靜默吞掉,拋 Error(含來源與值)。
 */
export function resolveFinish(config: Config, meta: { finish: string | null }): string {
  for (const [source, value] of [
    ["config.finish", config.finish],
    ["meta.finish", meta.finish],
  ] as const) {
    if (value !== null && !(VALID_FINISH_VALUES as readonly string[]).includes(value)) {
      throw new Error(`${source}=${JSON.stringify(value)}`);
    }
  }
  if (meta.finish !== null) {
    return meta.finish;
  }
  if (config.finish !== null) {
    return config.finish;
  }
  return "ask";
}
