import { FormEvent } from "react";

import { formatTimestamp } from "../domain/formatting";
import type { NumberRule, NumberRuleAction, NumberRuleMatchType } from "../domain/models";
import { getRuleDisplayValue } from "../domain/rules";
import { EmptyState, IconButton } from "./shared";

export function RulesView({
  activeAccountId,
  isBusy,
  matchType,
  onActionChange,
  onCreate,
  onDelete,
  onEnabledChange,
  onLabelChange,
  onMatchTypeChange,
  onPatternChange,
  pattern,
  ruleAction,
  ruleLabel,
  rules,
}: {
  activeAccountId: string;
  isBusy: boolean;
  matchType: NumberRuleMatchType;
  onActionChange: (value: NumberRuleAction) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (ruleId: string) => void;
  onEnabledChange: (rule: NumberRule, enabled: boolean) => void;
  onLabelChange: (value: string) => void;
  onMatchTypeChange: (value: NumberRuleMatchType) => void;
  onPatternChange: (value: string) => void;
  pattern: string;
  ruleAction: NumberRuleAction;
  ruleLabel: string;
  rules: NumberRule[];
}) {
  const conflictingAllRule = matchType === "all"
    ? rules.find((rule) => rule.enabled && rule.matchType === "all" && rule.action !== ruleAction)
    : undefined;
  const isCreateDisabled = isBusy
    || !activeAccountId
    || (matchType !== "all" && !pattern.trim())
    || Boolean(conflictingAllRule);
  const createTitle = conflictingAllRule
    ? `Disable or delete the ${conflictingAllRule.action} all rule before adding this one.`
    : "Add rule";

  return (
    <>
      <form className="rule-form" onSubmit={onCreate}>
        <label className="compact-field">
          <span>Action</span>
          <select value={ruleAction} onChange={(event) => onActionChange(event.target.value as NumberRuleAction)}>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </label>
        <label className="compact-field">
          <span>Match</span>
          <select value={matchType} onChange={(event) => onMatchTypeChange(event.target.value as NumberRuleMatchType)}>
            <option value="exact">Full match</option>
            <option value="regex">Regex</option>
            <option value="all">All numbers</option>
          </select>
        </label>
        <label className="compact-field">
          <span>Pattern</span>
          <input
            value={matchType === "all" ? "" : pattern}
            onChange={(event) => onPatternChange(event.target.value)}
            placeholder={matchType === "regex" ? "^1555" : "15551234567"}
            disabled={matchType === "all"}
          />
        </label>
        <label className="compact-field">
          <span>Label</span>
          <input value={ruleLabel} onChange={(event) => onLabelChange(event.target.value)} placeholder="Ops allowlist" />
        </label>
        <IconButton
          icon="mdi:plus"
          label="Add rule"
          type="submit"
          disabled={isCreateDisabled}
          title={createTitle}
        />
      </form>

      <div className="rule-list">
        {!activeAccountId ? (
          <EmptyState title="Select an account" description="Number rules are stored per WhatsApp account." />
        ) : rules.length === 0 ? (
          <EmptyState title="No number rules" description="Add allow or deny rules for this account." />
        ) : (
          rules.map((rule) => (
            <RuleRow
              key={rule.id}
              isBusy={isBusy}
              onDelete={onDelete}
              onEnabledChange={onEnabledChange}
              rule={rule}
              rules={rules}
            />
          ))
        )}
      </div>
    </>
  );
}

function RuleRow({
  isBusy,
  onDelete,
  onEnabledChange,
  rule,
  rules,
}: {
  isBusy: boolean;
  onDelete: (ruleId: string) => void;
  onEnabledChange: (rule: NumberRule, enabled: boolean) => void;
  rule: NumberRule;
  rules: NumberRule[];
}) {
  const conflictingAllRule = !rule.enabled && rule.matchType === "all"
    ? rules.find((candidate) => candidate.enabled && candidate.matchType === "all" && candidate.action !== rule.action)
    : undefined;
  const isEnableDisabled = isBusy || Boolean(conflictingAllRule);
  const enableTitle = conflictingAllRule
    ? `Disable or delete the ${conflictingAllRule.action} all rule before enabling this one.`
    : undefined;

  return (
    <article className="rule-row">
      <div className="rule-row-main">
        <span className={`badge badge-rule-${rule.action}`}>{rule.action}</span>
        <span>
          <strong>{rule.label || getRuleDisplayValue(rule)}</strong>
          <small>{rule.label ? getRuleDisplayValue(rule) : formatTimestamp(rule.updatedAt)}</small>
        </span>
      </div>
      <label className="check-field" title={enableTitle}>
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(event) => onEnabledChange(rule, event.target.checked)}
          disabled={isEnableDisabled}
        />
        <span>Enabled</span>
      </label>
      <IconButton icon="mdi:trash-can-outline" label="Delete rule" variant="danger" onClick={() => onDelete(rule.id)} disabled={isBusy} />
    </article>
  );
}
