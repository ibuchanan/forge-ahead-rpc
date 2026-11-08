# Audit events for authentication and authorization

<!-- cspell:words webtrigger CloudEvents AuthN AuthZ OCSF CADF CAEP -->

## V1 contract for JSON-RPC Backbone

This section is normative for the [JSON-RPC Backbone](json-rpc-backbone.md).
The standards survey below is background, **not** a claim that this package
implements OCSF, CADF, CAEP, NIST, PCI DSS, ISO compliance, durable retention,
or tamper-evident storage. V1 chooses CloudEvents as its event envelope.
CloudEvents does not itself establish delivery, retention, or immutability.

### Ownership and seam

- This library owns the RPC-specific event vocabulary, safe field selection,
  and emission points. An app supplies a CloudEvents publisher and an operator
  failure callback. Keep generic CloudEvents formatting, schema validation,
  and the publisher port in a separately testable module; it may later move to
  `@forge-ahead/logging` without moving authentication or RPC policy there.
  Structured Forge/Pino logs alone do not count as publisher acknowledgement.
- A published event needs a generated event ID, event type and source, timestamp,
  installation/environment identity, generated request correlation ID, decision
  or outcome, and a safe reason category. Verified calls may also contain Jira's
  verified account ID, the known exposed method, and declared execution mode.
  Failed authentication has **no verified account ID**; never derive an audit
  identity from the supplied token or email. Do not include API tokens, Basic
  headers, raw requests, params, unverified claims, raw exceptions, or sensitive
  user details. Make type names and safe reason codes stable before implementation.
  Never use the caller's JSON-RPC ID as a replay key or a trusted event ID.
- Emit unsampled authentication and authorization decisions, including rejects.
  A denied method remains denied even if event publishing fails. For bad Basic
  credentials return a generic HTTP 401; for verified identity lacking Jira
  `ADMINISTER` return 403; for Jira verification unavailable return sanitized
  503. Rejection event publishing is best effort and must not mask those responses;
  call the operator failure callback on publishing failure. Avoid leaking an
  unknown versus unexposed method: both look unknown publicly after auth, while
  audit data may distinguish their safe reason codes. An exposed but denied
  method returns a sanitized not-permitted error.

### Audit-critical methods

- A reviewed method-level OpenRPC extension declares the minimum audit-critical
  status. Trusted installation policy may make more methods critical, never fewer.
  Do not enable a critical method without a configured CloudEvents publisher.
- Before starting a critical handler, publish an attempt/authorization event and
  wait for publisher acknowledgement. A rejection, error, or timeout fails closed:
  do not execute the handler. A timeout leaves publication uncertain; do not
  claim the event was absent. The library trusts the publisher's acknowledgement
  contract and does not demand proof of durable storage.
- After handler execution, attempt an outcome event. If publishing fails after
  a successful command (including a write), return its success to the caller and
  invoke the required operator failure callback with safe diagnostics. Do not
  turn a completed write into an apparent retryable failure, claim rollback, or
  claim the audit trail is complete. A failed attempt to publish this operator
  signal is an operational concern for the consuming app; v1 does not promise
  guaranteed notification delivery. For critical pre-execution failure, the
  handler never starts; for non-critical operations, publishing is best effort.
- The event contract applies to the default internal-use Jira Basic-token
  authenticator and to replacements. A replacement authenticator must provide
  equally trusted attribution and cannot bypass OpenRPC exposure or minimum
  audit requirements. No credential issuance/rotation/revocation events are
  required of this library in v1: it does not manage credentials.

### Tests and operational limits

Test safe event shapes and correlation, verified versus unverified attribution,
unsampled decisions, failure/timeout before critical execution, best-effort
denials, post-write outcome failure, and the failure callback. Supply a fake
publisher to the dispatcher/adapter tests; deployed tests must separately
validate the real publisher's behavior. Consumers own publisher selection,
access to audit records, storage, retention, redaction beyond the defined safe
fields, and any applicable compliance obligations.

## Background: audit logging standards

The following source material is retained for context; it is not the v1 contract.

<!-- markdownlint-disable MD004 MD007 MD013 MD034 MD060 -->
<!-- cspell:disable -->

## **Executive Summary**

Standardized audit logging is a foundational pillar of modern cybersecurity, regulatory compliance, and incident response architecture. Organizations operating complex distributed systems, hybrid cloud infrastructure, and software-as-a-service (SaaS) environments require consistent event taxonomies to monitor identity lifecycles and enforce Zero Trust principles. A critical operational challenge within audit pipelines is maintaining a strict semantic distinction between **Authentication (AuthN)**—verifying identity—and **Authorization (AuthZ)**—verifying access privileges. This document details established industry schemas, compliance mandates, comparative event models, and implementation patterns for structuring AuthN and AuthZ audit telemetry.

