# 4주차 활동지 / Week 4 Worksheet

**주제 선택과 요구 명세 / Choosing a problem & writing the spec**

- 작성일 / Date: 2026/09/23
- 참여자 / Present: Aizat,Syafiq,Farhana,Qasim

---

## ① 주제 선택 / Choosing one problem

| 항목 Item | 내용 |
|---|---|
| 선택한 주제 Chosen | Business analyst problem |
| 선택 근거 Why | Comparing with other problems we had proposed, it is more feasible to develop an app that has functionality of providing analysis services for users that can be implemented by the developers themselves rather than only relying on Artificial Intelligence features.
  |

## ② 성공 기준 가져오기 / Success criteria from Week 3

| 3주차 성공 기준 원문 Original (Week 3) | 모호한 표현 Vague words |
|---|---|
| *(예시) 학생들이 과제 제출 현황을 쉽게 확인할 수 있다* | *쉽게, 확인할 수 있다* |
| Having accessible visualization and analysis of data  | Accessible |

## ③ Acceptance Criteria

최소 정상 경로 2개 + 실패 경로 1개. **판정 방법** 칸이 비면 아직 명세가 아닙니다.
At least two normal paths + one failure path. If "How to check" is empty, it is not yet a spec.

| # | 경로 Path | EARS 문장 Sentence | 판정 방법 How to check |
|---|---|---|---|
| *예시* | *정상* | *WHEN 학생이 과제 목록을 열면 THE 시스템은 SHALL 과목별 미제출 과제를 마감일 순으로 표시한다* | *미제출 과제 3건을 만든 뒤 목록을 열어 마감일 순으로 나오는지 확인* |
| AC-1 | 정상 Normal | WHEN business owner inputs data points, THE system SHALL record and save the data in a database  | add 5 different records of orders/sales, then check sales history|
| AC-2 | 정상 Normal | WHEN business owner selects sales/marketing data analysis function, THE system SHALL display a dashboard of graphs and KPI cards related to the data | check all types of graphs (bar chart, pie chart, KPI cards etc) and check if applying categorial filters work |
| AC-3 | 정상 Normal |  WHEN business owner selects the AI assistant service function, THE AI SHALL prompt the business owner to ask questions about the data or business decisions | Ask about 1) summarizing sales trends and 2) suggesting marketing strategies and see the chatbot's response |
| AC-4 | 실패 Failure | IF requested data is unavailable or corrupted when analyzing data THEN THE system SHALL display ‘data not found’ and provide an option to import a local backup .xlsx/.csv file  | select data analysis function without adding any data and see if the message pops up |

> 확인할 동작이 더 있으면 AC-4부터 행을 추가해 쓰십시오.
> If there are more behaviors to check, add rows from AC-4.

- [ ] 이번 활동에서 AI를 사용했다면 `PROMPTS.md`에 기록했습니다 / Logged any AI use in `PROMPTS.md`

---

> 수업 종료 시 커밋하세요 / Commit this at the end of class
> `git add docs/week-04.md && git commit -m "docs: 4주차 활동지 작성"`
