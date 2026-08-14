# SaaS Reference Catalog — Best-in-Class Practices

A grounding document for the Architect and Security Reviewer subagents. Before proposing or approving an architectural choice, consult this catalog: **how do commercial SaaS companies at this scale actually solve this problem?**

This is not a checklist. It is a reference frame. Every entry is citable — named company, published source, URL. The subagents use it to anchor recommendations in real practice rather than first-principles reasoning alone.

---

## 1. The foundational pattern: own your cloud account

No best-in-class SaaS company runs production on a convenience PaaS like Vercel, Heroku, Render, or Netlify. They run on their own cloud accounts — AWS, GCP, or Azure — where they control the entire security perimeter.

### Atlassian

- Runs entirely on AWS. Products (Jira, Confluence, Bitbucket, Statuspage) run on an internal PaaS called **Micros** built on top of AWS.
- "Atlassian cloud apps and data are hosted on industry-leading cloud provider Amazon Web Services (AWS). Our products run on a platform as a service (PaaS) environment." Each service is containerized and deployed via Micros or Kubernetes, with automated security and compliance controls.
- Developers provide a service descriptor and container image; Micros deploys all required resources (databases, caches, load balancers, firewall rules) with opinionated defaults that enforce security.
- **Source:** Atlassian Cloud Architecture and Operational Practices — https://www.atlassian.com/trust/reliability/cloud-architecture-and-operational-practices
- **Source:** Atlassian Cloud Engineering Overview — https://www.atlassian.com/engineering/cloud-overview

### Salesforce

- Runs its own infrastructure. Implements a centralized secrets management system with RBAC and code scanning to prevent accidental secret exposure.
- Uses Heroku (which it owns) as a PaaS for customer-facing app hosting, but Heroku itself runs on AWS infrastructure that Salesforce controls.
- **Source:** Salesforce Platform Architecture — https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-transformation.html

### HubSpot

- Runs on AWS (since ~2008) with expansion to GCP for multi-region. Infrastructure includes ~2,500 EC2 instances, petabytes of data, 400+ MySQL databases migrated to Kubernetes via Vitess.
- Built infrastructure abstraction layer so teams write infrastructure-as-code and the tooling handles provisioning across cloud providers.
- **Source:** HubSpot Engineering Blog, "Infrastructure as Code: Getting the best of both worlds with AWS and Google Cloud Platform" — https://product.hubspot.com/blog/infrastructure-as-code-getting-the-best-of-both-worlds-with-aws-and-google-cloud-platform

### Shopify

- Runs on GCP with Kubernetes. Built its own internal PaaS called **CloudBuddy** (inspired by Heroku) on top of Kubernetes so engineers deploy in an opinionated, standardized way.
- Multi-tenant architecture with data isolation enforced at the infrastructure level.
- **Source:** Software Engineering Daily, "Shopify Infrastructure Migration" — https://softwareengineeringdaily.com/2018/10/02/shopify-infrastructure-migration/
- **Source:** Shopify Engineering Blog, multi-tenant architecture — https://www.shopify.com/blog/multi-tenant-architecture

### Stripe

- Runs on AWS. Has a dedicated **Secrets Infrastructure** team responsible for TLS identity, PKI, and secrets management across every service. Services authenticate via internal certificate authority — not static API keys passed between platforms.
- The secrets infrastructure team works in Go, Java, Ruby, and Python across the entire Stripe codebase.
- **Source:** Stripe Careers, "Software Engineer, Secrets Infrastructure" — https://stripe.com/careers/listing/software-engineer-secrets-infrastructure/7396679

### The pattern

Every one of these companies controls its own cloud account. Secrets never leave their perimeter to sit on a third-party platform's dashboard. The internal PaaS (Micros, CloudBuddy, etc.) gives developers the convenience of a Vercel-like deploy experience while keeping secrets, data, and infrastructure inside the company's own security boundary.

**Subagent instruction:** When the Architect proposes a deployment platform (Vercel, Render, Railway, etc.) for a commercial SaaS product, the Reviewer must ask: "Where do secrets physically reside? How many independent breach surfaces exist? What is the blast radius of a platform compromise?" If secrets leave the company's cloud account to sit on a third party's servers, that is a finding against crown jewel #4 (credential/secret security).

---

