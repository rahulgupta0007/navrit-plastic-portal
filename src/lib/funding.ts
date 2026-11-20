import { z } from "zod";

/** Who funded a payment: company cash held by partners, or a partner's own pocket. */
export const FUNDING_SOURCES = ["COMPANY", "OWN_POCKET"] as const;
export type FundingSource = (typeof FUNDING_SOURCES)[number];

export const fundingSourceSchema = z.enum(FUNDING_SOURCES);
export const optionalFundingSourceSchema = fundingSourceSchema.optional().default("COMPANY");

export function isFundingSource(value: string): value is FundingSource {
  return (FUNDING_SOURCES as readonly string[]).includes(value);
}
