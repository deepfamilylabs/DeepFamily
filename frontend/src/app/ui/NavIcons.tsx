import { useId } from "react";
import type { ReactNode } from "react";

/**
 * NavIcons: the sidebar's route glyphs, each in two forms — an outline at rest
 * and a solid silhouette for the section you are in, so the current section is
 * marked by a change of shape and not by colour alone.
 *
 * The outlines trace lucide's House, TreePine, CirclePlus and Sprout (ISC), so the rail
 * keeps the app's icon language; lucide draws no solid forms, so those live
 * here. A solid glyph keeps the outline's stroke, which rounds its corners the
 * same way and keeps it from growing or shrinking when it changes state.
 */

export type NavIconProps = {
  className?: string;
  solid?: boolean;
  strokeWidth?: number;
};

const DEFAULT_STROKE = 2;

function Glyph({
  className,
  solid = false,
  strokeWidth = DEFAULT_STROKE,
  children,
}: NavIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill={solid ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function HomeNavIcon(props: NavIconProps) {
  return (
    <Glyph {...props}>
      {props.solid ? (
        // One contour with the door notched out of its foot: filling lucide's
        // separate door path would paint the door over and leave a blank block.
        <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-4v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8H5a2 2 0 0 1-2-2z" />
      ) : (
        <>
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
          <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </>
      )}
    </Glyph>
  );
}

export function FamilyTreeNavIcon(props: NavIconProps) {
  return (
    <Glyph {...props}>
      <path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z" />
      <path d="M12 22v-3" />
    </Glyph>
  );
}

/** The create entry (/create): a plus in a circle. */
export function CreateNavIcon(props: NavIconProps) {
  // Each instance needs its own mask id: `url(#id)` resolves to the first match
  // in the document — the same trap Logo's gradient id avoids.
  const maskId = `nav-plus-${useId().replace(/:/g, "")}`;

  return (
    <Glyph {...props}>
      {props.solid ? (
        // A disc with the plus cut out of it rather than painted on it, so the
        // pill or tile behind the glyph shows through the plus.
        <>
          <mask id={maskId}>
            <rect width="24" height="24" fill="white" stroke="none" />
            <path
              d="M8 12h8M12 8v8"
              stroke="black"
              strokeWidth={props.strokeWidth ?? DEFAULT_STROKE}
            />
          </mask>
          <circle cx="12" cy="12" r="10" mask={`url(#${maskId})`} />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </>
      )}
    </Glyph>
  );
}

/** The inheritance entry (/inheritance): a sprout, the next generation growing from the family. */
export function InheritanceNavIcon(props: NavIconProps) {
  return (
    <Glyph {...props}>
      {props.solid ? (
        // Lucide draws the right leaf and the stem as one open path, which a fill would close
        // into a wedge; the solid form splits them so only the leaves fill.
        <>
          <path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-2 .536z" />
          <path d="M16 9a4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3" fill="none" />
          <path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4" />
          <path d="M5 21h14" />
        </>
      ) : (
        <>
          <path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3" />
          <path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4" />
          <path d="M5 21h14" />
        </>
      )}
    </Glyph>
  );
}
