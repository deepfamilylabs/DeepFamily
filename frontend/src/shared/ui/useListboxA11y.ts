import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";

export interface UseListboxA11yOptions<TOption> {
  open: boolean;
  options: TOption[];
  selectedIndex: number;
  listboxId: string;
  getOptionKey: (option: TOption, index: number) => string | number;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (option: TOption, index: number) => void;
  buttonRef?: RefObject<HTMLElement>;
  disabled?: boolean;
  focusButtonOnSelect?: boolean;
}

export function useListboxA11y<TOption>({
  open,
  options,
  selectedIndex,
  listboxId,
  getOptionKey,
  onOpen,
  onClose,
  onSelect,
  buttonRef,
  disabled,
  focusButtonOnSelect,
}: UseListboxA11yOptions<TOption>) {
  const defaultActiveIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const [activeIndex, setActiveIndex] = useState(defaultActiveIndex);
  const activeOption = options[activeIndex];
  const activeOptionId = open && activeOption ? getOptionId(activeOption, activeIndex) : undefined;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(defaultActiveIndex);
  }, [defaultActiveIndex, open]);

  function getOptionId(option: TOption, index: number) {
    return `${listboxId}-option-${getOptionKey(option, index)}`;
  }

  function openListbox(index = defaultActiveIndex) {
    if (disabled || options.length === 0) return;
    setActiveIndex(index);
    onOpen();
  }

  function moveActive(delta: number) {
    const optionCount = options.length;
    if (optionCount === 0) return;
    setActiveIndex((index) => (index + delta + optionCount) % optionCount);
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onSelect(option, index);
    if (focusButtonOnSelect) {
      buttonRef?.current?.focus();
    }
  }

  function handleButtonKeyDown(event: KeyboardEvent<HTMLElement>) {
    const optionCount = options.length;
    if (disabled || optionCount === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          openListbox(defaultActiveIndex);
          return;
        }
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          openListbox(selectedIndex >= 0 ? selectedIndex : optionCount - 1);
          return;
        }
        moveActive(-1);
        break;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        if (!open) return;
        event.preventDefault();
        setActiveIndex(optionCount - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!open) {
          openListbox(defaultActiveIndex);
          return;
        }
        selectOption(activeIndex);
        break;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        onClose();
        break;
    }
  }

  return {
    activeIndex,
    activeOptionId,
    getOptionId,
    handleButtonKeyDown,
    selectOption,
    setActiveIndex,
  };
}
