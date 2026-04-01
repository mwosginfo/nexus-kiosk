# BUG: FRA Check-in Only Marks 1 Contract as Arrived

## Problem
When an FRA agency scans their QR code at the kiosk, only ONE contract/worker under the `transaction_ref` gets marked as `arrived`. The other contracts remain `pending`. The Agency Hire page then only shows 1 active worker instead of the full batch.

## Root Cause: Kiosk App (NOT Nexus)

**Kiosk behavior (from NEXUS_INTEGRATION.md Section 9):**
```sql
-- Kiosk looks up FRA by transaction_ref, LIMIT 1
SELECT * FROM fra_registrations
WHERE transaction_ref = $1 ... LIMIT 1;

-- Then marks ONLY that one row by id
UPDATE fra_registrations
SET status = 'arrived', arrived_at = NOW()
WHERE id = $fra_id;  -- ← BUG: only updates 1 row
```

**Nexus behavior (correct):**
```sql
-- Nexus marks ALL rows with matching transaction_ref
UPDATE fra_registrations
SET status = 'arrived', arrived_at = NOW()
WHERE transaction_ref = $1 AND status = 'pending';
-- ↑ Updates ALL contracts in the batch
```

## Fix Required (Kiosk App)

Change the kiosk's FRA arrival update from:
```typescript
// WRONG — updates only 1 row
await supabase.from('fra_registrations')
  .update({ status: 'arrived', arrived_at: new Date().toISOString() })
  .eq('id', fraRow.id);
```

To:
```typescript
// CORRECT — updates all contracts in the batch
await supabase.from('fra_registrations')
  .update({ status: 'arrived', arrived_at: new Date().toISOString() })
  .eq('transaction_ref', transactionRef)
  .eq('status', 'pending');
```

## Temporary Fix (Nexus Side)

Nexus's `fra.service.ts` `checkin()` method already calls `markFraTransactionRefArrived(transactionRef)` which updates ALL pending rows by `transaction_ref`. If the client checks in via Nexus (Backend > Check-in page), all contracts are correctly marked.

The issue only occurs when the standalone kiosk app does the check-in, because it updates by `id` instead of `transaction_ref`.

## Verification

To check if a batch has partially-arrived contracts:
```sql
SELECT transaction_ref, status, COUNT(*)
FROM fra_registrations
WHERE transaction_ref = 'XXXXXXXXXXXXXXXX'
GROUP BY transaction_ref, status;
```

If you see both `pending` and `arrived` for the same `transaction_ref`, this bug is the cause.
