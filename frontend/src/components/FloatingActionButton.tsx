import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Image, Star, UserPlus, X } from "lucide-react";
import { useActivePath } from "../context/ActivePathContext";

interface FloatingActionButtonProps {
  className?: string;
}

export default function FloatingActionButton({ className = "" }: FloatingActionButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setActivePath } = useActivePath();
  const [isOpen, setIsOpen] = useState(false);

  // Hide FAB on Actions page since FAB represents that page
  if (location.pathname === "/actions") {
    return null;
  }

  const actions = [
    {
      id: "add-version",
      label: t("actions.addVersion", "Add Version"),
      icon: UserPlus,
      colorClass: "text-blue-500 dark:text-blue-400",
      bgHover: "hover:bg-blue-50 dark:hover:bg-blue-900/20",
      borderHover: "hover:border-blue-200 dark:hover:border-blue-800",
      iconBg: "bg-blue-100 dark:bg-blue-900/30",
      shadowHover: "hover:shadow-[0_8px_20px_-8px_rgba(59,130,246,0.5)] dark:hover:shadow-[0_8px_20px_-8px_rgba(59,130,246,0.4)]",
      tab: "add-version",
    },
    {
      id: "endorse",
      label: t("actions.endorsement", "Endorsement"),
      icon: Star,
      colorClass: "text-emerald-500 dark:text-emerald-400",
      bgHover: "hover:bg-emerald-50 dark:hover:bg-emerald-900/20",
      borderHover: "hover:border-emerald-200 dark:hover:border-emerald-800",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      shadowHover: "hover:shadow-[0_8px_20px_-8px_rgba(16,185,129,0.5)] dark:hover:shadow-[0_8px_20px_-8px_rgba(16,185,129,0.4)]",
      tab: "endorse",
    },
    {
      id: "mint-nft",
      label: t("actions.mintNFT", "Mint NFT"),
      icon: Image,
      colorClass: "text-purple-500 dark:text-purple-400",
      bgHover: "hover:bg-purple-50 dark:hover:bg-purple-900/20",
      borderHover: "hover:border-purple-200 dark:hover:border-purple-800",
      iconBg: "bg-purple-100 dark:bg-purple-900/30",
      shadowHover: "hover:shadow-[0_8px_20px_-8px_rgba(168,85,247,0.5)] dark:hover:shadow-[0_8px_20px_-8px_rgba(168,85,247,0.4)]",
      tab: "mint-nft",
    },
  ];

  const handleActionClick = (tab: string) => {
    setIsOpen(false);
    setActivePath("/actions");
    navigate(`/actions?tab=${tab}`);
  };

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      {/* Transparent backdrop for closing menu when clicking outside */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-transparent"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`fixed right-6 md:right-10 z-[10000] bottom-24 md:bottom-10 ${className}`}>
        {/* Action menu items */}
        <div
          className={`absolute bottom-24 right-0 flex flex-col-reverse gap-4 items-stretch transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1) ${
            isOpen
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 translate-y-8 pointer-events-none"
          }`}
        >
          {actions.map((action, index) => {
            const Icon = action.icon;
            // Staggered delay for entrance only
            const delayStyle = isOpen ? { transitionDelay: `${index * 50}ms` } : {};

            return (
              <div
                key={action.id}
                style={delayStyle}
                className={`
                  transform transition-all duration-300 ease-out
                  ${isOpen ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}
                `}
              >
                <button
                  onClick={() => handleActionClick(action.tab)}
                  className={`
                    group flex items-center gap-3 pl-2 pr-5 py-2 rounded-full
                    bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl
                    border border-gray-100 dark:border-white/10
                    shadow-sm hover:shadow-md
                    transition-all duration-200 ease-out
                    active:scale-95
                    w-full
                    ${action.bgHover} ${action.borderHover} ${action.shadowHover}
                  `}
                >
                  <div className={`p-2 rounded-full transition-colors duration-300 flex-shrink-0 ${action.iconBg} ${action.colorClass}`}>
                    <Icon className="w-4 h-4" strokeWidth={2.5} />
                  </div>
                  <span className="text-[14px] font-medium text-gray-700 dark:text-gray-200 group-hover:text-orange-500 dark:group-hover:text-orange-400 whitespace-nowrap transition-colors duration-200">
                    {action.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Main FAB button */}
        <button
          onClick={toggleMenu}
          className={`
            relative w-14 h-14 md:w-16 md:h-16 rounded-full 
            flex items-center justify-center transition-all duration-500 cubic-bezier(0.34, 1.56, 0.64, 1)
            hover:scale-110 active:scale-90 
            bg-gradient-to-br from-orange-400 via-orange-500 to-red-500 text-white
            shadow-[0_0_30px_rgba(249,115,22,0.4)] hover:shadow-[0_0_40px_rgba(249,115,22,0.6)]
            border border-white/20
          `}
        >
          <div className="relative w-6 h-6 md:w-7 md:h-7">
            <Plus
              className={`absolute inset-0 w-full h-full transition-all duration-500 ease-out ${
                isOpen ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"
              }`}
              strokeWidth={3}
            />
            <X
              className={`absolute inset-0 w-full h-full transition-all duration-500 ease-out ${
                isOpen ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"
              }`}
              strokeWidth={3}
            />
          </div>
        </button>
      </div>
    </>
  );
}