## **1\. Schema & Taxonomy Standards**

Several standardized logging specifications govern the schema, field taxonomy, and serialization of identity audit events. Adopting these open standards enables interoperability across Security Information and Event Management (SIEM), Security Orchestration, Automation, and Response (SOAR), and Extended Detection and Response (XDR) platforms.

### **1.1 Open Cybersecurity Schema Framework (OCSF)**

Developed as an open-source collaborative standard by organizations including AWS, Splunk, CrowdStrike, and IBM, OCSF provides vendor-agnostic taxonomy for security events. Within OCSF, **Category 3 (Identity & Access Management)** defines specific event classes for AuthN and AuthZ:

> * **Class 3001 (Authentication):** Dedicated strictly to identity verification events. It tracks logon attempts (interactive, remote, service-to-service), logoffs, multi-factor authentication (MFA) challenges, ticket-granting operations (e.g., Kerberos TGT), and session refreshes.
> * **Class 3002 (Account Change):** Captures modifications to account states, including credential resets, password modifications, API key generation, and account lockout/unlock events.
> * **Class 3003 (Entity Management):** Records provisioning, updating, and de-provisioning of users, devices, service principals, and identity assets.
> * **Class 3005 (Group Management):** Tracks privilege escalations, role assignments, and directory group membership changes.
> * **Class 3006 (Authorize / Access Control):** Captures granular authorization evaluation events. It explicitly records whether an authenticated principal was granted or denied access to a specific object or function based on Access Control Lists (ACLs), Role-Based Access Control (RBAC), or Attribute-Based Access Control (ABAC) policies.

### **1.2 Cloud Auditing Data Federation (CADF — DMTF DSP0262)**

Standardized by the Distributed Management Task Force (DMTF) and aligned with ISO/IEC 19086, CADF defines an audit data model tailored for cloud and multi-tenant environments (notably used in OpenStack). CADF models events using the **Action-Target-Initiator** paradigm and requires seven core dimensions:

> 1. **Initiator (Who):** Unique identifier of the human user, API caller, or service agent executing the action.
> 2. **Action (What):** Standardized taxonomy verbs including authenticate, authenticate/login, authenticate/logout, authorize, authorize/permit, authorize/deny, and evaluate.
> 3. **Target (On What):** The specific resource, API endpoint, data object, or server being accessed or manipulated.
> 4. **Location (Where):** Physical or logical network location hosting the target service.
> 5. **Observer / Reporter (From Where):** Client endpoint identifier, IP address, and reporting agent telemetry.
> 6. **Timestamp (When):** High-precision synchronized time in UTC format.
> 7. **Outcome (Result):** Standard outcome status categorized as success, failure, or unknown.

### **1.3 OpenID Shared Signals and Events (SSE) & CAEP (RFC 8935 / RFC 8936\)**

Standardized under the OpenID Foundation, the **Continuous Access Evaluation Profile (CAEP)** and **Shared Signals and Events (SSE)** frameworks provide standard event payloads for federated identity environments. They facilitate real-time telemetry sharing between Identity Providers (IdPs) and Relying Parties (RPs):

> * session-revoked: Indicates administrative or security-triggered termination of an active session.
> * token-claims-change: Emitted when an identity’s group membership, scopes, or assigned claims change mid-session.
> * credential-change: Signals password changes, FIDO2 passkey registration, or biometric factor invalidation.
> * assurance-level-change: Triggered when risk posture fluctuates, prompting step-up authentication or privilege re-evaluation.

### **1.4 Traditional SIEM Standards: CEF and LEEF**

Legacy SIEM ecosystems rely on Common Event Format (CEF — Micro Focus ArcSight) and Log Event Extended Format (LEEF — IBM QRadar). These formats utilize structured syslog headers paired with standardized key-value pairs (e.g., DeviceEventClassID such as AUTH-FAIL, AUTH-SUCCESS, PRIV-ELEVATION, and ACCESS-DENIED).

## **2\. Regulatory & Compliance Mandates**

While schema frameworks prescribe JSON/data representations, compliance standards mandate the operational coverage, minimum data fields, and governance around audit generation.

> * **NIST SP 800-53 (Revision 5\) — AU Family:**
  * **AU-2 (Event Logging):** Requires recording successful and failed logon attempts, administrative privilege use, password changes, and access control list modifications.
  * **AU-3 (Content of Audit Records):** Mandates six core elements per record: timestamp, event type, component/system identifier, source address/location, actor identity, and event outcome.
  * **AU-12 (Audit Generation):** Specifies that audit capabilities must be integrated directly into identity and authorization engines.
> * **PCI DSS v4.0 (Requirement 10 — Log and Monitor All Access):**
  * **Req 10.2.1.1:** Logging all individual user access to cardholder data and system components.
  * **Req 10.2.1.2:** Logging all administrative and root-level actions.
  * **Req 10.2.1.4:** Logging all invalid logical access attempts (failed authentications and unauthorized access denials).
  * **Req 10.2.1.5:** Logging changes to identification and authentication mechanisms.
