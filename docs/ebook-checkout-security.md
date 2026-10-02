# Ebook Checkout Security (R03)

## Trust Boundary

`ebook-purchase` authenticates every POST with `admin.auth.getUser(token)`.
No request UID, SDK customer ID, redirect value, or PortOne `customData` establishes
buyer identity. `customData.slug` remains a product consistency check only.

The same endpoint has two explicit request shapes:

- `{ slug }`: create an order from a published catalog product with a positive
  integer KRW price. Return `{ ok: true, order: { paymentId, slug, title, price,
  currency, storeId } }` only after the immutable row is persisted.
- `{ slug, paymentId }`: look up the persisted order, reject a different authenticated
  buyer with `403 payment buyer mismatch`, then query PortOne and grant access.
  An explicit null/empty payment ID is invalid; it cannot create an order.

Checkout uses the existing authenticated `MagDB.ebooks.purchaseVerify(slug)`
transport for order creation (JSON serialization omits its undefined payment ID).
This reuses the authenticated DB-client transport and Supabase configuration;
no new Edge Function is required.

## Immutable Orders And Grants

`ebook_checkout_orders` permanently binds the server-generated UUID payment ID,
authenticated buyer, product ID, slug, title, price, KRW currency, and store ID.
No browser/editor role can read or write it. The service role can SELECT/INSERT
only; an UPDATE/DELETE trigger also protects against accidental privileged edits.
Foreign keys restrict deletion of referenced buyers/products. Account erasure and
order-retention policy need an explicit operational design, not automatic cascade.

Verification requires PAID status, the original order price, explicit KRW currency,
the configured store, the original slug, and a matching provider ID when present.
Catalog price changes or unpublishing do not invalidate a previously issued order.
Orders do not expire: this avoids rejecting legitimate delayed/mobile confirmations.
Abandoned orders grant nothing and cannot be rebound. Existing publication behavior
is retained; the currently unused `ebook_on_sale` flag is not newly made a gate.

The service-only `grant_ebook_checkout_order` RPC rechecks buyer ownership and uses
a per-buyer/product transaction lock plus a conditional unique-key upsert. Only
revoked rows can be reactivated. An existing active entitlement of any source is
returned unchanged, including its original receipt and verification timestamps.
Unique payment references remain enforced, and the immutable order keeps ownership
even after a later repurchase replaces an entitlement's old reference.

## Manual Account Erasure

Account erasure remains an email-request/manual operation; this change does not
provide automated deletion. The order foreign keys block deletion of a referenced
auth user or product, and the immutable trigger blocks direct owner changes. This
is a remaining operational policy requirement, not evidence of privacy compliance.

1. Independently verify the requester and obtain the owner's authorization. Record
   a restricted-access case ID, the affected account, and the approved retention
   decision for receipts and other identifying data. Payment references can remain
   identifying even after an account pointer is removed.
2. Inventory dependent orders, entitlements, profile data, and provider records.
   Plan a maintenance window that prevents new checkout/grant activity for the
   account, and revoke its sessions before erasure. Do not simply retry auth-user
   deletion or assign its orders to another real buyer.
3. Prepare a separately reviewed, uniquely named migration for audited owner
   anonymization and compatible FK handling. Its design must remove the live-account
   link, prevent anonymized orders from ever granting to another account, and retain
   only the evidence approved by the owner. A non-login tombstone requires an
   explicitly reviewed identity/FK design; it cannot be inserted as a new buyer under
   the present schema. Any necessary change to the immutability guard must be narrow,
   transactional, and reviewed, with normal protections restored before completion.
4. Test that migration in a disposable database and staging, checking expected row
   counts, account deletion, retained-reference uniqueness, denial of old/other-buyer
   claims, and unchanged access for unrelated buyers. Approve the recovery plan and
   any temporary handling of identifying backups before execution.
5. Execute only through the approved migration process, then complete account/data
   deletion and provider-retention steps as authorized. Record the migration version,
   approver, outcome, and affected row counts in the restricted audit trail, avoiding
   unnecessary copies of personal data. Verify there are no remaining live owner
   links or account sessions, and confirm the outcome to the requester.

No anonymization migration or erasure is implemented/executed here. Do not use ad hoc
SQL, service-role writes, global trigger disabling, or relaxed browser privileges to
work around the ledger. For products, unpublish rather than delete while referenced;
physical deletion likewise requires a separately approved migration/retention plan.

