# Quality evidence

The quality folder contains release gates that can be evaluated by automation and reviewed during submission.

- `release-checklist.json` is the machine-readable gate source.
- `release-checklist.md` explains commands, acceptance criteria, and approval boundaries.
- `../evals/submission-test-cases.md` defines reviewer-ready positive, negative, concurrency, and manual cases.
- `../evals/release-evidence-template.md` is the controlled evidence record for a release run.

The harness has a no-credit policy: it uses local fakes only. External provider and ChatGPT evidence remains pending until a human executes the documented procedures.
