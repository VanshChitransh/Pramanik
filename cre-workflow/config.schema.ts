import { z } from "zod";

export const configSchema = z.object({
  kycApiUrl:         z.string().url(),
  chainSelectorName: z.string(),
  kycGateAddress:    z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  registryAddress:   z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  provider:          z.enum(["mock", "jumio", "onfido"]),
  jurisdictionRules: z.record(z.object({
    minTier:   z.enum(["RETAIL", "ACCREDITED", "INSTITUTIONAL"]),
    ttlDays:   z.number().positive(),
    sanctions: z.array(z.string()),
  })),
});

export type Config = z.infer<typeof configSchema>;
