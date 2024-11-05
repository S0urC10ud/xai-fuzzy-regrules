# Biased Salaries Synthetic Test Dataset
This repository contains the `biased_salaries.csv` synthetic dataset, designed to simulate salary data with inherent biases for testing and analysis purposes.


The dataset is intended to illustrate biases in salary distributions based on factors such as gender and hiring manager preferences. It can be used to:

- Test bias detection algorithms.
- Simulate real-world scenarios where biases may affect decision-making.
- Explore the impact of different features on salary outcomes.

> This synthetic dataset was created for educational and testing purposes to demonstrate bias in data.

### Dataset Columns
- **HiringManager**: Identifier for the hiring manager (A to G).
  - Hiring manager B pays gender other better
  - Hiring manager A pays better overall
- **Experience**: Years of experience (numeric, adjusted for gender).
    - Women often have less experience (random discount integer).
- **UniversityReputation**: Reputation score of the university (1-5).
- **GPA**: Grade Point Average (0-4).
- **Gender**: Gender of the candidate (male, female, other).
- **JobPosition**: Job role (technician, services, HR, sales, management).
    - Women often are in different (lower-paying) Jobs
- RANDOM: Random numeric value between 0 and 1.
  - Has no influence at all.
- Salary: Calculated salary with incorporated biases and noise.
  - `30.000 + Experience*100 + ((UniversityReputation - 3) * 3000) + ((GPA - 3.0) * 2000)`
  -  modified with optional effects (like Job-Position-Effect, HiringManager-Effects,...) 
  - lastly, new independent Gauss noise with SD 1500 is added

### Usage
To generate the dataset (or experiment with it) run:
`python create_dataset.py`
