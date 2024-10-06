import { Rule } from '../types';

export function serializeRule(rule: Rule, targetVar: string): string {
    const antecedentStr = rule.antecedents
        .map((ant) => `If ${ant.variable} is ${ant.fuzzySet}`)
        .join(' AND ');
    return `${antecedentStr} then ${targetVar} is ${rule.outputFuzzySet}`;
}