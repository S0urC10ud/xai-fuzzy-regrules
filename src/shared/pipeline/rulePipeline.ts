import { Rule, Metadata, Record } from '../types/index';
import { generateAllPossibleRules } from '../rules/ruleGenerator';
import { applyWhitelistBlacklist } from '../rules/ruleManager';
import { computeMembershipDegrees } from '../utils/fuzzy';

export function executeRulePipeline(
    numericalKeys: string[],
    categoricalKeys: string[],
    targetVar: string,
    metadata: Metadata,
    variableFuzzySets: { [variable: string]: string[] },
    inputFuzzySetNonEmpty: { [variable: string]: { [fuzzySet: string]: boolean } },
    outputFuzzySetNonEmpty: { [fuzzySet: string]: boolean },
    outputFuzzySets: { [x: string]: number[] } & { verylow?: number[]; low?: number[]; mediumlow?: number[]; medium?: number[]; mediumhigh?: number[]; high?: number[]; veryhigh?: number[]; },
    records: Record[],
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

    const support_weight = metadata.rule_priority_weights?.support_weight ?? 2;
    const leverage_weight = metadata.rule_priority_weights?.leverage_weight ?? 10;
    const num_antecedents_weight = metadata.rule_priority_weights?.num_antecedents_weight ?? 1;
    const whitelist_boolean_weight = metadata.rule_priority_weights?.whitelist_boolean_weight ?? 100;

    allRules = applyWhitelistBlacklist(allRules, metadata, targetVar, warnings);
    const target_min_value = records.reduce((min, record) => Math.min(min, record[targetVar] as number), Infinity);
    const target_max_value = records.reduce((max, record) => Math.max(max, record[targetVar] as number), -Infinity);

    // Process records to assign each variable to its highest membership fuzzy set
    const classedRecords = records.map(record => {
        const classedRecord: { [key: string]: string } = {};
        numericalKeys.forEach(key => { 
            if (key !== targetVar) {
                const fuzzySets = variableFuzzySets[key];
                if (fuzzySets) {
                    let maxFuzzySet = '';
                    let maxDegree = -Infinity;
                    fuzzySets.forEach(fuzzySet => {
                        const value = record[`${key}_${fuzzySet}`];
                        if (typeof value === 'number' && value > maxDegree) {
                            maxDegree = value;
                            maxFuzzySet = fuzzySet;
                        }
                    });
                    classedRecord[key] = maxFuzzySet;
                }
            }
        });

        categoricalKeys.forEach(key => {
            const fuzzySets = Object.keys(record).filter(k => k.startsWith(`${key}_`)).map(k => k.split('_')[1]);
            if (fuzzySets) {
                let maxFuzzySet = '';
                let maxDegree = -Infinity;
                fuzzySets.forEach(fuzzySet => {
                    const value = record[`${key}_${fuzzySet}`];
                    if (typeof value === 'number' && value > maxDegree) {
                        maxDegree = value;
                        maxFuzzySet = fuzzySet;
                    }
                });
                classedRecord[key] = maxFuzzySet;
            }
        });
        
        const target_degrees = computeMembershipDegrees(record[targetVar] as number, target_min_value, target_max_value, metadata["numerical_defuzzification"]);
        classedRecord[targetVar] = Object.keys(target_degrees).reduce((a, b) => target_degrees[a] > target_degrees[b] ? a : b);
        return classedRecord;
    });

    const totalRecords = classedRecords.length;

    allRules.forEach(rule => {
        let countAntecedentsAndConsequent = 0;
        let countAntecedents = 0;
        let countConsequent = 0;

        classedRecords.forEach(classedRecord => {
            const antecedentsMatch = rule.antecedents.every(ant => {
                return classedRecord[ant.variable] === ant.fuzzySet;
            });
            const consequentMatch = classedRecord[targetVar] === rule.outputFuzzySet;

            if (antecedentsMatch) {
                countAntecedents++;
                if (consequentMatch) {
                    countAntecedentsAndConsequent++;
                }
            }
            if (consequentMatch) {
                countConsequent++;
            }
        });

        const support = countAntecedentsAndConsequent / totalRecords;
        const supportAntecedents = countAntecedents / totalRecords;
        const supportConsequent = countConsequent / totalRecords;
        const leverage = support - (supportAntecedents * supportConsequent);

        rule.support = support;
        rule.leverage = leverage;
    });
    allRules.forEach(rule => {
        const numAntecedents = rule.antecedents.length;
        const whitelistBoolean = rule.isWhitelist ? 1 : 0;

        //expected highest support based on boston housing dataset: 0.5, leverage: 0.15
        rule.priority = support_weight * rule.support + num_antecedents_weight * (1 / numAntecedents) + leverage_weight * rule.leverage + whitelist_boolean_weight * whitelistBoolean;
    });

    allRules.sort((a, b) => b.priority - a.priority);

    const ruleOutputFuzzySetDegreesMap: { [ruleIndex: number]: number[]; } = {};
    allRules.forEach((rule, ruleIndex) => {
        ruleOutputFuzzySetDegreesMap[ruleIndex] = outputFuzzySets[rule.outputFuzzySet] || [];
    });

    return {allRules, ruleOutputFuzzySetDegreesMap};
}