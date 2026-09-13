#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const PLACEHOLDER_PATTERN = /\b(?:TODO|TBD|FIXME|REPLACE[_ -]?ME|CHANGE[_ -]?ME)\b|\[(?:TODO|REQUIRED INPUT):/gi;
const SECRET_PATTERN = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp|github_pat|glpat|npm_[A-Za-z0-9]+|sk)-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{32,})/g;

const args = process.argv.slice(2);
const root = resolveRoot(args);
const allowPublisherInputs = args.includes('--allow-publisher-inputs');
const requiredMaterials = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/workflows/ci.yml',
  'plugins/varoriya-generate/.codex-plugin/plugin.json',
  'plugins/varoriya-generate/skills/varoriya-generation-workflow/SKILL.md',
  '.agents/plugins/marketplace.json',
  'server/Dockerfile',
  'server/.env.example',
  'scripts/validate-plugin.mjs',
  'docs/evals/submission-test-cases.md',
  'docs/evals/release-evidence-template.md',
  'docs/quality/release-checklist.json',
  'docs/quality/release-checklist.md',
  'docs/guides/USER_GUIDE_EN.md',
  'docs/guides/USER_GUIDE_TH.md',
  'docs/guides/ADMIN_DEVELOPER_GUIDE_EN.md',
  'docs/guides/ADMIN_DEVELOPER_GUIDE_TH.md',
  'docs/publishing/LISTING_COPY.md',
  'docs/publishing/SUBMISSION_GUIDE.md',
  'docs/publishing/LEGAL_REQUIREMENTS.md',
  'docs/publishing/RELEASE_NOTES.md',
  'docs/security/THREAT_MODEL.md',
  'docs/decisions/ADR-003-quote-cost-idempotency.md',
  'docs/decisions/ADR-004-upload-security.md',
  'docs/decisions/ADR-005-observability.md',
  'docs/decisions/ADR-006-provider-contract.md',
];

const findings = [];
const checked = [];
for (const relative of requiredMaterials) {
  const file = path.join(root, relative);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) {
      findings.push({ code: 'MISSING_OR_EMPTY', path: relative, message: 'Required publish material is missing or empty.' });
      continue;
    }
    checked.push(relative);
  } catch {
    findings.push({ code: 'MISSING_OR_EMPTY', path: relative, message: 'Required publish material is missing or empty.' });
  }
}

for (const relative of checked.filter((file) => !isScanExempt(file) && !file.endsWith('.env.example'))) {
  const contents = await readFile(path.join(root, relative), 'utf8');
  for (const match of contents.matchAll(PLACEHOLDER_PATTERN)) {
    findings.push({ code: 'PLACEHOLDER', path: relative, message: `Unresolved publish placeholder: ${match[0]}` });
  }
}

for (const relative of await sourceFiles(root)) {
  if (isScanExempt(relative)) continue;
  const contents = await readFile(path.join(root, relative), 'utf8');
  for (const match of contents.matchAll(SECRET_PATTERN)) {
    findings.push({ code: 'SECRET_PATTERN', path: relative, message: `Potential credential material detected near offset ${match.index}.` });
  }
}

await validateJson('plugins/varoriya-generate/.codex-plugin/plugin.json', (value) => {
  if (
    value.name !== 'varoriya-generate' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.version) ||
    typeof value.description !== 'string' ||
    value.description.trim() === ''
  ) {
    findings.push({ code: 'INVALID_MANIFEST', path: 'plugins/varoriya-generate/.codex-plugin/plugin.json', message: 'Plugin manifest must contain the expected name, version, and description.' });
  }
});
await validateJson('.agents/plugins/marketplace.json', (value) => {
  if (!Array.isArray(value.plugins) || !value.plugins.some((plugin) => plugin?.name === 'varoriya-generate')) {
    findings.push({ code: 'INVALID_MARKETPLACE', path: '.agents/plugins/marketplace.json', message: 'Marketplace must advertise varoriya-generate.' });
  }
});
await validateJson('docs/quality/release-checklist.json', (value) => {
  if (!Array.isArray(value.gates) || value.gates.length < 1) {
    findings.push({ code: 'INVALID_CHECKLIST', path: 'docs/quality/release-checklist.json', message: 'Machine-readable release checklist must define at least one gate.' });
  }
  const manual = value.gates?.filter((gate) => gate?.execution === 'manual') ?? [];
  if (manual.length === 0) {
    findings.push({ code: 'INVALID_CHECKLIST', path: 'docs/quality/release-checklist.json', message: 'Manual external gates must be explicitly represented.' });
  }
});

const waivedFindings = allowPublisherInputs
  ? findings.filter(isPublisherInputFinding)
  : [];
const blockingFindings = findings.filter((finding) => !waivedFindings.includes(finding));
const output = {
  schema_version: 'release-submission-validation.v1',
  ok: blockingFindings.length === 0,
  publish_ready: findings.length === 0,
  root,
  checked_materials: checked,
  findings: blockingFindings,
  waived_findings: waivedFindings,
  exemptions: [
    'server/.env.example is a configuration template and must contain non-secret replacement guidance only.',
    'docs/evals/release-evidence-template.md is an evidence form and may contain controlled reviewer fields.',
    'Validator source is excluded from literal-pattern scanning but is still required and executed.',
    'PENDING_MANUAL_EXECUTION is allowed only for external/manual evidence gates.',
  ],
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = blockingFindings.length === 0 ? 0 : 1;

async function validateJson(relative, validator) {
  try {
    const value = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
    validator(value);
  } catch (error) {
    findings.push({ code: 'INVALID_JSON', path: relative, message: error instanceof SyntaxError ? 'Required JSON file is invalid.' : 'Required JSON file could not be read.' });
  }
}

function resolveRoot(args) {
  const rootIndex = args.indexOf('--root');
  return path.resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : path.join(import.meta.dirname, '../..'));
}

function isScanExempt(relative) {
  return (
    relative === 'docs/evals/release-evidence-template.md' ||
    relative === 'scripts/validate-plugin.mjs' ||
    relative === 'scripts/release/validate-submission.mjs'
  );
}

function isPublisherInputFinding(finding) {
  return (
    finding.code === 'PLACEHOLDER' &&
    finding.message.includes('[REQUIRED INPUT:') &&
    (
      finding.path.startsWith('docs/guides/') ||
      finding.path.startsWith('docs/publishing/')
    )
  );
}

async function sourceFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ['.git', 'node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile() && /\.(?:md|json|ya?ml|ts|mjs|sql|txt|example)$/i.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}