## 2. Secrets management: the maturity ladder

### Level 1 — Raw environment variables
Secrets in `.env` files, passed around manually. No audit trail, no rotation, no access control. Where most tutorials start. Not acceptable for production.

### Level 2 — CI/CD-native secrets
Secrets pasted into platform dashboards (Vercel env vars, GitHub Actions secrets, trigger.dev env vars). Each platform is its own store of record. Rotation requires visiting every dashboard. This is where the fatloss app currently sits.

### Level 3 — Centralized secrets manager as single source of truth
One vault (Doppler, Infisical, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, HashiCorp Vault) stores all secrets. Platforms pull from the vault via sync integrations. Rotation happens once, propagates everywhere. Audit trail is centralized.

**Doppler** — SaaS, developer-first, syncs to Vercel/GitHub Actions/AWS/Azure/GCP/Kubernetes. Free tier for small teams. Good on-ramp.
- **Source:** Railway, "The Best Secrets Management Platforms for Cloud Apps in 2026" — https://blog.railway.com/p/best-secrets-management-2026

**Infisical** — open-source (MIT), self-hostable, 50+ integrations, internal PKI, RBAC + audit logs.
- **Source:** Infisical on Railway — https://railway.com/deploy/infisical-secrets-manager

**AWS Secrets Manager** — native to AWS, automatic rotation for RDS/Aurora, IAM integration. $0.40/secret/month.
- **Source:** AWS Secrets Manager Review — https://cybersecurityo.com/secrets-management/aws-secrets-manager-review/

**Azure Key Vault** — native to Azure, managed identity integration, RBAC.
- **Source:** Microsoft Learn, Azure Key Vault — https://learn.microsoft.com/en-us/azure/key-vault/

**HashiCorp Vault** — the enterprise standard. Dynamic secrets for 30+ backends, PKI, transit encryption. Overkill for most teams; requires dedicated platform/security headcount to operate.
- **Source:** Railway, "The Best Secrets Management Platforms" — https://blog.railway.com/p/best-secrets-management-2026

### Level 4 — OIDC + dynamic secrets (no static secrets)
Services authenticate via workload identity (OIDC tokens, managed identity). Credentials are generated on demand, expire in minutes, never stored. Only works when the services you connect to support it (AWS IAM, Azure Managed Identity, GCP Workload Identity). Third-party API keys that are issued as static secrets still require Level 3 storage.

- **Source:** Microsoft Learn, Managed Identity for Azure Database for PostgreSQL — https://learn.microsoft.com/en-us/azure/postgresql/security/security-connect-with-managed-identity
- **Source:** Microsoft Learn, Managed Identity overview — https://learn.microsoft.com/en-us/azure/postgresql/security/security-managed-identity-overview

### Where best-in-class companies land

- **Stripe:** Custom internal PKI + secrets management system (effectively Level 4 for internal services, Level 3 for third-party keys).
- **Atlassian, HubSpot, Shopify:** Level 3 minimum (cloud-native secrets managers within their own AWS/GCP accounts), with IAM roles for service-to-service auth (Level 4 where the cloud supports it).
- **The critical distinction:** At Level 3+, secrets never leave the company's own cloud account. There is no third-party dashboard holding a copy.

**Subagent instruction:** The Architect must state the secrets maturity level of the proposed stack. The Reviewer must verify that the level is appropriate for the data sensitivity and compliance requirements of the project. For any commercial SaaS handling customer data, Level 2 (secrets pasted into third-party dashboards) is a BLOCKER finding.

---

## 3. Infrastructure ownership patterns

### Internal PaaS (the dominant pattern at scale)

Best-in-class SaaS companies don't choose between "Vercel convenience" and "raw AWS complexity." They build a thin internal platform that gives developers a standardized deploy experience while keeping everything inside the company's cloud account.

| Company | Internal PaaS | Runs on | Key characteristic |
|---------|--------------|---------|-------------------|
| Atlassian | Micros | AWS | Service descriptor + container image → automated deploy with security defaults |
| Shopify | CloudBuddy | GCP/K8s | Heroku-inspired, opinionated Kubernetes deploy |
| HubSpot | Custom IaC layer | AWS + GCP | Infrastructure-as-code abstracts cloud provider |
| Stripe | Custom platform | AWS | Dedicated secrets infrastructure team, internal CA |

