import { Check } from "lucide-react";
import type { ReactNode } from "react";

interface ConsentCheckboxProps {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}

export function ConsentCheckbox({ checked, onChange, children }: ConsentCheckboxProps) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group select-none">
      <span className="relative flex items-center justify-center shrink-0 w-4 h-4 mt-[2px]">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="peer h-4 w-4 rounded-[4px] border-[1.5px] border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-red-600 focus:ring-0 focus:border-red-500 checked:bg-red-600 checked:border-red-600 transition-all cursor-pointer appearance-none"
        />
        <Check className="w-3 h-3 text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform scale-75 opacity-0 peer-checked:opacity-100 peer-checked:scale-75 transition-all duration-200 pointer-events-none stroke-4" />
      </span>
      <span className="text-xs text-gray-800 dark:text-red-50 leading-relaxed font-medium group-hover:text-red-700 dark:group-hover:text-white transition-colors">
        {children}
      </span>
    </label>
  );
}
