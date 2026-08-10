---
title: "Practice 3: Analyze and Summarize Spreadsheets"
---

# Practice 3: Analyze and Summarize Spreadsheets

Import Excel or CSV data, clean and aggregate it, then save a new workbook or brief without inventing numbers that are not in the source.

## 1. Scenario and goal

| Scenario | Goal |
|----------|------|
| A register contains duplicates or blanks | Clean it and save a separate summary workbook |
| You need totals by customer or month | Pivot-style summary + three conclusions |
| A leader needs a short version | One-page written summary + key figures |


## 2. Example request

```text
Read @accounts-receivable-template.xlsx in the workspace (or the actual filename):
1. List the fields and obvious data-quality problems.
2. Aggregate amounts by customer in descending order.
3. Mark the top five and the total.
4. Save a new workbook as notes/accounts-receivable-by-customer.xlsx, and write
   five lines of conclusions to notes/accounts-receivable-conclusions.md.
Do not invent numbers not present in the source. Mark missing values as
“Not present in source.”
```

## 3. Preparation

1. Import a **copy** of the xlsx/csv file into the workspace
2. Identify the key fields, such as customer name and date
3. For formulas or complex edits, use an [Office Skill or OfficeCLI](/en/guide/skills)

## 4. Acceptance checks

- [ ] Sample row counts and totals agree with the source workbook
- [ ] Both the conclusions and workbook are present in the workspace
- [ ] The original workbook remains unchanged

## Related

- [Skills](/en/guide/skills) · [Files](/en/guide/files) · [Tips for effective use · provide an example](/en/guide/efficient-tips)
