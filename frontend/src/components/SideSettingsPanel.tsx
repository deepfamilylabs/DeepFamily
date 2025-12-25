import { useState, useRef } from "react";
import { Settings } from "lucide-react";
import FamilyTreeConfigForm, { FamilyTreeConfigFormProps } from "./FamilyTreeConfigForm";
import { useTranslation } from "react-i18next";

// We omit 'editing' because we force it to true in this panel
// We also allow other props to pass through
type SideSettingsPanelProps = Omit<FamilyTreeConfigFormProps, "editing"> & {
  [key: string]: any;
};

export default function SideSettingsPanel(props: SideSettingsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // Real-time drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);

  // Refs for drag calculations
  const dragStartX = useRef<number>(0);
  const dragStartTranslateX = useRef<number>(0);
  const panelWidthRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const isScrollingRef = useRef(false);

  const STRIP_WIDTH = 56; // w-14

  const onTouchStart = (e: React.TouchEvent) => {
    if (!panelRef.current) return;
    
    const rect = panelRef.current.getBoundingClientRect();
    panelWidthRef.current = rect.width;
    
    // Calculate current translate X based on state or computed style
    // If expanded, 0. If collapsed, -(width - STRIP_WIDTH)
    const currentTranslate = expanded ? 0 : -(rect.width - STRIP_WIDTH);
    
    dragStartX.current = e.touches[0].clientX;
    dragStartTranslateX.current = currentTranslate;
    
    isDraggingRef.current = false;
    isScrollingRef.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (isScrollingRef.current) return;

    const currentX = e.touches[0].clientX;
    const deltaX = currentX - dragStartX.current;

    // Determine intent if not yet decided
    if (!isDraggingRef.current) {
      // Check vertical scroll vs horizontal drag
      // We assume if we are on the strip (which is the handle), we likely want to drag
      // But let's stick to a simple threshold check for now
      if (Math.abs(deltaX) > 5) {
         isDraggingRef.current = true;
         setIsDragging(true);
      }
    }

    if (isDraggingRef.current) {
      let newTranslate = dragStartTranslateX.current + deltaX;
      
      // Clamp
      const minTranslate = -(panelWidthRef.current - STRIP_WIDTH);
      const maxTranslate = 0;
      
      if (newTranslate < minTranslate) newTranslate = minTranslate;
      if (newTranslate > maxTranslate) newTranslate = maxTranslate;

      setDragX(newTranslate);
    }
  };

  const onTouchEnd = () => {
    if (isDraggingRef.current) {
      setIsDragging(false);
      if (dragX !== null) {
        const minTranslate = -(panelWidthRef.current - STRIP_WIDTH);
        const threshold = minTranslate / 2; // Midpoint
        
        // If we are closer to 0 (expanded) than minTranslate (collapsed)
        if (dragX > threshold) {
          setExpanded(true);
        } else {
          setExpanded(false);
        }
      }
      setDragX(null);
    }
    isDraggingRef.current = false;
    isScrollingRef.current = false;
  };

  return (
    <div
      ref={panelRef}
      className={`fixed left-0 top-0 bottom-0 z-50 flex flex-row bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-700 shadow-xl w-80 sm:w-96 ${
        isDragging ? "transition-none" : "transition-transform duration-300 ease-in-out"
      }`}
      style={{
        transform: dragX !== null 
          ? `translateX(${dragX}px)` 
          : (expanded ? 'translateX(0)' : `translateX(calc(-100% + ${STRIP_WIDTH}px))`)
      }}
      onMouseEnter={() => !isDragging && setExpanded(true)}
      onMouseLeave={() => !isDragging && setExpanded(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Content Area - Left Side */}
      <div className="flex-1 h-full overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto custom-scrollbar pb-24 md:pb-0">
          <FamilyTreeConfigForm
            {...props}
            editing={true}
            alwaysShowExtras={true}
            hideToggle={true}
          />
        </div>
      </div>

      {/* Handle / Strip - Right Side */}
      <div className="w-14 h-full flex flex-col items-center py-4 gap-6 bg-white dark:bg-slate-900 border-l border-gray-100 dark:border-slate-800 z-10 shrink-0 cursor-grab active:cursor-grabbing">
        <div className="p-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 shadow-sm">
          <Settings className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
