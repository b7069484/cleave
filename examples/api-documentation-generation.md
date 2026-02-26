# Example: Generate API documentation for every endpoint

Save this file as `my_prompt.md` and run:
```bash
cleave --git-commit --max-sessions 12 my_prompt.md
```

---

You are generating comprehensive API documentation for a REST API with 80+ endpoints.
The source of truth is the codebase itself — route handlers, middleware, models, and
existing inline comments.

## Project Layout
```
./api/
  routes/          — Express route files (one per resource)
  middleware/       — Auth, validation, rate limiting
  models/          — Sequelize/Mongoose models
  validators/      — Request validation schemas
./docs/
  api/             — OUTPUT: one .md file per resource
  api/overview.md  — OUTPUT: table of contents + auth guide
```

## For Each Route File

1. READ the route file and its associated model/validator
2. For each endpoint, document:
   - Method + path (e.g., `POST /api/v2/users`)
   - Description of what it does (infer from handler logic)
   - Authentication required? Which roles?
   - Request parameters (path, query, body) with types and validation rules
   - Request body example (JSON)
   - Response format with example (success + common errors)
   - Rate limits if any
   - Related endpoints
3. WRITE the documentation to `./docs/api/{resource}.md`
4. After each file, verify it's valid markdown: `npx markdownlint docs/api/{file}.md`

## Documentation Format

Use this template for each endpoint:

```markdown
### `POST /api/v2/users`

Create a new user account.

**Authentication:** Required (admin role)

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | yes | Valid email address |
| name | string | yes | Full name (2-100 chars) |

**Example Request:**
​```json
{ "email": "jane@example.com", "name": "Jane Doe" }
​```

**Response (201):**
​```json
{ "id": "usr_abc123", "email": "jane@example.com", "created_at": "..." }
​```

**Errors:**
- `400` — Validation failed
- `409` — Email already exists
- `403` — Insufficient permissions
```

## What "Done" Means

Every route file has a corresponding docs file. `./docs/api/overview.md` exists with
a table of all endpoints grouped by resource. All markdown files pass linting.

## How to Start

Check `.cleave/PROGRESS.md`. If empty:
1. `ls api/routes/` to inventory all resources
2. Start with the simplest resource (usually `health.js` or `status.js`)
3. Work through them in order of complexity

When at ~50% context, STOP and do the handoff procedure.
