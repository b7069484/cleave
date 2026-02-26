# Cleave for Claude Code — GitHub Setup Guide

## Repo Description (paste into GitHub's "About" field)

```
Chain Claude Code sessions with self-authored handoffs. Each session writes its own
continuation prompt with accumulated knowledge. Objective verification, rate limit
resilience, loop detection. One shell script. Zero dependencies.
```

## Topics / Tags (add these in GitHub repo settings)

```
claude-code, ai-coding, autonomous-agent, context-window, session-management,
developer-tools, bash, cli, open-source, agentic-coding
```

---

## Branching Policy

**Never push directly to `main`.** All changes — whether human or AI-authored — must go through pull requests:
1. Create a feature or fix branch (`git checkout -b fix/your-fix-name`)
2. Push to the branch and open a PR into `main`
3. Merge only when all tests pass and there are no conflicts

---

## How to Create the GitHub Repo from the Zip

### Step 1: Extract and enter the folder

```bash
# Unzip where you want the repo to live
unzip cleave.zip
cd cleave
```

### Step 2: Initialize git

```bash
git init
git add -A
git commit -m "Initial commit: Cleave for Claude Code v2.3.0"
```

### Step 3: Create the GitHub repo

Option A — GitHub CLI (fastest):
```bash
# If you have `gh` installed:
gh repo create cleave --public --source=. --push \
  --description "Chain Claude Code sessions with self-authored handoffs. One script. Zero dependencies."
```

Option B — Manual:
1. Go to https://github.com/new
2. Repo name: `cleave`
3. Description: (paste from above)
4. Public
5. Do NOT initialize with README (you already have one)
6. Create repository
7. Then push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/cleave.git
git branch -M main
git push -u origin main
```

### Step 4: Enable GitHub Pages (for the landing page)

1. Go to repo **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/docs`
4. Save
5. Your landing page will be live at: `https://YOUR_USERNAME.github.io/cleave/`

### Step 5: Add repo metadata

In the repo's **About** section (gear icon on the right side of the repo page):
- Description: (paste from above)
- Website: `https://YOUR_USERNAME.github.io/cleave/`
- Topics: `claude-code`, `ai-coding`, `autonomous-agent`, `context-window`, `bash`, `cli`

---

## Folder Structure You Should See

```
cleave/
├── cleave                  # Main executable script (~560 lines)
├── README.md               # Full documentation
├── LICENSE                  # MIT
├── .gitignore
├── examples/
│   ├── test-migration-unittest-to-pytest.md
│   ├── api-documentation-generation.md
│   ├── security-audit.md
│   ├── batch-csv-cleaning.md
│   ├── app-localization-15-languages.md
│   └── research-dataset-cataloging.md
└── docs/
    └── index.html          # Landing page (GitHub Pages)
```

---

## Optional: Create a Release

After pushing, tag a release so people can install a specific version:

```bash
git tag -a v2.3.0 -m "Cleave v2.3.0 — self-authored handoffs, verification, knowledge accumulation"
git push origin v2.3.0
```

Then go to **Releases** on GitHub → **Draft a new release** → Choose tag `v2.3.0`:

**Release title:** `Cleave v2.3.0`

**Release notes** (paste this):

```markdown
## Cleave for Claude Code v2.3.0

Chain Claude Code sessions together automatically. Each session writes its own
continuation prompt — not a template, a bespoke briefing with lessons learned,
dead ends mapped, and exact resume points. Knowledge compounds across sessions.

### Features
- **Self-authored handoffs** — agent writes NEXT_PROMPT.md with full context
- **Knowledge accumulation** — append-only KNOWLEDGE.md grows across all sessions
- **Objective verification** — `--verify CMD` checks completion with real tests
- **Rate limit resilience** — detects limits, waits with countdown, retries
- **50% context threshold** — hands off before quality degrades
- **Subagent spawning** — `--subagents` hints agent to use fresh context windows
- **Loop detection** — stops after 3 consecutive identical handoffs
- **Git checkpoints** — `--git-commit` after each session
- **Desktop notifications** — macOS and Linux alerts
- **Crash recovery** — falls back to initial prompt + progress + knowledge
- **Full audit trail** — every prompt, progress, handoff archived

### Install
```bash
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/cleave/main/cleave
chmod +x cleave
sudo mv cleave /usr/local/bin/
```

### Credits
Built on ideas from Ralph Wiggum (verification-first), GSD (context rot research),
claude-auto-resume (rate limit detection), and claude-session-init (persistent knowledge).
```

Then attach the `cleave` script file as a release binary.

---

## Optional: Add a Social Preview Image

GitHub lets you set a social preview image (shows when the repo link is shared).
Recommended: 1280×640px. You could screenshot the landing page's hero section
or create a simple graphic with:
- "Cleave for Claude Code" in a bold font
- "Infinite context. Zero dependencies." as subtitle
- Dark background matching the landing page aesthetic
