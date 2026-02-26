# Example: Security audit an entire codebase

Save this file as `my_prompt.md` and run:
```bash
cleave --git-commit --max-sessions 10 my_prompt.md
```

---

You are performing a security audit of a web application codebase. Your job is to
review every file, identify vulnerabilities, classify their severity, and produce
a structured report.

## Project Layout
```
./src/               — Application source code
./audit/             — OUTPUT: your audit reports go here
  findings.json      — Machine-readable findings (you create this)
  report.md          — Human-readable report (you create this)
  file-status.md     — Checklist of files reviewed (you create this)
```

## What to Look For

For EACH source file, check for:

**Critical:**
- SQL injection (string concatenation in queries)
- Command injection (user input in exec/spawn/system calls)
- Path traversal (user input in file operations)
- Hardcoded secrets (API keys, passwords, tokens in source)
- Insecure deserialization (pickle, yaml.load, eval of user input)

**High:**
- Cross-site scripting (XSS) — unescaped user input in HTML output
- Authentication bypass — missing auth checks on protected routes
- Broken access control — horizontal/vertical privilege escalation
- Sensitive data exposure — logging passwords, tokens in error messages
- Insecure direct object references — sequential IDs without ownership checks

**Medium:**
- Missing rate limiting on sensitive endpoints
- Weak password requirements
- Missing CSRF protection
- Overly permissive CORS
- Missing security headers

**Low:**
- Verbose error messages in production
- Missing input validation (non-security-critical)
- Outdated dependencies (check package.json/requirements.txt)

## Workflow Per File

1. READ the file completely
2. CHECK against every vulnerability category above
3. For each finding, record in `findings.json`:
   ```json
   {
     "file": "src/routes/auth.js",
     "line": 42,
     "severity": "critical",
     "category": "sql_injection",
     "description": "User input concatenated into SQL query",
     "snippet": "db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)",
     "recommendation": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = ?', [req.params.id])"
   }
   ```
4. UPDATE `file-status.md` marking the file as reviewed
5. Move to the next file

## What "Done" Means

Every `.js`, `.ts`, `.py`, or source file has been reviewed. `findings.json` contains
all findings. `report.md` contains an executive summary with findings grouped by
severity and category, plus a remediation priority list.

## How to Start

Check `.cleave/PROGRESS.md`. If empty:
1. `find ./src -name "*.js" -o -name "*.ts" -o -name "*.py" | wc -l` to count files
2. Start with high-risk files: auth, payment, admin, file upload handlers
3. Then work through remaining files systematically

When at ~50% context, STOP and do the handoff procedure.
