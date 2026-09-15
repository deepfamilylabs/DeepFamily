import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  getRecordTypeColorClass,
  getRecordTypeI18nKey,
  getRecordTypeOptions,
} from "../../../domains/person";
import { getStoryPresentation } from "../../../shared/model";
import { BIOGRAPHY_SECTION, type PersonPageController } from "../hooks/usePersonPageController";
import { getRecordTypeLabel } from "../model/personPageModel";
import { buildPersonContents, getRecordExcerpt } from "../model/personStoryLayout";

/** Records listed under the section being read before the rest hide behind a "more" row. */
const NESTED_PREVIEW = 6;

function useTypeLabel() {
  const { t } = useTranslation();
  const options = useMemo(() => getRecordTypeOptions(t), [t]);
  return (type: number) =>
    t(getRecordTypeI18nKey(type), getRecordTypeLabel(type, options, t("recordTypes.unknown", "Unknown")));
}

/**
 * Contents column: the biography, then every type section under its taxonomy
 * group. The section being read opens to list its records — by title, or by the
 * opening words of a record that has none — so a single record is one click away.
 */
export function PersonContents({ person }: { person: PersonPageController }) {
  const { t } = useTranslation();
  const typeLabel = useTypeLabel();
  const [showAllOf, setShowAllOf] = useState<number | null>(null);
  // While the pointer or keyboard focus is inside Contents its layout holds
  // still: lists that are open stay open, a clicked section opens in place and
  // only the highlight follows the page. Contents folds back to the section
  // being read once the reader leaves, so nothing moves under the pointer.
  const [holding, setHolding] = useState(false);
  const [heldOpen, setHeldOpen] = useState<Set<number>>(new Set());
  const pointerInside = useRef(false);
  const navRef = useRef<HTMLElement | null>(null);
  const items = useMemo(() => buildPersonContents(person.groupedRecords), [person.groupedRecords]);
  const data = person.data;
  if (!data) return null;

  const presentation = getStoryPresentation(data.storyRecords, data.storyMetadata);
  const hasBiography = Boolean(
    presentation.biography?.unsupportedSchema || data.nftCoreInfo?.story?.trim(),
  );
  const rowClass = (active: boolean) =>
    `flex w-full items-center gap-[9px] rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-surface-alt focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
      active ? "bg-surface-alt" : ""
    }`;

  const hold = () => {
    if (holding) return;
    setHeldOpen(new Set(typeof person.activeSection === "number" ? [person.activeSection] : []));
    setHolding(true);
  };
  const release = () => {
    if (pointerInside.current || navRef.current?.contains(document.activeElement)) return;
    setHolding(false);
  };
  const isOpen = (type: number) =>
    holding ? heldOpen.has(type) : person.activeSection === type;
  // A pointer click leaves focus on the row, which would hold Contents long
  // after the pointer has gone; keyboard activation (detail 0) keeps its focus.
  const dropPointerFocus = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 0) event.currentTarget.blur();
  };

  return (
    <nav
      ref={navRef}
      onPointerEnter={() => {
        pointerInside.current = true;
        hold();
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        release();
      }}
      onFocus={hold}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          window.setTimeout(release, 0);
        }
      }}
      aria-label={t("person.sectionNav", "Contents") as string}
      className="flex max-h-[calc(100vh-var(--app-header-h)-var(--app-statusbar-h)-3rem)] flex-col gap-3.5 rounded-[20px] border border-hairline bg-surface px-3.5 pb-3.5 pt-4 shadow-sm"
    >
      <div className="flex items-center justify-between px-1.5">
        <h2 className="ui-heading text-[13px] text-ink">{t("person.sectionNav", "Contents")}</h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
          {presentation.totalRecords}
        </span>
      </div>

      <ul className="thin-scrollbar -mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
        {hasBiography && (
          <li>
            <button
              type="button"
              onClick={(event) => {
                person.scrollToSection(BIOGRAPHY_SECTION);
                dropPointerFocus(event);
              }}
              aria-current={person.activeSection === BIOGRAPHY_SECTION ? "location" : undefined}
              className={rowClass(person.activeSection === BIOGRAPHY_SECTION)}
            >
              <span
                aria-hidden
                className={`h-[7px] w-[7px] shrink-0 rounded-full bg-current ${getRecordTypeColorClass(0)}`}
              />
              <span
                className={`min-w-0 flex-1 truncate text-[12.5px] text-ink ${
                  person.activeSection === BIOGRAPHY_SECTION ? "font-semibold" : ""
                }`}
              >
                {t("storyRecordsModal.biographyTitle", "Biography")}
              </span>
            </button>
          </li>
        )}

        {items.map((item) => {
          if (item.kind === "group") {
            return (
              <li
                key={`group-${item.id}`}
                className="px-1.5 pb-[3px] pt-2.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-subtle"
              >
                {t(item.labelKey, item.fallbackLabel)}
              </li>
            );
          }

          const active = person.activeSection === item.type;
          const showAll = showAllOf === item.type;
          const listed = showAll ? item.records : item.records.slice(0, NESTED_PREVIEW);
          return (
            <li key={`section-${item.type}`}>
              <button
                type="button"
                onClick={(event) => {
                  if (holding) setHeldOpen((prev) => new Set(prev).add(item.type));
                  person.scrollToSection(item.type);
                  dropPointerFocus(event);
                }}
                aria-current={active ? "location" : undefined}
                className={rowClass(active)}
              >
                <span
                  aria-hidden
                  className={`h-[7px] w-[7px] shrink-0 rounded-full bg-current ${getRecordTypeColorClass(item.type)}`}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[12.5px] text-ink ${active ? "font-semibold" : ""}`}
                >
                  {typeLabel(item.type)}
                </span>
                <span className="font-mono text-[10.5px] text-ink-subtle">{item.records.length}</span>
              </button>

              {isOpen(item.type) && (
                <ul className="mb-1 ml-[11px] mt-0.5 flex flex-col gap-px border-l border-hairline pl-2">
                  {listed.map((record) => {
                    const title = record.title?.trim();
                    const current = person.activeRecord === record.recordIndex;
                    return (
                      <li key={record.recordIndex}>
                        <button
                          type="button"
                          onClick={(event) => {
                            person.scrollToRecord(item.type, record.recordIndex);
                            dropPointerFocus(event);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-alt focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          <span
                            className={`min-w-0 flex-1 truncate text-[12px] leading-[18px] ${
                              title ? "text-ink" : "text-ink-subtle"
                            } ${current ? "font-semibold" : ""}`}
                          >
                            {title || getRecordExcerpt(record.content)}
                          </span>
                          <span className="font-mono text-[10px] text-ink-subtle">
                            {record.displayIndex ?? record.recordIndex + 1}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {item.records.length > NESTED_PREVIEW && !showAll && (
                    <li>
                      <button
                        type="button"
                        onClick={(event) => {
                          setShowAllOf(item.type);
                          dropPointerFocus(event);
                        }}
                        className="w-full rounded-lg px-2 py-1 text-left text-[12px] leading-[18px] text-ink-muted transition-colors hover:bg-surface-alt hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        {t("person.moreRecords", "{{count}} more", {
                          count: item.records.length - NESTED_PREVIEW,
                        })}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Below xl there is no Contents column, so the sections become a row of chips
 * that sticks under the header while the story scrolls.
 */
export function PersonSectionChips({ person }: { person: PersonPageController }) {
  const typeLabel = useTypeLabel();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Keep the chip of the section being read in view without moving the page.
  useEffect(() => {
    const row = rowRef.current;
    const chip = typeof person.activeSection === "number" ? chipRefs.current.get(person.activeSection) : null;
    if (!row || !chip) return;
    const left = chip.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo?.({ left: Math.max(0, left - 16), behavior: "smooth" });
    }
  }, [person.activeSection]);

  return (
    <div className="sticky top-[var(--app-header-h)] z-20 -mx-4 mt-3 border-b border-hairline bg-surface-body/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:hidden">
      <div ref={rowRef} className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {person.groupedRecords.map((group) => {
          const active = person.activeSection === group.type;
          return (
            <button
              key={group.type}
              ref={(element) => {
                if (element) chipRefs.current.set(group.type, element);
                else chipRefs.current.delete(group.type);
              }}
              type="button"
              onClick={() => person.scrollToSection(group.type)}
              aria-current={active ? "location" : undefined}
              className={`inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] text-ink transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/30 ${
                active ? "border-primary/40 bg-primary/8 font-semibold" : "border-hairline bg-surface"
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full bg-current ${getRecordTypeColorClass(group.type)}`}
              />
              {typeLabel(group.type)}
              <span className="font-mono text-[10.5px] font-normal text-ink-subtle">
                {group.records.length}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
