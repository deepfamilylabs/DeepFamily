import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { formatYMD, genderText, getStoryPresentation } from "../../../shared/model";
import { UnsupportedStoryRecord } from "../../../shared/ui/UnsupportedStoryRecord";
import { BIOGRAPHY_SECTION, type PersonPageController } from "../hooks/usePersonPageController";

const PRETTY: CSSProperties = { textWrap: "pretty" } as CSSProperties;

/**
 * Whose page this is: the name, then the life facts as one ruled row — stacked
 * label-and-value rows on phones, where a row of three would wrap mid-value.
 */
export function PersonHeader({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;
  if (!data) return null;

  const core = data.nftCoreInfo;
  const facts: { key: string; label: string; value: string }[] = [];
  if (core && (core.birthYear || core.birthPlace)) {
    facts.push({
      key: "birth",
      label: t("familyTree.nodeDetail.birth", "Birth"),
      value: [formatYMD(core.birthYear, core.birthMonth, core.birthDay, core.isBirthBC), core.birthPlace]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (core && (core.deathYear || core.deathPlace)) {
    facts.push({
      key: "death",
      label: t("familyTree.nodeDetail.death", "Death"),
      value: [formatYMD(core.deathYear, core.deathMonth, core.deathDay, core.isDeathBC), core.deathPlace]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (core?.gender !== undefined && core.gender > 0) {
    facts.push({
      key: "gender",
      label: t("familyTree.nodeDetail.gender", "Gender"),
      value: genderText(core.gender, t as (key: string, def?: string) => string) || "-",
    });
  }

  const name = data.fullName || `Token #${data.tokenId}`;

  return (
    <header className="flex flex-col">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
        {t("person.encyclopedia", "Encyclopedia")}
      </span>

      <h1 className="page-title mt-2 break-words text-[1.75rem] text-ink sm:text-[2.25rem]">{name}</h1>

      {facts.length > 0 && (
        <dl className="mt-4 border-t border-hairline sm:mt-5 sm:flex sm:border-b">
          {facts.map((fact, index) => (
            <div
              key={fact.key}
              className={`flex items-baseline gap-3 border-b border-hairline py-2.5 sm:block sm:border-b-0 sm:py-3.5 sm:pr-7 ${
                index > 0 ? "sm:border-l sm:pl-7" : ""
              }`}
            >
              <dt className="w-14 shrink-0 text-[12.5px] text-ink-muted sm:w-auto sm:text-[10.5px] sm:font-bold sm:uppercase sm:tracking-[0.1em] sm:text-ink-subtle">
                {fact.label}
              </dt>
              <dd className="min-w-0 break-words text-sm font-medium leading-5 text-ink sm:mt-1">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

/** The mint biography, read as the opening paragraph; its title when the minter gave one. */
export function PersonBiography({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const data = person.data;
  if (!data) return null;

  const biography = getStoryPresentation(data.storyRecords, data.storyMetadata).biography;
  const story = data.nftCoreInfo?.story;
  if (!biography?.unsupportedSchema && !story?.trim()) return null;
  const title = data.nftCoreInfo?.storyTitle?.trim();

  return (
    <section
      ref={person.registerSection(BIOGRAPHY_SECTION)}
      id="person-biography"
      className="mt-7 scroll-mt-40 xl:scroll-mt-24"
    >
      <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
        {t("storyRecordsModal.biographyTitle", "Biography")}
      </div>
      {title && (
        <h2 className="ui-heading mt-2 break-words text-lg text-ink" style={{ fontWeight: 700 }}>
          {title}
        </h2>
      )}
      {biography?.unsupportedSchema ? (
        <div className="mt-2 text-ink">
          <UnsupportedStoryRecord record={biography} />
        </div>
      ) : (
        <p
          className={`${title ? "mt-1.5" : "mt-2.5"} whitespace-pre-wrap break-words text-base leading-[1.85] text-ink sm:text-[17px]`}
          style={PRETTY}
        >
          {story}
        </p>
      )}
    </section>
  );
}
