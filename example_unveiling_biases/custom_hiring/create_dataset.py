import pandas as pd
import numpy as np
import os
import random

np.random.seed(12)
n_samples = 3000
hiring_managers = ['A', 'B', 'C', 'D']
job_positions = ['technician', 'services', 'HR', 'sales', 'management']
genders = ['male', 'female', 'other']

data = {
    'HiringManager': np.random.choice(hiring_managers, n_samples),
    'Experience': np.random.normal(10, 2.5, n_samples),
    'UniversityReputation': np.random.randint(1, 6, n_samples),
    'GPA': np.clip(np.random.normal(3.0, 0.5, n_samples), 0, 4),
    'Age': np.random.uniform(22, 60, n_samples),
    'Gender': np.random.choice(genders, n_samples, p=[0.45, 0.45, 0.1]),
    'JobPosition': np.random.choice(job_positions, n_samples)
}

data[f'RANDOM'] = np.random.uniform(0, 1, n_samples)

df = pd.DataFrame(data)

df['Experience'] = df.apply(
    lambda row: np.clip(row['Experience']-random.choice([0,1,2,3,4,5,6]),0, 100) if row['Gender'] == 'female' else np.clip(row['Experience'],0,100), axis=1
)
df['base_salary'] = (
    30000 # Base salary
    + df['Experience'] * 500  # Experience adds to salary
    + (df['UniversityReputation'] - 3) * 3000  # University reputation adds or subtracts
    + (df['GPA'] - 3.0) * 2000  # GPA contributes to salary
)

manager_salary_factor = {'A': 1.1, 'B': 1.0, 'C': 1.0, 'D': 0.9}
df['base_salary'] *= df['HiringManager'].map(manager_salary_factor)


gender_salary_factor = {'male': 1.0, 'female': 0.85, 'other': 0.95}
df['base_salary'] *= df['Gender'].map(gender_salary_factor) # model gender pay gap

# effects like women being in different positions are not modeled here, therefore only a systematic pay gap is modeled

position_effect = {'technician': 1.1, 'services': 1, 'HR': 1.02, 'sales': 1.08, 'management': 1.2}
df['base_salary'] *= df['JobPosition'].map(position_effect)


# if male and hiring manager is A, then remove 40% from salary
df['base_salary'] = df.apply(
    lambda row: row['base_salary'] * 0.8 if row["HiringManager"]=="A" and row["Gender"]=="male" else row['base_salary'], axis=1)

# hiring manager B and C do not like gender other
df['base_salary'] = df.apply(
    lambda row: row['base_salary'] * 0.6 if row["HiringManager"] in ["B", "C"] and row["Gender"]=="other" else row['base_salary'], axis=1)

df['Salary'] = df['base_salary']# + np.random.normal(0, 2000, n_samples)

df = df.drop(columns=['base_salary'])
output_path = os.path.join(os.path.dirname(__file__), 'hiring_dataset.csv')
df.to_csv(output_path, sep=";", index=False)