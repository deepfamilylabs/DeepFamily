import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Image, Star, UserPlus, X } from "lucide-react";

interface FloatingActionButtonProps {
  className?: string;
}

export default function FloatingActionButton({ className = "" }: FloatingActionButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
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
      color: "bg-blue-600 hover:bg-blue-700",
      shadow: "shadow-blue-600/30",
      tab: "add-version",
    },
    {
      id: "endorse",
      label: t("actions.endorsement", "Endorsement"),
      icon: Star,
      color: "bg-green-600 hover:bg-green-700",
      shadow: "shadow-green-600/30",
      tab: "endorse",
    },
    {
      id: "mint-nft",
      label: t("actions.mintNFT", "Mint NFT"),
      icon: Image,
      color: "bg-purple-600 hover:bg-purple-700",
      shadow: "shadow-purple-600/30",
      tab: "mint-nft",
    },
  ];

  const handleActionClick = (tab: string) => {
    setIsOpen(false);
    navigate(`/actions?tab=${tab}`);
  };

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      {/* Backdrop for closing menu */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-white/50 dark:bg-black/50 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      <div className={`fixed right-6 md:right-10 z-[10000] bottom-24 md:bottom-10 ${className}`}>
        {/* Action menu items */}
        <div
          className={`absolute bottom-24 right-0 flex flex-col-reverse gap-4 items-end transition-all duration-300 ease-out ${
            isOpen
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 translate-y-4 pointer-events-none"
          }`}
        >
          {actions.map((action, index) => {
            const Icon = action.icon;
            // Staggered delay for entrance
            const delayStyle = isOpen ? { transitionDelay: `${index * 50}ms` } : {};

            return (
              <button
                key={action.id}
                onClick={() => handleActionClick(action.tab)}
                style={delayStyle}
                className={`
                  group flex items-center gap-3 px-6 py-3.5 rounded-full text-white 
                  shadow-lg hover:shadow-xl transform transition-all duration-300 
                  hover:scale-105 hover:-translate-x-1
                  ${action.color} ${action.shadow}
                  ${isOpen ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}
                `}
              >
                <Icon className="w-5 h-5" strokeWidth={2.5} />
                <span className="text-[15px] font-bold tracking-wide whitespace-nowrap">
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main FAB button */}
        <button
          onClick={toggleMenu}
          className={`
            relative w-14 h-14 md:w-16 md:h-16 rounded-full shadow-2xl 
            flex items-center justify-center transition-all duration-300 
            hover:scale-105 active:scale-95 border border-white/20
            bg-gradient-to-r from-orange-400 to-red-500 text-white
            hover:shadow-lg hover:shadow-orange-500/40
          `}
        >
          <div className="relative w-6 h-6 md:w-7 md:h-7">
            <Plus
              className={`absolute inset-0 w-full h-full transition-all duration-300 ease-out ${
                isOpen ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"
              }`}
              strokeWidth={2.5}
            />
            <X
              className={`absolute inset-0 w-full h-full transition-all duration-300 ease-out ${
                isOpen ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"
              }`}
              strokeWidth={2.5}
            />
          </div>
        </button>
      </div>
    </>
  );
}
