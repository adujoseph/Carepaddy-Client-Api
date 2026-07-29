import { z } from '@docs/zod-extend';

export const registerCarehomeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  cqcNumber: z.string().trim().min(1).max(50),
  email: z.email(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish'),
  address: z.object({
    postcode: z.string().trim().min(2).max(20),
    fullAddress: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(100),
  }),
  password: z.string().min(12).max(200),
});

export type RegisterCarehomeInput = z.infer<typeof registerCarehomeSchema>;
