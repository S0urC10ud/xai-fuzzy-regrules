import { Rule } from '../types';

export function parseRuleString(
    ruleStr: string,
    targetVar: string,
    isWhitelist: boolean = false
): Rule | null {
    try {
        const [antecedentPart, consequentPart] = ruleStr.split(' then ');
        if (!antecedentPart || !consequentPart) return null;

        const antecedentMatches = antecedentPart.match(
            /If\s+([A-Za-z0-9_]+)\s+is\s+(verylow|low|mediumlow|medium|mediumhigh|high|veryhigh)/gi
        );
        if (!antecedentMatches) return null;

        const antecedents = antecedentMatches.map((match) => {
            const parts = match.trim().split(/\s+/);
            return {
                variable: parts[1],
                fuzzySet: parts[3] as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh',
            };
        });

        const consequentMatch = consequentPart.trim().match(
            new RegExp(`^${targetVar}\\s+is\\s+(verylow|low|mediumlow|medium|mediumhigh|high|veryhigh)$`, 'i')
        );
        if (!consequentMatch) return null;

        const outputFuzzySet = consequentMatch[1].toLowerCase() as 'verylow' | 'low' | 'mediumlow' | 'medium' | 'mediumhigh' | 'high' | 'veryhigh';

        return {
            antecedents,
            outputFuzzySet,
            isWhitelist,
        };
    } catch {
        return null;
    }
}