### Managed Kubernetes (the mid-scale pattern)

Companies that aren't large enough to build a full internal PaaS use managed Kubernetes (EKS, GKE, AKS) with standardized deployment tooling (Helm charts, ArgoCD, Flux). Secrets are managed via the cloud provider's secrets manager, injected at runtime via the External Secrets Operator or CSI driver.

- **Source:** LiveRamp, "Building a Secure and Scalable Multi-Tenancy Model on GKE" — https://liveramp.com/blog/building-a-secure-and-scalable-multi-tenancy-model-on-gke

### Managed PaaS on your own cloud (the startup-to-growth pattern)

Platforms like Railway, Qovery, Porter, and Northflank deploy into **your** AWS/GCP/Azure account (BYOC — Bring Your Own Cloud). You get PaaS convenience without handing secrets to a third party. Data stays in your VPC.

- **Source:** Qovery Blog, "Top Vercel Alternatives" — https://www.qovery.com/blog/vercel-alternatives
- **Source:** Northflank Blog, "SaaS deployment in customer environments" — https://northflank.com/blog/saas-deployment-in-customer-environment

**Subagent instruction:** When the Architect proposes a deployment platform, the Reviewer must classify it:
- **Category A — Your cloud account:** AWS/Azure/GCP managed services, BYOC platforms. Secrets stay in your perimeter. Acceptable.
- **Category B — Vendor-hosted, you control nothing:** Vercel, Render, Heroku (non-enterprise), trigger.dev. Secrets reside on the vendor's servers. Requires explicit accepted-risk finding for any commercial SaaS.

---

## 4. Multi-tenancy: data isolation patterns

### Database-per-tenant (strongest isolation)

- **Atlassian** uses database-per-tenant on AWS RDS/Aurora PostgreSQL with multi-AZ. Each database is independently backed up and restorable.
- **Source:** BlackFlow, "How Atlassian Built a Multi-Tenant SaaS Empire" — https://blackflow.co.uk/entreprise-software-development/how-atlassian-built-a-multi-tenant-saas-empire-the-cloud-architecture-behind-jira-and-confluence/

### Schema-per-tenant or RLS (shared database, logical isolation)

- **Shopify** uses shared infrastructure with logical tenant isolation enforced at the application and API layer.
- RLS (Row-Level Security) at the database layer, keyed to `tenant_id`, is the standard pattern for shared-database multi-tenancy. Supabase and Azure Database for PostgreSQL both support native PostgreSQL RLS.
- **Source:** Shopify, "Multi-Tenant Architecture" — https://www.shopify.com/blog/multi-tenant-architecture

### The fatloss-app rehearsal pattern

The fatloss app uses per-user RLS (`user_id = auth.uid()`) on every table. Phalanx should use per-account RLS (`account_id`) with verified isolation via two-tenant integration tests. The mechanism is identical; the isolation boundary is what changes.

**Subagent instruction:** The Reviewer must verify that tenant isolation is not just enabled but **enforced and tested** — with at least two-tenant integration tests proving that tenant A cannot access tenant B's data across all CRUD paths. "RLS is enabled" is not a sufficient control; "RLS is tested" is.

---

## 5. Authentication and identity

### Cloud-native workload identity (the standard for service-to-service auth)

- **AWS:** IAM Roles for service accounts (IRSA) on EKS; execution roles on Lambda/ECS. No static keys.
- **Azure:** Managed Identity on App Service, Functions, Container Apps. No static keys.
- **GCP:** Workload Identity on GKE; service account impersonation. No static keys.
- For CI/CD: OIDC federation (GitHub Actions → AWS/Azure/GCP) eliminates static CI credentials entirely.

### User authentication

Best-in-class SaaS companies use established identity providers rather than rolling their own:
- **Auth0 / Okta** — most common for B2B SaaS
- **Microsoft Entra ID** — for enterprise customers with existing Azure/M365
- **Supabase Auth, Firebase Auth, Clerk** — for earlier-stage or developer-focused products
- **Custom** — only at Stripe/Atlassian scale where the identity system is itself a product feature

**Subagent instruction:** The Architect should justify the auth provider choice against the product's target customer. The Reviewer should verify that the auth provider's breach history and compliance posture are acceptable for the data being protected.

