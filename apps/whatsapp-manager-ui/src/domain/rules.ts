import type { NumberRule } from "./models";

export function getRuleDisplayValue(rule: NumberRule) {
  if (rule.matchType === "all") {
    return "All numbers";
  }

  return `${rule.matchType === "exact" ? "Full match" : "Regex"} ${rule.pattern}`;
}
