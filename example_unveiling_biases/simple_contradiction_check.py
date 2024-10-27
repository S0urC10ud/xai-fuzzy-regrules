import re
from collections import defaultdict
from itertools import combinations
import json


def parse_rule_title(title):
    match = re.match(r'If (.+) then MEDV is (\w+)', title, re.IGNORECASE)
    if not match:
        return [], None

    conditions_str, conclusion = match.groups()

    condition_parts = re.split(r'\s+AND\s+', conditions_str, flags=re.IGNORECASE)
    conditions = []
    for part in condition_parts:
        # Extract variable and value
        cond_match = re.match(r'If\s+(\w+)\s+is\s+(\w+)', part.strip(), re.IGNORECASE)
        if cond_match:
            variable, value = cond_match.groups()
            conditions.append( (variable.upper(), value.lower()) )
        else:
            # Handle cases like 'If VAR is high' without 'If' repeated
            cond_match = re.match(r'(\w+)\s+is\s+(\w+)', part.strip(), re.IGNORECASE)
            if cond_match:
                variable, value = cond_match.groups()
                conditions.append( (variable.upper(), value.lower()) )
    return conditions, conclusion.lower()

def check_conflicts(rules):
    condition_to_conclusions = defaultdict(set)
    condition_to_titles = defaultdict(list)

    for rule in rules:
        conditions, conclusion = parse_rule_title(rule['title'])
        if not conditions or not conclusion:
            continue
        conditions_key = frozenset(conditions)
        condition_to_conclusions[conditions_key].add(conclusion)
        condition_to_titles[conditions_key].append(rule['title'])

    # Identify conflicts
    conflicting_rules = []
    for conditions, conclusions in condition_to_conclusions.items():
        if len(conclusions) > 1:
            conflicting_rules.append( (conditions, condition_to_titles[conditions], conclusions) )
    
    return conflicting_rules

def find_interesting_rules(rules):
    parsed_rules = []
    for rule in rules:
        conditions, conclusion = parse_rule_title(rule['title'])
        if not conditions or not conclusion:
            continue
        conditions_set = frozenset(conditions)
        parsed_rules.append( {'conditions': conditions_set, 'conclusion': conclusion, 'title': rule['title']} )

    interesting_rules = []
    for rule1, rule2 in combinations(parsed_rules, 2):
        if rule1['conditions'].issubset(rule2['conditions']) and rule1['conclusion'] != rule2['conclusion']:
            interesting_rules.append( (rule1, rule2) )
        if rule2['conditions'].issubset(rule1['conditions']) and rule2['conclusion'] != rule1['conclusion']:
            interesting_rules.append( (rule2, rule1) )

    # Remove duplicate pairs
    unique_interesting = []
    seen = set()
    for pair in interesting_rules:
        titles = tuple(sorted([pair[0]['title'], pair[1]['title']]))
        if titles not in seen:
            seen.add(titles)
            unique_interesting.append(pair)
    
    return unique_interesting

def format_conditions(conditions):
    return ' AND '.join([f"If {var} is {val}" for var, val in sorted(conditions)])

def main(ruleset):
    print("Checking for conflicting rules...\n")
    conflicts = check_conflicts(ruleset)
    if not conflicts:
        print("No conflicting rules found based on identical conditions.\n")
    else:
        print("Conflicting Rules Found:")
        for conditions, titles, conclusions in conflicts:
            cond_str = format_conditions(conditions)
            print(f"Conditions: {cond_str}")
            for title, conclusion in zip(titles, conclusions):
                print(f" - Rule: '{title}' leads to MEDV being '{conclusion}'")
            print()
    
    print("Finding interesting rules...\n")
    interesting = find_interesting_rules(ruleset)
    if not interesting:
        print("No interesting rules found based on the specified criteria.\n")
    else:
        print("Interesting Rules:")
        for general_rule, specific_rule in interesting:
            gen_cond = format_conditions(general_rule['conditions'])
            spec_cond = format_conditions(specific_rule['conditions'])
            print(f"General Rule: {gen_cond} THEN MEDV is {general_rule['conclusion']}")
            # Determine the additional condition(s) in the specific rule
            additional_conditions = specific_rule['conditions'] - general_rule['conditions']
            add_cond_str = ' AND '.join([f"If {var} is {val}" for var, val in sorted(additional_conditions)])
            print(f"Specific Rule: {spec_cond} THEN MEDV is {specific_rule['conclusion']}")
            print()
    
if __name__ == "__main__":
    with open(input("Please enter the path to the response file: ")) as f: # e.g. example_unveiling_biases/boston/response.json
        data = json.load(f)

    # extract all rules with coefficient > 1
    ruleset = [rule for rule in data["sorted_rules"] if rule["coefficient"] > 1]

    main(ruleset)