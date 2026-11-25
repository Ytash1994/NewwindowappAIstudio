# Security Specification & Payload-First Security TDD

## 1. Data Invariants
1. **Strict Tenant Isolation:** A workshop user (`tenantId == request.auth.uid`) may only read/write their own `/tenants/{tenantId}` document and `/tenants/{tenantId}/projects/{projectId}` subcollection.
2. **Server-Enforced Trial & Subscription Lock:** Non-admin users can ONLY create their own tenant with `subscriptionStatus: 'trialing'`, `planId: 'trial'`, `trialDays: 7`, `activeUntil: null`, `role: 'owner'`, and `createdAt == request.time`. Once `request.time > createdAt + duration.value(trialDays, 'd')` and `subscriptionStatus != 'active'`, all project writes under `/tenants/{tenantId}/projects/{projectId}` are rejected at the Firestore Rules layer.
3. **Anti-Privilege Escalation:** Non-admin users are strictly forbidden from modifying `role`, `subscriptionStatus`, `planId`, `trialDays`, `activeUntil`, `adminNote`, or `createdAt` on their own tenant document, and cannot write to `/admins`, `/plans`, `/config`, or `/audit_logs`.
4. **Bootstrapped Owner Free Access:** Verified admin (`xtashtoush@gmail.com` with `email_verified == true` or `/admins/{uid}`) has permanent unrestricted access and manages plans, platform settings, activation approvals, and tenant subscriptions.
5. **PII Isolation:** `/tenants/{tenantId}` and `/activation_requests/{requestId}` contain PII (`email`, `phone`) and deny blanket reads to non-owners/non-admins.
6. **Terminal State Locking:** Activation requests with `status` in `['approved', 'rejected']` cannot be mutated by non-admin users.
7. **Master Gate Relational Sync:** Every project write under `/tenants/{tenantId}/projects/{projectId}` verifies parent `/tenants/{tenantId}` exists and has active access.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Admin Escalation:** Tenant A attempts to create `/tenants/uidA` with `role: 'admin'`.
2. **Free Lifetime Activation Spoof:** Tenant A attempts to create `/tenants/uidA` with `subscriptionStatus: 'active'` or `trialDays: 9999`.
3. **Trial Extension Update Attack:** Tenant A attempts to update `/tenants/uidA` changing `subscriptionStatus` to `'active'` or `trialDays` to `30`.
4. **Shadow Field Injection:** Tenant A attempts to update `/tenants/uidA` with `workshopName: 'X'` + ghost field `isPaid: true`.
5. **Client Timestamp Backdating:** Tenant A attempts to create `/tenants/uidA` with a future `createdAt` timestamp to extend trial.
6. **Cross-Tenant PII Read:** Tenant A attempts to `get` `/tenants/uidB` to read Tenant B's email/phone.
7. **Cross-Tenant Project Write:** Tenant A attempts to create `/tenants/uidB/projects/p1` with `ownerUid: 'uidA'`.
8. **Expired Trial Project Write:** Tenant A (whose 7-day trial expired and is unpaid) attempts to create a new project under `/tenants/uidA/projects/p2`.
9. **ID Poisoning Attack:** Tenant A attempts to create `/tenants/uidA/projects/bad..id$with/spaces` or a 200-char ID.
10. **Self-Approving Activation Request:** Tenant A attempts to create `/activation_requests/req1` with `status: 'approved'` or update an existing pending request to `'approved'`.
11. **Unverified Admin Email Spoof:** Unverified auth token (`email_verified: false`) with email `xtashtoush@gmail.com` attempts to list `/tenants` or modify `/plans/pro`.
12. **Audit Log Tampering:** Non-admin user attempts to create, update, or delete `/audit_logs/log1`, or even admin attempts to mutate/delete an immutable audit log.
