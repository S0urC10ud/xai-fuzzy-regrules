import { Rule, FuzzySet } from '../types/index';

export function parseRuleString(
    ruleStr: string,
    targetVar: string,
    isWhitelist: boolean = false
): Rule | null {
    const [antecedentPart, consequentPart] = ruleStr.split(' then ');
    if (!antecedentPart || !consequentPart) return null;

    const antecedentMatches = antecedentPart.match(/If\s+([A-Za-z0-9_]+)\s+is\s+([^\s]+)/gi);
    if (!antecedentMatches) return null;

    const antecedents = antecedentMatches.map((match) => {
        const parts = match.trim().split(/\s+/);
        return {
            variable: parts[1],
            fuzzySet: parts[3],
        };
    });

    const consequentMatch = consequentPart.trim().match(new RegExp(`^${targetVar}\\s+is\\s+([^\s]+)$`, 'i'));
    if (!consequentMatch) return null;
    const outputFuzzySetStr = consequentMatch[1] as string;

    const validFuzzySets: FuzzySet[] = ['verylow', 'low', 'mediumlow', 'medium', 'mediumhigh', 'high', 'veryhigh'];
    if (!validFuzzySets.includes(outputFuzzySetStr as FuzzySet)) {
        return null;
    }
    const outputFuzzySet = outputFuzzySetStr as FuzzySet;
    
    return new Rule(antecedents, outputFuzzySet, isWhitelist);
}
