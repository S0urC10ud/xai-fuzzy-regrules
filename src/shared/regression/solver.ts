import { Matrix, solve } from 'ml-matrix';
import { Metadata, Rule } from '../types/index';
import { serializeRule } from '../rules/ruleSerializer';
import { logWarning } from '../utils/logger';

export function attemptToSolve(
    XtX_reg: Matrix,
    Xt_y: Matrix,
    rules: Rule[],
    metadata: Metadata,
    warnings: any[]
): number[] | null {
    let currentRules = [...rules];
    let attempt = 0;

    while (currentRules.length > 0) {
        try {
            const coeffs = solve(XtX_reg, Xt_y);
            return coeffs.to1DArray();
        } catch {
            const nonWhitelistIndex = currentRules.findIndex((rule) => !rule.isWhitelist);
            if (nonWhitelistIndex !== -1) {
                const removedRule = currentRules.splice(nonWhitelistIndex, 1)[0];
                const ruleStr = serializeRule(removedRule, metadata["target_var"]);
                const warnMsg = `Removed non-whitelist rule to attempt solving: "${ruleStr}".`;
                logWarning(warnMsg, warnings);
            } else {
                const whitelistIndex = currentRules.findIndex((rule) => rule.isWhitelist);
                if (whitelistIndex !== -1) {
                    const removedRule = currentRules.splice(whitelistIndex, 1)[0];
                    const ruleStr = serializeRule(removedRule, metadata["target_var"]);
                    const warnMsg = `Removed whitelist rule to attempt solving: "${ruleStr}".`;
                    logWarning(warnMsg, warnings);
                } else {
                    logWarning(`Unable to solve the system after removing all rules.`, warnings);
                    return null;
                }
            }
            attempt++;
            if (attempt > rules.length) {
                logWarning(`Exceeded maximum attempts to solve the system.`, warnings);
                return null;
            }
        }
    }

    return null;
}