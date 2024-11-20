import re
from collections import defaultdict
from itertools import combinations
import json

TARGET_VAR = "target"

def parse_rule_title(title):
    global TARGET_VAR
    match = re.match(r'If (.+) then (\w+) is (\w+)', title, re.IGNORECASE)
    if not match:
        return [], None

    conditions_str, target_var, conclusion = match.groups()
    TARGET_VAR = target_var

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
        # Check if rule1 is a proper subset of rule2
        if rule1['conditions'] < rule2['conditions'] and rule1['conclusion'] != rule2['conclusion']:
            interesting_rules.append( (rule1, rule2) )
        # Check if rule2 is a proper subset of rule1
        if rule2['conditions'] < rule1['conditions'] and rule2['conclusion'] != rule1['conclusion']:
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
    return ' AND '.join([f"{var} is {val}" for var, val in sorted(conditions)])

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
            for title in titles:
                print(f" - Rule: '{title}'")
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
            print(f"General Rule: If {gen_cond} THEN {TARGET_VAR} is {general_rule['conclusion']}")
            print(f"Specific Rule: If {spec_cond} THEN {TARGET_VAR} is {specific_rule['conclusion']}")
            print()

if __name__ == "__main__":
    with open(input("Please enter the path to the response file: ")) as f: # e.g. example_unveiling_biases/boston/response.json
        data = json.load(f)

    min_coefficient_input = input("What should the minimum coefficient to consider be? (e.g. 0.001, default: 0) ")
    min_coefficient = float(min_coefficient_input) if min_coefficient_input else 0.0
    ruleset = [rule for rule in data["sorted_rules"] if rule["coefficient"] >= min_coefficient]

    main(ruleset)
