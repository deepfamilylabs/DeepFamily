import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Github } from "lucide-react";
import XIcon from "./XIcon";
import TelegramIcon from "./TelegramIcon";
import Logo from "./Logo";
import { SOCIAL_LINKS } from "../config/socialLinks";

type IconLink = {
  id: string;
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

/** The mark in the icons' own colour, so it reads as one of them. */
function MonochromeLogo({ className }: { className?: string }) {
  return <Logo monochrome className={className} />;
}

const SOCIAL: IconLink[] = [
  { id: "x", href: SOCIAL_LINKS.x, label: "X", icon: XIcon },
  { id: "telegram", href: SOCIAL_LINKS.telegram, label: "Telegram", icon: TelegramIcon },
  { id: "github", href: SOCIAL_LINKS.github, label: "GitHub", icon: Github },
];

const LEGAL_LINK_CLASSES =
  "text-[15px] text-slate-700 dark:text-slate-300 transition-colors motion-reduce:transition-none hover:text-slate-950 dark:hover:text-white";

/**
 * SidebarFooter: the foot of the mobile drawer.
 *
 * The social, legal and logo links live in the status bar, which has no room
 * for them below md — so on a phone they close out the drawer instead, the way
 * a site footer closes out a page. As in the status bar, the logo page is an
 * icon that leads the social ones, and the legal pages are words.
 */
export default function SidebarFooter() {
  const { t } = useTranslation();

  const iconLinks: IconLink[] = [
    { id: "logo", href: "/logo.html", label: t("logo.label", "Logo"), icon: MonochromeLogo },
    ...SOCIAL,
  ];

  return (
    <div className="mt-auto border-t border-slate-100 dark:border-slate-800 px-5 pt-4 pb-6 space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        {iconLinks.map(({ id, href, label, icon: Icon }) => (
          <a
            key={id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="p-2 rounded-full text-slate-600 dark:text-slate-300 transition-colors motion-reduce:transition-none hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Icon className="w-5 h-5" />
          </a>
        ))}
      </div>
      <div className="flex flex-col items-start gap-4">
        <Link to="/privacy" className={LEGAL_LINK_CLASSES}>
          {t("footer.privacy")}
        </Link>
        <Link to="/terms" className={LEGAL_LINK_CLASSES}>
          {t("footer.terms")}
        </Link>
      </div>
    </div>
  );
}
