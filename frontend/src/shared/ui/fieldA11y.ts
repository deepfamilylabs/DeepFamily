interface FieldErrorA11yArgs {
  invalid: boolean;
  errorId: string;
  describedByIds?: string[];
}

export function getFieldErrorA11y({
  invalid,
  errorId,
  describedByIds = [],
}: FieldErrorA11yArgs) {
  const describedBy = invalid ? [...describedByIds, errorId] : describedByIds;

  return {
    fieldProps: {
      "aria-invalid": invalid || undefined,
      "aria-describedby": describedBy.length > 0 ? describedBy.join(" ") : undefined,
    },
    errorProps: {
      id: errorId,
      role: "alert" as const,
    },
  };
}
