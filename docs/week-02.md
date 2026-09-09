# 2주차 활동지 / Week 2 Worksheet

**AI 협업 방식 비교 / Comparing two ways of working with AI**

- 작성일 / Date: 9/9/2026
- 참여자 / Present: 3/4 (파르하나, 무하마드 샤피크, 아이잣)
- 결과보고서 / Report chapter: 6장 AI 활용과 판단
- 최종 반영 / Feeds into: PROMPTS.md 첫 항목

---

## 구현할 작은 기능 / Small feature
없음


## 사용한 도구 / Tool used
Gemini


## 방식 A — 통째로 요청 / One big request

# 프롬프트 
```
메모 검색 기능 만들어줘. 제목이랑 본문에서 키워드로 찾을 수 있게.
```
### 결과
```
# Example data structure using a list of dictionaries
notes = [
    {"id": 1, "title": "Shopping List", "content": "Buy apples, bananas, milk", "user_id": 101},
    {"id": 2, "title": "Meeting Notes", "content": "Project kickoff tomorrow at 10 AM", "user_id": 101},
    {"id": 3, "title": "Study Plan", "content": "Learn Python list comprehensions", "user_id": 102}  # Different user
]

def search_notes(notes, keyword, user_id):
    """
    Searches notes belonging strictly to `user_id` by matching `keyword` in title or content.
    """
    trimmed_keyword = keyword.strip().lower()
    
    results = []
    for note in notes:
        # 1. User Security Check: Ensure only the user's own notes are processed
        if note["user_id"] != user_id:
            continue
            
        # If keyword is empty, return all notes for this user
        if not trimmed_keyword:
            results.append(note)
            continue
            
        # 2. Case-insensitive keyword matching
        title_match = trimmed_keyword in note["title"].lower()
        content_match = trimmed_keyword in note["content"].lower()
        
        if title_match or content_match:
            results.append(note)
            
    return results

.# Example Usage:
print("User 101 searching for 'meeting':")
print(search_notes(notes, "meeting", user_id=101))

print("\nUser 101 searching for 'python' (belongs to User 102):")
print(search_notes(notes, "python", user_id=101))  # Returns [] because of user isolation
```
### 문제점
```
→ CONVENTIONS.md violations
- Did not follow the project's JavaScript/SQL layer structure.
- Empty keyword was not validated as a 400 error.
- Did not follow the required { ok: true, data } / { ok: false, error } response format.
```

## 방식 B — 4단계 분해 / spec → context → unit → verify