---

## 6. Platform review requirements (for the Security Reviewer)

Every platform or tool the Architect proposes is itself a trust boundary. The Reviewer must evaluate each one as an attack surface, not accept it as a fixed constraint.

### Required evaluation per platform

For every platform in the proposed stack, the Reviewer must answer:

1. **Secret residency:** Where do my secrets physically reside on this platform? Can I retrieve them after setting them? Can platform employees access them?
2. **Breach history:** Has this platform been breached? What was exposed? (Vercel had a supply chain attack in 2026 that exfiltrated customer environment variables.)
3. **Compliance posture:** SOC 2 Type II? ISO 27001? What does their security page actually say vs. what's in progress?
4. **Blast radius:** If this platform is compromised, what can an attacker reach through the secrets stored there?
5. **Audit trail:** Can I see who accessed which secrets and when?
6. **Data residency:** Where is the data physically stored? Does it cross jurisdictions?

### Classification

- **BLOCKER** if: secrets with access to the system of record (e.g., `service_role` key, database credentials) reside on a vendor-hosted platform with no audit trail and a breach history.
- **Critical** if: secrets reside on a vendor-hosted platform with SOC 2 and audit trails, but blast radius includes the system of record.
- **High** if: non-sensitive secrets reside on a vendor-hosted platform.
- **Acceptable** if: secrets reside in the company's own cloud account behind IAM/managed identity.

---

## 7. The Phalanx-specific playbook (derived from the catalog)

Based on the patterns above, the reference architecture for Phalanx (multi-tenant freight track-and-trace SaaS, reviewed by Tech Mahindra senior architects):

1. **Azure as the platform** (existing relationship via OpenAI)
2. **Azure App Service or Container Apps** for the web application
3. **Azure Functions** for background/cron jobs
4. **Azure Database for PostgreSQL Flexible Server** with Managed Identity auth and RLS at `account_id`
5. **Azure Key Vault** for third-party secrets (carrier API keys, OAuth tokens)
6. **Managed Identity** connecting all Azure services — no static keys between your own services
7. **GitHub Actions with Azure OIDC** — no static credentials in CI
8. **Auth via Microsoft Entra ID or Auth0** — depending on enterprise customer requirements
9. **Secrets maturity: Level 3 for third-party keys (Key Vault), Level 4 for Azure-to-Azure (Managed Identity)**

This matches the pattern used by Atlassian, HubSpot, Shopify, and Stripe — own your cloud account, authenticate with identity not keys, store remaining static secrets in your own vault.

---

## 8. Using this catalog

### For the Architect

Before proposing any tool, platform, or architectural pattern, check this catalog:
- **Default to Microsoft Azure** (existing relationship via Azure OpenAI). Proposing a non-Azure platform requires explicit justification and a documented trade-off.
- Is there a best-in-class example of how a commercial SaaS company solved this?
- If you're proposing something different from the catalog pattern, why? Document the trade-off.
- If the catalog doesn't cover your specific problem, say so — and flag it as custom design requiring extra scrutiny.

### For the Security Reviewer

Before approving any architectural choice, check this catalog:
- **Azure is the default platform.** If the Architect proposes a non-Azure tool, the burden of justification is on them. Evaluate the alternative against the Azure-native equivalent.
- Does the proposed approach match what best-in-class companies do?
- If not, is there a documented reason, or did the Architect default to a convenience tool?
- Every proposed platform gets a Section 6 evaluation before it passes the gate.
- "This is what the tutorial used" is not a valid justification for a platform choice on a commercial SaaS product.

---

## 9. Maintaining this catalog

This document is a living reference. Add entries when:
- A best-in-class company publishes new architecture details
- A platform experiences a security incident that changes its risk profile
- A new pattern emerges that the subagents should be aware of
- A Phalanx architectural decision reveals a gap in the catalog's coverage

Every entry must include: company name, the specific practice, a citable source with URL. No entry based on inference or general knowledge alone.

---

*This catalog exists because the architect-reviewer loop missed a fundamental security finding — secrets distributed across third-party platforms — that any commercial SaaS security review would have caught. The gap wasn't in the methodology; it was in the reference frame. Both subagents were reasoning from frameworks (OWASP, STRIDE) without grounding in how real companies actually build. This catalog closes that gap.*
