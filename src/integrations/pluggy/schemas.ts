import { z } from 'zod';

const Participant = z.object({
  name: z.string().nullish(),
  documentNumber: z
    .object({ value: z.string().nullish(), type: z.enum(['CPF', 'CNPJ']).nullish() })
    .nullish(),
});

export const PluggyItemSchema = z.object({
  id: z.string(),
  status: z.string(),
  consentExpiresAt: z.coerce.date().nullish(),
});

export const PluggyAccountSchema = z.object({
  id: z.string(),
  type: z.enum(['BANK', 'CREDIT']),
  subtype: z.string().nullish(),
  name: z.string(),
  balance: z.number(),
});

export const PluggyInvestmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  balance: z.number(),
});

export const PluggyInvestmentMovementSchema = z.object({
  id: z.string(),
  type: z.string(),
  date: z.coerce.date(),
  amount: z.number(),
  netAmount: z.number().nullish(),
  quantity: z.number().nullish(),
  value: z.number().nullish(),
});

export const PluggyBillSchema = z.object({
  id: z.string(),
  dueDate: z.coerce.date(),
  totalAmount: z.number(),
});

export const PluggyTransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: z.coerce.date(),
  description: z.string(),
  type: z.enum(['DEBIT', 'CREDIT']),
  amount: z.number(),
  status: z.enum(['PENDING', 'POSTED']).nullish(),
  operationType: z.string().nullish(),
  paymentData: z
    .object({ paymentMethod: z.string().nullish(), payer: Participant.nullish(), receiver: Participant.nullish() })
    .nullish(),
  creditCardMetadata: z
    .object({
      installmentNumber: z.number().int().nullish(),
      totalInstallments: z.number().int().nullish(),
      purchaseDate: z.coerce.date().nullish(),
      billId: z.string().nullish(),
      cardNumber: z.string().nullish(),
    })
    .nullish(),
});
