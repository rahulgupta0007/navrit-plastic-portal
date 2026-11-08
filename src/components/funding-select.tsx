"use client";

import { FUNDING_SOURCES, type FundingSource } from "@/lib/funding";
import { AdminSelect } from "@/components/admin-select";

type Props = {
  value: FundingSource | "";
  onChange: (value: FundingSource) => void;
  className?: string;
  label?: string;
};

const LABELS: Record<FundingSource, string> = {
  COMPANY: "Company cash",
  OWN_POCKET: "Own pocket",
};

/** Company cash vs partner's own pocket — drives Accounts due-to-partner math. */
export function FundingSelect({ value, onChange, className = "", label = "Paid from" }: Props) {
  return (
    <AdminSelect
      className={className}
      label={label}
      value={value || "COMPANY"}
      onChange={(v) => onChange((v || "COMPANY") as FundingSource)}
      options={FUNDING_SOURCES.map((source) => ({
        value: source,
        label: LABELS[source],
      }))}
    />
  );
}
