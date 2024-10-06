import { Rule, Metadata, Record } from '../types';
import { generateAllPossibleRules } from '../rules/ruleGenerator';
import { applyWhitelistBlacklist } from '../rules/ruleManager';
import { logWarning } from '../utils/logger';

export function executeRulePipeline(
    numericalKeys: string[],
    targetVar: string,
    metadata: Metadata,
    inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } },
    outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean },
    warnings: string[]
): Rule[] {
    // Generate all possible rules
    let allRules: Rule[] = generateAllPossibleRules(
        numericalKeys,
        targetVar,
        metadata.num_vars,
        metadata,
        inputFuzzySetNonEmpty,
        outputFuzzySetNonEmpty,
        warnings
    );

    // Apply Whitelist and Blacklist
    allRules = applyWhitelistBlacklist(allRules, metadata, targetVar, warnings);

    return allRules;
}