> * **ISO/IEC 27002:2022 (Control 8.15 — Logging):** Mandates comprehensive event logging capturing user IDs, timestamps, event details, device identifiers, and records of accepted/rejected access attempts with tamper-evident safeguards.

## **3\. Comparative Specification: AuthN vs. AuthZ Telemetry**

A robust audit pipeline must separate authentication and authorization telemetry to prevent pipeline ingestion bottlenecks and ensure precise threat detection.

| Dimension | Authentication (AuthN) | Authorization (AuthZ)   |
| :---- | :---- | :---- |
| **Fundamental Question** | “Are you who you claim to be?” | “Are you permitted to perform this specific action?” |
| **Standard Event Actions** | login.attempt, login.success, login.failure, mfa.challenge, mfa.verify, token.issued, token.revoked, logout | access.permitted, access.denied, role.assigned, role.revoked, policy.evaluated, privilege.escalation.attempt |
| **Subject / Actor Attributes** | Claimed username, email, device ID, source IP address, user-agent string, session identifier. | Authenticated Principal UID, active roles, delegated authority (“on behalf of”), tenant ID. |
| **Contextual & Environmental Telemetry** | Auth protocol (OIDC, SAML, Kerberos), factor type (TOTP, FIDO2, SMS), risk score, geolocation. | Target resource URI/URN, requested HTTP action/verb, requested scope, environmental context (time window, network zone). |
| **Engine / Evaluation Telemetry** | Identity Provider (IdP) metadata, realm name, authentication service endpoint. | Policy Decision Point (PDP) engine (e.g., Open Policy Agent, AWS IAM, Cedar), policy ID, rule ID. |
| **Status & Outcome Payloads** | SUCCESS, FAILURE, CHALLENGE\_REQUIRED Reason: INVALID\_CREDENTIALS, ACCOUNT\_LOCKED, EXPIRED\_TOKEN | ALLOW, DENY Reason: MISSING\_PERMISSION, EXPLICIT\_DENY, CONDITIONAL\_ACCESS\_FAIL |

## **4\. Reference Implementation Schemas (OCSF JSON)**

To align with modern industry standards, enterprise architectures should implement structured JSON payloads conforming to OCSF Class 3001 and Class 3006\.

### **4.1 Authentication Event Schema (OCSF Class 3001\)**

{
  "time": "2026-11-08T17:42:01.120Z",
  "class\_uid": 3001,
  "category\_uid": 3,
  "activity\_id": 1,
  "activity\_name": "Logon",
  "status\_id": 2,
  "status": "Failure",
  "status\_detail": "INVALID\_MFA\_TOKEN",
  "actor": {
    "user": {
      "uid": "usr\_99214a",
      "name": "alex.chen@example.com"
    }
  },
  "src\_endpoint": {
    "ip": "198.51.100.45",
    "port": 54322,
    "user\_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  },
  "auth\_protocol": "OIDC",
  "mfa\_factor": "TOTP"
}

### **4.2 Authorization Event Schema (OCSF Class 3006\)**

{
  "time": "2026-11-08T17:42:05.882Z",
  "class\_uid": 3006,
  "category\_uid": 3,
  "activity\_id": 1,
  "activity\_name": "Authorize",
  "status\_id": 2,
  "status": "Deny",
  "status\_detail": "MISSING\_REQUIRED\_ROLE",
  "actor": {
    "user": {
      "uid": "usr\_99214a"
    },
    "roles": \["viewer"\]
  },
  "target": {
    "resource": {
      "uid": "prod-db-customer-pii",
      "type": "database\_table"
    }
  },
  "requested\_action": "DROP\_TABLE",
  "policy": {
    "id": "pol\_data\_retention\_strict",
    "rule": "deny-unprivileged-drop"
  }
}

## **5\. Operational Best Practices**

> * **PII & Credential Hygiene:** Ensure sensitive secrets—such as raw passwords, session cookies, bearer tokens, or sensitive API keys—are never emitted into log payloads. Use truncated identifiers or cryptographic hashes where trace tracking is required.
> * **Immutability and Integrity (WORM):** Route audit events immediately to append-only, Write-Once-Read-Many (WORM) storage with cryptographic sealing to prevent tampering by compromised administrative accounts.
> * **Time Synchronization:** Enforce Network Time Protocol (NTP) synchronization across all authentication and authorization decision points to ensure consistent event sequencing during forensic analysis.
> * **Sampling Policy Separation:** While high-volume authorization checks (e.g., microservice mesh traffic) may require rate-limiting or selective sampling, all authentication attempts (successful and failed) and authorization *denials* must be logged deterministically without sampling.
