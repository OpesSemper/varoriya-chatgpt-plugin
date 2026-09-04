# GitHub issue index

The logical task ID is canonical. GitHub issue numbers are execution links and can differ from dependency order.

| ID | Issue | Severity | Depends on |
|---|---:|---:|---|
| GOV-001 | [#1](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/1) | SEV-0 | — |
| REQ-001 | [#2](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/2) | SEV-0 | GOV-001 |
| ARCH-001 | [#3](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/3) | SEV-0 | REQ-001 |
| SEC-001 | [#4](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/4) | SEV-0 | ARCH-001 |
| SEC-002 | [#5](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/5) | SEV-0 | SEC-001 |
| COST-001 | [#6](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/6) | SEV-0 | TOOL-001, SEC-002 |
| TOOL-001 | [#7](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/7) | SEV-1 | REQ-001, ARCH-001 |
| FILE-001 | [#8](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/8) | SEV-1 | TOOL-001, SEC-002 |
| OPS-001 | [#9](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/9) | SEV-1 | ARCH-001, TOOL-001 |
| PKG-001 | [#10](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/10) | SEV-1 | TOOL-001, SEC-002 |
| QA-001 | [#11](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/11) | SEV-1 | COST-001, FILE-001 |
| COMP-001 | [#12](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/12) | SEV-1 | REQ-001, QA-001 |
| SUB-001 | [#13](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/13) | SEV-1 | PKG-001, QA-001, COMP-001 |
| REV-001 | [#14](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/14) | SEV-0 | SUB-001 |
| REL-001 | [#15](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/15) | SEV-0 | REV-001 approved |
| UI-001 | [#16](https://github.com/OpesSemper/varoriya-chatgpt-plugin/issues/16) | SEV-3 | REL-001 |
