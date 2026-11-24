import { useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../../../components/Button";
import { Sheet } from "../../../components/Sheet";
import { Toggle } from "../../../components/Toggle";
import { useListReorder } from "../../../components/useListReorder";
import { Icon } from "../../../icons/Icon";
import { useTranslation } from "../../../ports/i18n";
import { useHomeLayout, type SectionId } from "./homeLayout";
import styles from "./ArrangeHome.module.css";

const ROW = 48;

export function ArrangeHome(): JSX.Element {
  const { t } = useTranslation();
  const { order, hidden, arranging, move, toggle, reset, arrange } = useHomeLayout();
  const list = useRef<HTMLOListElement>(null);
  const [top, setTop] = useState(0);
  const drag = useListReorder({ items: order, scrollContainerRef: list, listContainerRef: list, itemHeight: ROW, onReorder: move });
  const shift = (index: number) => {
    const { dragIndex, dropIndex } = drag;
    if (dragIndex === null || dropIndex === null || index === dragIndex) return 0;
    if (index > dragIndex && index <= dropIndex) return -ROW;
    if (index < dragIndex && index >= dropIndex) return ROW;
    return 0;
  };
  const held = (index: number) => drag.pointerPos.y - top - drag.grabOffset.y - index * ROW;
  const grab = (index: number, id: SectionId) => (event: PointerEvent<HTMLLIElement>) => {
    if ((event.target as Element).closest("[role=switch]")) return;
    setTop(list.current!.getBoundingClientRect().top);
    drag.handleCardGrab(index, id, event);
  };
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const to = index + step;
    if (step === 0 || to < 0 || to >= order.length) return;
    event.preventDefault();
    move(index, to);
  };
  return (
    <>
      <Button variant="text" className={styles.open} data-arrange-home="" onClick={() => arrange(true)}>
        {t("ui.home.arrange.open")}
      </Button>
      <Sheet
        open={arranging}
        onClose={() => arrange(false)}
        title={t("ui.home.arrange.title")}
        actions={[
          { label: t("ui.home.arrange.reset"), onClick: reset },
          { label: t("ui.home.arrange.done"), primary: true, onClick: () => arrange(false) },
        ]}
      >
        <p className={styles.hint}>{t("ui.home.arrange.hint")}</p>
        <ol ref={list} className={styles.list}>
          {order.map((id, index) => {
            const name = t(`ui.home.arrange.section.${id}`);
            const dragged = drag.dragIndex === index;
            return (
              <li
                key={id}
                className={styles.row}
                data-section={id}
                data-dragged={dragged ? "" : undefined}
                data-moving={drag.isDragging && !dragged ? "" : undefined}
                style={{ height: ROW, transform: `translateY(${dragged ? held(index) : shift(index)}px)` }}
                onPointerDown={grab(index, id)}
              >
                <button type="button" className={styles.grip} aria-label={t("ui.home.arrange.move", { name })} onKeyDown={onKeyDown(index)}>
                  <Icon name="drag" size={18} />
                </button>
                <span className={styles.name}>{name}</span>
                <Toggle label={name} labelHidden checked={!hidden.includes(id)} onChange={() => toggle(id)} />
              </li>
            );
          })}
        </ol>
      </Sheet>
    </>
  );
}
