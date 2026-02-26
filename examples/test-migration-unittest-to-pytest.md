# Example: Migrate 200+ test files from unittest to pytest

Save this file as `my_prompt.md` and run:
```bash
cleave --verify "pytest ./tests/ -x --tb=short" --git-commit --max-sessions 15 my_prompt.md
```

---

You are converting a Python test suite from `unittest` to `pytest`. There are 200+
test files in `./tests/`, each containing one or more test classes.

## Project Layout
```
./src/           — Application source (DO NOT MODIFY)
./tests/         — 200+ test files using unittest (convert these)
./conftest.py    — Create/update shared pytest fixtures here
./pytest.ini     — Pytest configuration (already exists)
```

## Conversion Rules

For EACH test file:

1. Remove `import unittest` and all `from unittest import ...` statements
2. Convert test classes to standalone functions:
   - `class TestUser(unittest.TestCase):` → remove the class wrapper
   - `def test_login(self):` → `def test_login():`
3. Convert all assertions:
   - `self.assertEqual(a, b)` → `assert a == b`
   - `self.assertNotEqual(a, b)` → `assert a != b`
   - `self.assertTrue(x)` → `assert x`
   - `self.assertFalse(x)` → `assert not x`
   - `self.assertIsNone(x)` → `assert x is None`
   - `self.assertIn(a, b)` → `assert a in b`
   - `self.assertRaises(E)` → `with pytest.raises(E):`
   - `self.assertAlmostEqual(a, b)` → `assert a == pytest.approx(b)`
4. Convert setUp/tearDown:
   - `setUp(self)` → `@pytest.fixture` with function parameter injection
   - `tearDown(self)` → fixture with `yield` for cleanup
   - `setUpClass(cls)` → `@pytest.fixture(scope="module")`
5. Convert `self.skipTest(...)` → `pytest.skip(...)`
6. After converting each file: run `pytest <file> -x` to verify
7. If it fails: read the error, fix it, re-run until green
8. Move to the next file

## Important Details

- Some test files import from other test files (test helpers). Convert those FIRST.
- Look for `./tests/conftest.py` and `./tests/helpers/` — these may need special handling
- If a test uses `mock.patch`, keep it — pytest is compatible with `unittest.mock`
- If you find `@unittest.expectedFailure`, convert to `@pytest.mark.xfail`
- Preserve test docstrings — they're used in reports

## What "Done" Means

ALL files in `./tests/` are converted. Running `pytest ./tests/` produces 0 failures.
No remaining `import unittest` statements anywhere in `./tests/`.

## How to Start

Check `.cleave/PROGRESS.md` for prior session progress. If empty, start with:
1. `find ./tests/ -name "*.py" | sort` to get the full file list
2. Check for helper/utility test files and convert those first
3. Work alphabetically through the rest

When at ~50% context, STOP and do the handoff procedure.
