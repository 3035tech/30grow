import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { withPlatformBillingApi } from '../../../../../lib/billing/admin-api.js';
import { adminRefundPreview, performBillingOperation } from '../../../../../lib/billing/admin.js';
import { BILLING_ADMIN_ACTIONS, BILLING_OPERATION_REASONS, BILLING_REFUND_BASES } from '../../../../../lib/billing/catalog.js';
import { auditFromRequest } from '../../../../../lib/audit.js';
const base = {
  companyId: zPositiveInt,
  requestId: z.uuid(),
  confirmed: z.literal(true),
  reason: z.enum(BILLING_OPERATION_REASONS),
  note: z.string().trim().max(1000).default('')
};
export const GET = withPlatformBillingApi({
  query: z.object({
    companyId: zPositiveInt,
    invoiceId: z.string().regex(/^in_[a-zA-Z0-9]+$/),
    requestedAt: z.iso.datetime({
      offset: true
    }).optional()
  })
}, ({
  query
}) => adminRefundPreview(query.companyId, query.invoiceId, query.requestedAt));
export const POST = withPlatformBillingApi({
  body: z.discriminatedUnion('kind', [z.object({
    ...base,
    kind: z.enum(BILLING_ADMIN_ACTIONS)
  }), z.object({
    ...base,
    kind: z.literal('refund'),
    invoiceId: z.string().regex(/^in_[a-zA-Z0-9]+$/),
    basis: z.enum(BILLING_REFUND_BASES),
    amount: z.number().int().positive(),
    requestedAt: z.iso.datetime({
      offset: true
    }).optional()
  })])
}, async ({
  body,
  payload,
  request
}) => {
  const operation = await performBillingOperation({
    ...body,
    actorUserId: payload.userId
  });
  await auditFromRequest(request, {
    actorUserId: payload.userId,
    companyId: body.companyId,
    action: 'billing.admin_operation',
    targetType: 'billing_operation',
    targetId: operation.id,
    metadata: {
      kind: operation.kind,
      status: operation.status,
      amount: operation.amount,
      currency: operation.currency
    }
  });
  return {
    operation
  };
});
