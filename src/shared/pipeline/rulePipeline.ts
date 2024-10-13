import { Rule, Metadata } from '../types';
import { generateAllPossibleRules } from '../rules/ruleGenerator';
import { applyWhitelistBlacklist } from '../rules/ruleManager';

export function executeRulePipeline(
    numericalKeys: string[],
    categoricalKeys: string[],
    targetVar: string,
    metadata: Metadata,
    variableFuzzySets: { [variable: string]: string[] },
    inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } },
    outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean },
    outputFuzzySets: { [x: string]: number[] } & { verylow?: number[]; low?: number[]; mediumlow?: number[]; medium?: number[]; mediumhigh?: number[]; high?: number[]; veryhigh?: number[]; },
    warnings: any[]
) {
    let allRules: Rule[] = generateAllPossibleRules(
        numericalKeys,
        categoricalKeys,
        targetVar,
        metadata.num_vars,
        variableFuzzySets,
        inputFuzzySetNonEmpty,
        outputFuzzySetNonEmpty,
        warnings,
        metadata
    );

    allRules = applyWhitelistBlacklist(allRules, metadata, targetVar, warnings);

    const ruleOutputFuzzySetDegreesMap: { [ruleIndex: number]: number[]; } = {};
    allRules.forEach((rule, ruleIndex) => {
        ruleOutputFuzzySetDegreesMap[ruleIndex] = outputFuzzySets[rule.outputFuzzySet] || [];
    });

    return {allRules, ruleOutputFuzzySetDegreesMap};
}
