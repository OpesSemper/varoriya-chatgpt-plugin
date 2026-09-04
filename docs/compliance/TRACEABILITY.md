# Requirements and control traceability

| Requirement | ISO 29110 work product/process | ISO 27001 control | Verification | Evidence owner |
|---|---|---|---|---|
| Approved scope and SRS before critical build | PM Project Planning; SI Requirements Analysis | A.5.8 | baseline review | Product/Delivery |
| Secure MCP architecture and ADRs | SI Architecture and Detailed Design | A.8.27 | architecture/security review | Solution Architect |
| OAuth and resource authorization | SI Construction and Tests | A.8.26, A.8.29 | positive and negative auth tests | Security Lead |
| Protected source and reviewed changes | Configuration/Repository Record | A.8.4, A.8.32 | branch/review audit | Release Manager |
| Secure tool implementation | Software Components/Build | A.8.25, A.8.28 | SAST, review, test | Backend Lead |
| Vulnerability handling | Issue/Correction Record | A.8.8 | scan and remediation report | Security Lead |
| Configuration and environment separation | Configuration/Repository Record | A.8.9, A.8.31 | configuration review | DevOps/SRE |
| Logging, audit events, and monitoring | Test Result/Report; Progress Status | A.8.15, A.8.16 | log/alert tests | DevOps/SRE |
| Security acceptance before release | Acceptance/Delivery Record | A.8.29, A.8.34 | security review and approval | QA/Security |
| Controlled external/provider work | Change Request; Delivery Record | A.8.30 | vendor and change review | Delivery Lead |

Detailed rows must link requirement ID → risk/control → issue/PR → test → immutable evidence → release.
