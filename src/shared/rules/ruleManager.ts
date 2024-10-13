import { Rule } from '../types';
import { parseRuleString } from './ruleParser';
import { serializeRule } from './ruleSerializer';
import { logWarning } from '../utils/logger';

function validateRule(metadata:any, rule: Rule, ruleType: 'whitelist' | 'blacklist', targetVar: string): void {
    for (const antecedent of rule.antecedents) {
        if (!metadata.numerical_fuzzification.includes(antecedent.fuzzySet)) {
            throw new Error(
                `Invalid antecedent "${antecedent}" in ${ruleType} rule "${serializeRule(rule, targetVar)}". It must be one of the numerical_fuzzification parameters.`
            );
        }
    }

    if (!metadata.numerical_defuzzification.includes(rule.outputFuzzySet)) {
        throw new Error(
            `Invalid consequent "${rule.outputFuzzySet}" in ${ruleType} rule "${serializeRule(rule, targetVar)}". It must be one of the numerical_defuzzification parameters.`
        );
    }
}

export function applyWhitelistBlacklist(
    allRules: Rule[],
    metadata: any,
    targetVar: string,
    warnings: any[]
): Rule[] {
    const { whitelist, blacklist, only_whitelist } = metadata;

    if (only_whitelist && whitelist && whitelist.length > 0) {
        const parsedWhitelistRules: Rule[] = [];
        whitelist.forEach((ruleStr: string) => {
            const parsedRule = parseRuleString(ruleStr, targetVar, true);
            if (parsedRule) {
                validateRule(metadata, parsedRule, 'whitelist', targetVar);
                parsedWhitelistRules.push(parsedRule);
            } else {
                logWarning(`Failed to parse whitelist rule: "${ruleStr}". It will be ignored.`, warnings);
            }
        });

        logWarning(
            `Only whitelist rules will be used as "only_whitelist" is set to true. Total whitelist rules: ${parsedWhitelistRules.length}.`,
            warnings
        );
        return parsedWhitelistRules;
    } else {
        if (whitelist && whitelist.length > 0) {
            const parsedWhitelistRules: Rule[] = [];
            whitelist.forEach((ruleStr: string) => {
                const parsedRule = parseRuleString(ruleStr, targetVar, true);
                if (parsedRule) {
                    validateRule(metadata, parsedRule, 'whitelist', targetVar);
                    parsedWhitelistRules.push(parsedRule);
                } else {
                    logWarning(`Failed to parse whitelist rule: "${ruleStr}". It will be ignored.`, warnings);
                }
            });
            
            parsedWhitelistRules.forEach((whitelistRule) => {
                const serializedWhitelistRule = serializeRule(whitelistRule, targetVar);
                const isDuplicate = allRules.some(
                    (rule) => serializeRule(rule, targetVar) === serializedWhitelistRule
                );
                if (!isDuplicate) {
                    allRules.unshift(whitelistRule); // Add to the start instead of the end
                }
            });
            
            logWarning(
                `Added ${parsedWhitelistRules.length} whitelist rules to the rule set.`,
                warnings
            );            
        }

        if (blacklist && blacklist.length > 0) {
            const parsedBlacklistRules: Rule[] = [];
            blacklist.forEach((ruleStr: string) => {
                const parsedRule = parseRuleString(ruleStr, targetVar, false);
                if (parsedRule) {
                    validateRule(metadata, parsedRule, 'blacklist', targetVar);
                    parsedBlacklistRules.push(parsedRule);
                } else {
                    logWarning(`Failed to parse blacklist rule: "${ruleStr}". It will be ignored.`, warnings);
                }
            });

            const serializedBlacklist = parsedBlacklistRules.map((rule) =>
                serializeRule(rule, targetVar)
            );

            const initialRuleCount = allRules.length;
            allRules = allRules.filter((rule) => {
                const serializedRule = serializeRule(rule, targetVar);
                return !serializedBlacklist.includes(serializedRule);
            });
            const removedBlacklistCount = initialRuleCount - allRules.length;

            logWarning(
                `Removed ${removedBlacklistCount} rules based on the blacklist.`,
                warnings
            );
        }

        return allRules;
    }
}
