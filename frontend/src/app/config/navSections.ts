/**
 * Which top-level navigation entry owns a route.
 *
 * The family section is bigger than the one route linked from the nav: the
 * lineage chart, the people volume and the paper genealogy are peer views of
 * the same family (see pages/family/FamilyVolumeNav), and person and story
 * pages are its detail routes. All of them keep the Family entry selected —
 * without this, opening a person from the tree left the whole nav unlit.
 */
export type NavSection = "home" | "familyTree" | "search" | "actions";

const SECTION_ROUTES: ReadonlyArray<readonly [NavSection, readonly string[]]> = [
  ["familyTree", ["/familyTree", "/people", "/genealogyBook", "/person", "/editor"]],
  ["search", ["/search"]],
  ["actions", ["/actions"]],
];

export function resolveNavSection(pathname: string): NavSection | null {
  if (pathname === "/") return "home";

  for (const [section, routes] of SECTION_ROUTES) {
    if (routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
      return section;
    }
  }

  return null;
}
