type ResultDataRowProps = {
  label: string;
  value: string;
  colorClass?: "green" | "blue" | "yellow" | "orange";
  isPlainText?: boolean;
};

const colorConfig = {
  green: {
    labelColor: "text-green-800 dark:text-green-200",
    valueBg: "bg-green-100 dark:bg-green-800",
    valueColor: "text-green-900 dark:text-green-100",
  },
  blue: {
    labelColor: "text-blue-800 dark:text-blue-200",
    valueBg: "bg-blue-100 dark:bg-blue-800",
    valueColor: "text-blue-900 dark:text-blue-100",
  },
  yellow: {
    labelColor: "text-yellow-800 dark:text-yellow-200",
    valueBg: "bg-yellow-100 dark:bg-yellow-800",
    valueColor: "text-yellow-900 dark:text-yellow-100",
  },
  orange: {
    labelColor: "text-orange-800 dark:text-orange-200",
    valueBg: "bg-orange-100 dark:bg-orange-800",
    valueColor: "text-orange-900 dark:text-orange-100",
  },
};

export function ResultDataRow({
  label,
  value,
  colorClass = "green",
  isPlainText = false,
}: ResultDataRowProps) {
  const config = colorConfig[colorClass];

  return (
    <div className="flex flex-col gap-1">
      <span className={`text-xs font-medium ${config.labelColor}`}>{label}</span>
      {isPlainText ? (
        <span className={`text-xs ${config.valueColor}`}>{value}</span>
      ) : (
        <code
          className={`${config.valueBg} ${config.valueColor} px-2 py-1 rounded-sm font-mono text-xs break-all`}
        >
          {value}
        </code>
      )}
    </div>
  );
}