## Legacy Policy

- Existing active PortOne grants remain valid. The original authenticated owner
  can receive a read-only `already: true` acknowledgement for the recorded payment
  and product, even if PortOne is unavailable. No new grant or update occurs.
- Another buyer is rejected, including someone already entitled to the product.
- Legacy unbound unused IDs and revoked legacy grants cannot be automatically
  claimed/reactivated (`409 legacy payment unbound`). Even a PAID lookup with a
  browser-supplied UID is insufficient proof. No bulk binding/backfill is performed.
- Editors must investigate the receipt and independently establish the buyer before
  an existing manual-grant or refund workflow is used. Do not ask customers to pay
  again before resolving a previously charged legacy payment.

This deliberately closes first-claim theft while preserving existing access. An old
client left open across rollout may charge an unbound payment; it enters the manual
review policy rather than being assigned to the first caller.

## Status, Recovery And Cancellation

Existing `ebook-page` revalidation is unchanged: it checks active automatic receipts
periodically, revokes on definitive non-PAID status, and preserves existing access
on provider failure. It does not recheck today's catalog price. The shared
entitlement module and Smart Store redemption are untouched.

For new verification, cancelled/partially cancelled/failed payments never grant or
reactivate access. The purchase endpoint does not itself revoke an existing grant;
that remains the reader revalidation workflow. Browser cancellation clears only
local recovery state, never deletes the immutable order or calls a cancellation API.
No payment cancellation/refund API is introduced.

Pending provider status, transport failure, ambiguous SDK exception, and a different
logged-in account retain the server payment ID for safe retry. Definite errors clear
local recovery; legacy failures display the receipt ID for editor review. Redirect
IDs are untrusted inputs and always pass server ownership checks. SDK results cannot
replace the original server ID. Local pending state still expires after 24 hours;
the server binding does not, and the original buyer can submit the receipt ID later.

## Integration And Verification

Apply `20261003000001_ebook_checkout_orders.sql` before deploying the changed function,
then publish the changed checkout asset with the unified cache bump. Existing
deployment scans include the function automatically. Baseline and DB contract checks
remain required. If the migration is missing, order lookups fail closed, not legacy.

Deployment sequencing is implemented in the workflow configuration:
`functions-deploy.yml` is the single automatic DB/function workflow, triggered by
both migration and function changes. One checkout/job runs link, migration push,
then all function deployments; migration failure stops the job before deployment.
The database password is provided to link and push. `db-deploy.yml` is manual-only,
labelled Manual Recovery. Both workflows share project-specific workflow concurrency
with `cancel-in-progress: false`, preventing concurrent pushes without interrupting
an in-flight deployment. GitHub permissions remain `contents: read` only.
`tests/unit/supabase-deployment.spec.mjs` guards the bounded source contract for
triggers, ordering, failure handling, credentials, concurrency, and permissions
without adding a YAML dependency. It is not a YAML parser or a live deployment test.
Netlify/cached-client rollout coordination remains separate from DB/function ordering.

Behavior tests cover authenticated A/B ownership before/after first use, forged UID,
immutable pricing, repeated/simultaneous verification, active-grant preservation,
revoked repurchase, provider mismatches, outages, legacy policy, SDK order sequencing,
redirect/cancellation recovery, and SQL security structure. The original behavior
tests use local Supabase/PortOne mocks. `tests/unit/ebook-orders-sql.spec.mjs` also
executes the unmodified migration in an in-memory PGlite PostgreSQL engine with
stubbed pre-existing auth/catalog/entitlement tables and roles. It verifies the real
immutable trigger, table/RPC privileges, deny-all order RLS (including after test-only
table grants), buyer checks, conditional grants, replay safety, active-grant
preservation, and revoked/unbound legacy policy. Handler integration tests use real
database queries/RPC and a mocked provider. The existing entitlement SELECT policy
is stubbed, not validated against the full Supabase schema.

PGlite uses one database connection: these tests execute the advisory lock but do
not prove contention between independent production sessions. Multi-session locking,
the full Supabase/PostgREST runtime, and a staged sandbox payment remain rollout
checks. No test connects to a production database or payment provider.