### 프롬프트 
[지시]
메모 검색 기능을 추가해줘. 제목과 본문에서 키워드로 검색된다.
[규약]
.# 프로젝트 규약
이 문서는 코드를 작성할 때 지켜야 할 규칙입니다.
.## 계층 분리
- `routes.js`는 HTTP 요청과 응답만 다룹니다. SQL을 직접 쓰지 않습니다.
- 데이터베이스 접근은 `service.js`에만 둡니다.
.## 응답 형식
모든 응답은 다음 두 형태 중 하나입니다.
```json
{ "ok": true,  "data": ... }
{ "ok": false, "error": "ERROR_CODE" }
```
에러 코드는 대문자와 밑줄로 씁니다. (예: `MEMO_NOT_FOUND`)
.## 명명 규칙
- 함수명은 동사로 시작합니다. `list`, `get`, `create`, `update`, `remove`
- 데이터베이스 컬럼은 스네이크 케이스를 씁니다. `user_id`, `created_at`
- 자바스크립트 변수는 카멜 케이스를 씁니다. `userId`, `createdAt`
.## 입력 검증
- 사용자 입력은 반드시 검증합니다.
- 검증에 실패하면 400과 함께 `{ ok: false, error }` 를 반환합니다.
.## 권한
- 모든 조회와 수정은 **본인 소유 데이터로 한정**합니다.
- 모든 쿼리에 `user_id` 조건을 포함합니다.
[근거]
1. schema.sql 파일
-- memo-seed 데이터베이스 스키마
CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE memos (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_memos_user ON memos(user_id);
2. service.js 파일
const db = require('./db');
/**
 * 사용자의 메모 목록을 최신순으로 조회한다.
 */
function listMemos(userId) {
  return db.all(
    `SELECT id, title, created_at
       FROM memos
      WHERE user_id = ?
      ORDER BY created_at DESC`,
    [userId]
  );
}
/**
 * 메모 한 건을 조회한다. 본인 메모가 아니면 null을 반환한다.
 */
function getMemo(userId, memoId) {
  return db.get(
    `SELECT id, title, body, created_at
       FROM memos
      WHERE id = ? AND user_id = ?`,
    [memoId, userId]
  );
}
/**
 * 메모를 생성한다.
 */
function createMemo(userId, title, body) {
  return db.run(
    `INSERT INTO memos (user_id, title, body, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [userId, title, body]
  );
}
module.exports = { listMemos, getMemo, createMemo };
3. routes.js 파일
const express = require('express');
const service = require('./service');
const router = express.Router();
// 메모 목록 조회
router.get('/memos', async (req, res) => {
  const memos = await service.listMemos(req.user.id);
  res.json({ ok: true, data: memos });
});
// 메모 단건 조회
router.get('/memos/:id', async (req, res) => {
  const memo = await service.getMemo(req.user.id, req.params.id);
  if (!memo) {
    return res.status(404).json({ ok: false, error: 'MEMO_NOT_FOUND' });
  }
  res.json({ ok: true, data: memo });
});
// 메모 생성
router.post('/memos', async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ ok: false, error: 'TITLE_AND_BODY_REQUIRED' });
  }
  const result = await service.createMemo(req.user.id, title, body);
  res.status(201).json({ ok: true, data: { id: result.lastID } });
});
module.exports = router;

[종료조건]
- GET /memos/search?q=키워드 로 호출된다
- 제목 또는 본문에 키워드가 포함된 메모만 반환한다
- 본인 메모만 반환한다
- q가 비어 있으면 400과 { ok: false, error } 를 반환한다

### 결과
프로젝트 규약과 종료 조건에 맞춰 구현한 `service.js`와 `routes.js`의 추가/수정 코드입니다.

---

.### 1. `service.js` 수정

`searchMemos` 함수를 추가합니다. (함수명은 동사로 시작, SQL 접근 및 `user_id` 조건 포함)

```javascript
/**
 * 제목이나 본문에서 키워드로 사용자의 메모를 검색한다.
 */
function searchMemos(userId, query) {
  const keyword = `%${query}%`;
  return db.all(
    `SELECT id, title, created_at
       FROM memos
      WHERE user_id = ?
        AND (title LIKE ? OR body LIKE ?)
      ORDER BY created_at DESC`,
    [userId, keyword, keyword]
  );
}

module.exports = { listMemos, getMemo, createMemo, searchMemos };

```

---

.### 2. `routes.js` 수정

`/memos/search` 라우트를 추가합니다. 입력값 검증 실패 시 `400` 상태 코드와 에러 응답을 반환하도록 처리합니다.

```javascript
// 메모 검색 (기존 GET /memos/:id 보다 상단에 배치)
router.get('/memos/search', async (req, res) => {
  const { q } = req.query;

  // 입력 검증: q가 없거나 빈 문자열(공백 제외)인 경우 400 반환
  if (!q || !q.trim()) {
    return res.status(400).json({ ok: false, error: 'QUERY_REQUIRED' });
  }

  const memos = await service.searchMemos(req.user.id, q.trim());
  res.json({ ok: true, data: memos });
});

```

> **참고**: Express 라우팅 특성상 `GET /memos/search` 요청이 `GET /memos/:id`에 가려지지 않도록, `/memos/search` 라우트를 `/memos/:id` 라우터보다 **상단**에 작성해야 합니다.

### Check Report for group A

| No. | Check Item | Result / Details |
| --- | --- | --- |
| **①** | **Time taken to successful execution** | `0 minutes 40 seconds` |
| **②** | **Number of non-existent functions and columns created** | `1` (No made-up names used) |
| **③** | **CONVENTIONS.md Number of violations** | `4` (Followed all guidelines: verbs for function names, snake_case DB columns, `{ ok, data/error }` structure, `user_id` scope, and input validation) |
| **④** | **Points fixed by hand** | `None` (Code is fully functional and strictly follows Express route ordering rules) |
| **⑤** | **Is only my own memo returned?** | **Yes** |

### Check Report for group B

| No. | Check Item | Result / Details |
| --- | --- | --- |
| **①** | **Time taken to successful execution** | `0 minutes 9 seconds` |
| **②** | **Number of non-existent functions and columns created** | `0` (No made-up names used) |
| **③** | **CONVENTIONS.md Number of violations** | `0` (Followed all guidelines: verbs for function names, snake_case DB columns, `{ ok, data/error }` structure, `user_id` scope, and input validation) |
| **④** | **Points fixed by hand** | `None` (Code is fully functional and strictly follows Express route ordering rules) |
| **⑤** | **Is only my own memo returned?** | **Yes** |

---

### Verification for Item ⑤ (`user_id` check)

The generated SQL query explicitly includes the `user_id = ?` condition in combination with the keyword search conditions:

```sql
SELECT id, title, created_at
  FROM memos
 WHERE user_id = ?
   AND (title LIKE ? OR body LIKE ?)
 ORDER BY created_at DESC

```

* **Scope Enforcement:** Because `user_id = ?` is enforced at the database layer via parameters `[userId, keyword, keyword]`, users can **only** search within their own memos, preventing unauthorized cross-user memo exposure.


### 문제점
- outputs only the changed part of code, and has to be copy and pasted into the full document by hand

## 두 방식의 차이 / Difference
4-1. What is the biggest difference between the two results?
One of the biggest differences is that group B provided the AI with specific instructions and material that group A did not provide, thus the output yielded by group B was faster by 31 seconds difference and more accurate. The AI is able to follow the guidelines specified in CONVENTIONS.md while group A managed to violate all of the guidelines.



4-2. Is Group A's failure due to the model, or is it due to what we did not provide? Please state your reasoning.
Group A's failure is not due to the model, we believe that due to lack of resources like route.js and service.js, the result does not follow the main objectives included in CONVENTIONS.md as intended. Without the additional information in structure management, the result ends up as a stand-alone code.

4-3. Among the materials provided by Group B, what would you choose as the one that changed the results the most? Why do you think so?
I think the 근거 material is the one that changed the results the most. In my opinon, most of the requirements specified in the 규약 material is implied or can be deduced just by looking at the 근거 material. this is especially true when the added search memo function is structually similar to the other functions that is found in the service.js and routes.js files. 


## 내가 개입해야 했던 지점 / Where you intervened
Group A: Corrections on method search_notes()
Group B: The agent outputs only the added part of the code, and has to be copy and pasted into the full files by hand



---

> 수업 종료 시 커밋하세요 / Commit this at the end of class
> `git add docs/week-02.md && git commit -m "docs: 2주차 활동지 작성"`
