"use client";

import { ACCOUNT_PERSONS, type AccountPerson } from "@/lib/account-persons";
import { AdminSelect } from "@/components/admin-select";

type Props = {
  value: string;
  onChange: (value: AccountPerson | "") => void;
  /** Unified label used across purchases, sales, expenses, labour, settlements. */
  label?: "Payment done by" | "Received by" | "Partner" | "Money held by";
  className?: string;
  required?: boolean;
  id?: string;
};

/**
 * Shared person picker so every payment attribution syncs with Accounts.
 */
export function PersonSelect({
  value,
  onChange,
  label = "Payment done by",
  className = "",
  required = false,
  id,
}: Props) {
  return (
    <AdminSelect
      id={id}
      className={className}
      label={label}
      required={required}
      placeholder={label}
      value={value}
      onChange={(v) => onChange(v as AccountPerson | "")}
      options={[
        { value: "", label: label },
        ...ACCOUNT_PERSONS.map((person) => ({ value: person, label: person })),
      ]}
    />
  );
}
