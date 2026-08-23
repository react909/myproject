import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { loadSettings, saveSettings } from "../settings/appSettings";
import "./VirtualKeyboard.css";

function updateFieldValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ===== РАСКЛАДКИ =====
//
// Лежат в общем модуле: та же клавиатура встроена в окно ввода ключа, и два
// набора рядов однажды разъехались — во встроенной не оказалось ни русских
// букв, ни символов.

import {
  CALC_ROWS,
  EN_ROWS_LOWER,
  EN_ROWS_UPPER,
  RU_ROWS_LOWER,
  RU_ROWS_UPPER,
  SYMBOLS_PAGE_1,
  SYMBOLS_PAGE_2,
} from "./layouts";
import type { KeyboardLayout } from "./layouts";
import { useDraggableHandle } from "./useDraggableHandle";

type KeyboardSize = "small" | "medium" | "large";

/** Сторона кнопки вызова. Совпадает с .keyboard-open-btn в CSS: по ней хук
 *  считает, куда кнопку можно отпустить, чтобы она не ушла за край экрана.
 *
 *  Меняется ВМЕСТЕ с тремя местами в VirtualKeyboard.css: сама кнопка, размер
 *  значка внутри и `--neck-half` (полуширина шеи равна радиусу кнопки). Разойдись
 *  они — и кнопка либо вылезет из шеи, либо хук посчитает край не там, где он
 *  нарисован.
 *
 *  Было 54: на моноблоке кнопка заметно закрывала собой строку списка. 46 — всё
 *  ещё крупная цель для пальца (нижняя граница по любым рекомендациям — 44). */
const OPEN_BUTTON_SIZE = 46;

// ===== ИКОНКИ =====

function KeyboardOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M5 8h2M11 8h2M17 8h2M5 12h8M15 12h2M5 16h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// function EnterIcon() {
//   return (
//     <svg
//       viewBox="0 0 24 24"
//       fill="none"
//       stroke="currentColor"
//       strokeWidth="2.5"
//     >
//       <polyline points="23 4 23 10 17 10" />
//       <path d="M20.49 15a9 9 0 1 1 .12-4.49" />
//     </svg>
//   );
// }

export type VirtualKeyboardProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onEnter?: () => void | Promise<void>;
};

export function VirtualKeyboard({
  isOpen,
  onOpenChange,
  onEnter,
}: VirtualKeyboardProps) {
  const [layout, setLayout] = useState<KeyboardLayout>("russian");
  const [capsLock, setCapsLock] = useState(false);
  const [shift, setShift] = useState(false);
  const [keyboardSize, setKeyboardSize] = useState<KeyboardSize>("large");
  const [autoOpen, setAutoOpen] = useState(
    () => loadSettings().system.showKeyboardOnFocus,
  );

  const toggleAutoOpen = () => {
    const settings = loadSettings();
    const next = !settings.system.showKeyboardOnFocus;
    saveSettings({ ...settings, system: { ...settings.system, showKeyboardOnFocus: next } });
    setAutoOpen(next);
  };

  /* Прилипание кнопки вызова к краю. Переключатель здесь, а не в настройках:
     решение принимают ровно тогда, когда кнопка мешает, — и менять его хочется
     на месте, не уходя с кассы. */
  const [snapToEdge, setSnapToEdge] = useState(
    () => loadSettings().system.keyboardSnapToEdge,
  );

  const toggleSnapToEdge = () => {
    const settings = loadSettings();
    const next = !settings.system.keyboardSnapToEdge;
    saveSettings({ ...settings, system: { ...settings.system, keyboardSnapToEdge: next } });
    setSnapToEdge(next);
  };

  // Кнопку вызова можно перетащить куда угодно: в углу по умолчанию она
  // закрывает то плитку суммы, то кнопку оплаты, а какой угол свободен —
  // зависит от магазина. Разбор, как перенос отличается от нажатия, — в хуке.
  const openHandle = useDraggableHandle(
    OPEN_BUTTON_SIZE,
    useCallback(() => onOpenChange(true), [onOpenChange]),
  );

  const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null,
  );
  const backspaceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const backspaceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const isBackspacePressedRef = useRef(false);

  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        activeInputRef.current = target;
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, []);

  /*
    Признак открытой клавиатуры — на корне документа, вместе с её высотой.

    Зачем наружу. Клавиатура занимает низ экрана и накрывает всё, что там
    оказалось. Окно подтверждения пароля центрировалось по всей высоте окна и
    уходило под неё целиком: видно было половину заголовка, а поле ввода и
    кнопка «Выйти» — уже нет. Печатать в поле, которого не видно, нельзя.

    Через корень, а не пропсом: окно выхода живёт в трёх местах (выход из
    аккаунта, раздел пользователей, системный раздел), и протаскивать состояние
    в каждое — значит завести три копии одной связи. Признаком на корне может
    воспользоваться любой слой, ничего про клавиатуру не зная, одним правилом
    CSS.

    Высота меряется, а не задаётся числом: у клавиатуры три размера (S/M/L) и
    отключаемый калькулятор, и любое записанное число разошлось бы с правдой на
    следующем переключении.
  */
  useEffect(() => {
    const root = document.documentElement;
    if (!isOpen) {
      delete root.dataset.kbOpen;
      root.style.removeProperty("--kb-height");
      return;
    }

    root.dataset.kbOpen = "1";
    const panel = document.querySelector(".keyboard-overlay");
    if (!panel) return;

    const measure = () => {
      root.style.setProperty("--kb-height", `${Math.round(panel.getBoundingClientRect().height)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      delete root.dataset.kbOpen;
      root.style.removeProperty("--kb-height");
    };
    // `layout`, а не производный от него `showCalc`: тот объявлен ниже по
    // файлу, и в списке зависимостей он читался бы до объявления.
  }, [isOpen, keyboardSize, layout]);

  const insertText = useCallback((text: string) => {
    const input = activeInputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const newValue =
      input.value.slice(0, start) + text + input.value.slice(end);
    updateFieldValue(input, newValue);
    const pos = start + text.length;
    input.focus();
    input.setSelectionRange(pos, pos);
  }, []);

  const handleBackspaceOnce = useCallback(() => {
    const input = activeInputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    if (start === end && start === 0) return;
    let newValue: string;
    let newCursorPos: number;
    if (start === end) {
      newValue = input.value.slice(0, start - 1) + input.value.slice(start);
      newCursorPos = start - 1;
    } else {
      newValue = input.value.slice(0, start) + input.value.slice(end);
      newCursorPos = start;
    }
    updateFieldValue(input, newValue);
    input.focus();
    input.setSelectionRange(newCursorPos, newCursorPos);
  }, []);

  const startBackspaceHold = useCallback(() => {
    if (isBackspacePressedRef.current) return;
    isBackspacePressedRef.current = true;
    handleBackspaceOnce();
    backspaceTimeoutRef.current = setTimeout(() => {
      backspaceIntervalRef.current = setInterval(handleBackspaceOnce, 50);
    }, 300);
  }, [handleBackspaceOnce]);

  const stopBackspaceHold = useCallback(() => {
    isBackspacePressedRef.current = false;
    if (backspaceTimeoutRef.current) clearTimeout(backspaceTimeoutRef.current);
    if (backspaceIntervalRef.current)
      clearInterval(backspaceIntervalRef.current);
  }, []);

  const handleKey = useCallback(
    (key: string) => {
      if (key === "SPACE") {
        insertText(" ");
      } else if (key === "ENTER") {
        void Promise.resolve(onEnter?.());
      } else {
        insertText(key);
      }
      // После нажатия сбрасываем shift (но не capsLock)
      if (shift && !capsLock) {
        setShift(false);
      }
    },
    [insertText, shift, capsLock, onEnter],
  );

  const toggleShift = () => {
    if (capsLock) {
      setCapsLock(false);
      setShift(false);
    } else {
      setShift((s) => !s);
    }
  };

  const toggleCapsLock = () => {
    setCapsLock((c) => {
      if (c) setShift(false);
      return !c;
    });
    setShift(false);
  };

  // Определяем строки для левой части
  const isUpper = capsLock || shift;

  const getLetterRows = (): string[][] => {
    if (layout === "russian") return isUpper ? RU_ROWS_UPPER : RU_ROWS_LOWER;
    if (layout === "english") return isUpper ? EN_ROWS_UPPER : EN_ROWS_LOWER;
    if (layout === "symbols1") return SYMBOLS_PAGE_1;
    return SYMBOLS_PAGE_2;
  };

  const letterRows = getLetterRows();
  const showCalc = layout === "russian" || layout === "english";

  const layer = (
    <div className="virtual-keyboard-portal">
      {/*
        Кнопка открытия — её можно перетащить в любое место экрана.

        Два слоя, и это не лишнее вложение. Внешний двигает перенос, записывая
        положение прямо в его `transform` мимо React (см. useDraggableHandle);
        внутренний анимирует появление силами framer-motion. Оба меняют
        `transform`, и на одном узле второй затирал бы первый — кнопка прыгала
        бы в угол на каждом появлении.
      */}
      <div
        ref={openHandle.ref}
        className={`keyboard-open-anchor${openHandle.dragging ? " is-dragging" : ""}${
          openHandle.corner ? ` is-corner is-corner--${openHandle.corner}` : ""
        }${openHandle.edge ? ` is-docked is-docked--${openHandle.edge}` : ""}`}
        hidden={isOpen}
      >
        {/*
          «Шея» — перемычка от кромки экрана к кнопке.

          Отдельным узлом под кнопкой, а не её псевдоэлементом: у кнопки уже
          есть и кольцо, и тень, и оба нарисованы `box-shadow` по её контуру,
          а перемычка должна лежать ПОД ними и иметь свою форму.

          Всегда в разметке, даже когда кнопка висит свободно: появление и
          исчезновение — это переход `transform`, а элемент, которого в дереве
          нет, анимировать нечем. Свёрнутая шея не видна и событий не ловит.
        */}
        <span className="keyboard-neck" aria-hidden="true">
          <i className="keyboard-neck__stem" />
          <i className="keyboard-neck__fillet keyboard-neck__fillet--start" />
          <i className="keyboard-neck__fillet keyboard-neck__fillet--end" />
        </span>
        {/*
          Перемычка УГЛА — отдельная от краевой «шеи», и это не дубль.

          У края перемычка идёт ПОПЕРЁК кромки: кнопка сидит в ней, как в
          вырезе панели. В углу кромок две, и обнимать кнопку надо вдоль обеих.

          Первый заход был из двух «крыльев» вдоль кромок с вогнутыми
          сопряжениями на стыках. На снимке он выглядел ровно так, как выглядеть
          не должен: три склеенные фигуры со швами на стыках — кнопка, крыло и
          крыло. Сопряжения шов не убирали, а делали заметнее.

          Теперь одна фигура: четверть круга ТОГО ЖЕ ЦЕНТРА, что и кнопка, но
          большего радиуса. Толщина пояска вокруг кнопки одинакова по всей дуге
          по построению — швов там нет и быть не может, а поясок сам собой
          доходит до обеих кромок. Это тот же приём, что у краевой шеи: радиус
          кнопки плюс воротник.
        */}
        <span className="keyboard-corner" aria-hidden="true">
          <i className="keyboard-corner__dome" />
        </span>
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              type="button"
              className="keyboard-open-btn"
              // Открытие — по отпусканию, а не по клику: клик срабатывает и
              // после переноса, и клавиатура вылезала бы каждый раз, когда
              // кнопку просто подвинули.
              onPointerDown={openHandle.onPointerDown}
              onPointerMove={openHandle.onPointerMove}
              onPointerUp={openHandle.onPointerUp}
              onPointerCancel={openHandle.onPointerUp}
              title="Открыть клавиатуру. Кнопку можно перетащить в любое место"
              aria-label="Открыть экранную клавиатуру"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.18 }}
            >
              <KeyboardOpenIcon />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Клавиатура */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="keyboard-overlay"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            /* Быстро: клавиатуру вызывают, когда уже собрались печатать, и
               треть секунды выезда читается как «касса тормозит». */
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.3, 1] }}
          >
            <div className={`keyboard-container size-${keyboardSize}`}>
              {/* ===== HEADER ===== */}
              <div className="keyboard-header">
                <div className="header-left">
                  <button
                    className={`tab-btn ${layout === "russian" ? "active" : ""}`}
                    onClick={() => setLayout("russian")}
                  >
                    АБВ
                  </button>
                  <button
                    className={`tab-btn ${layout === "english" ? "active" : ""}`}
                    onClick={() => setLayout("english")}
                  >
                    ABC
                  </button>
                  <button
                    className={`tab-btn ${layout === "symbols1" ? "active" : ""}`}
                    onClick={() => setLayout("symbols1")}
                  >
                    #+=
                  </button>
                  <button
                    className={`tab-btn ${layout === "symbols2" ? "active" : ""}`}
                    onClick={() => setLayout("symbols2")}
                  >
                    ☺
                  </button>
                </div>

                <div className="header-right">
                  {(["small", "medium", "large"] as KeyboardSize[]).map(
                    (size) => (
                      <button
                        key={size}
                        className={`size-tab ${keyboardSize === size ? "active" : ""}`}
                        onClick={() => setKeyboardSize(size)}
                      >
                        {size === "small" ? "S" : size === "medium" ? "M" : "L"}
                      </button>
                    ),
                  )}

                  <button
                    type="button"
                    className={`tab-btn auto-open-btn ${autoOpen ? "active" : ""}`}
                    onClick={toggleAutoOpen}
                    title={autoOpen ? "Клавиатура открывается автоматически при клике на поле ввода — нажмите, чтобы выключить" : "Автооткрытие выключено — клавиатуру нужно открывать вручную"}
                  >
                    {autoOpen ? "Авто: вкл" : "Авто: выкл"}
                  </button>

                  <button
                    type="button"
                    className={`tab-btn auto-open-btn ${snapToEdge ? "active" : ""}`}
                    onClick={toggleSnapToEdge}
                    title={
                      snapToEdge
                        ? "Кнопка вызова сама подъезжает к ближайшему краю через пару секунд — нажмите, чтобы выключить"
                        : "Кнопка вызова остаётся там, где её отпустили"
                    }
                  >
                    {snapToEdge ? "К краю: вкл" : "К краю: выкл"}
                  </button>

                  <motion.button
                    className="close-btn"
                    onClick={() => onOpenChange(false)}
                    whileTap={{ scale: 0.92 }}
                  >
                    <CloseIcon />
                  </motion.button>
                </div>
              </div>

              {/* ===== ТЕЛО ===== */}
              <div className="keyboard-body">
                <div className="keyboard-split">
                  {/* ——— ЛЕВАЯ ЧАСТЬ: буквы ——— */}
                  <div className="split-letters">
                    <div className="keys-container">
                      {letterRows.map((row, rowIndex) => (
                        <div key={rowIndex} className="key-row">
                          {row.map((key) => (
                            <button
                              key={key}
                              type="button"
                              className="key"
                              onClick={() => handleKey(key)}
                            >
                              {key}
                            </button>
                          ))}
                        </div>
                      ))}

                      {/* Функциональный ряд */}
                      <div className="key-row function-keys">
                        {showCalc && (
                          <>
                            <button
                              type="button"
                              className={`key special ${shift && !capsLock ? "active" : ""}`}
                              onClick={toggleShift}
                            >
                              ⇧ Shift
                            </button>
                            <button
                              type="button"
                              className={`key special ${capsLock ? "active" : ""}`}
                              onClick={toggleCapsLock}
                            >
                              ⇪ Caps
                            </button>
                          </>
                        )}

                        {(layout === "symbols1" || layout === "symbols2") && (
                          <button
                            type="button"
                            className="key special"
                            onClick={() =>
                              setLayout(
                                layout === "symbols1" ? "symbols2" : "symbols1",
                              )
                            }
                          >
                            {layout === "symbols1" ? "☺" : "↶"}
                          </button>
                        )}

                        <button
                          type="button"
                          className="key special space"
                          onClick={() => handleKey("SPACE")}
                        >
                          Пробел
                        </button>

                        <button
                          type="button"
                          className="key special backspace"
                          onMouseDown={startBackspaceHold}
                          onMouseUp={stopBackspaceHold}
                          onMouseLeave={stopBackspaceHold}
                          onTouchStart={startBackspaceHold}
                          onTouchEnd={stopBackspaceHold}
                          onTouchCancel={stopBackspaceHold}
                        >
                          ⌫
                        </button>

                        <button
                          type="button"
                          className="key special enter"
                          onClick={() => handleKey("ENTER")}
                        >
                          <svg
                            xmlns="http://w3.org"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 10 4 15 9 20" />
                            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ——— ПРАВАЯ ЧАСТЬ: калькулятор ——— */}
                  {showCalc && (
                    <div className="split-calc">
                      <div className="calc-grid">
                        {CALC_ROWS.map((row, rowIndex) => (
                          <div key={rowIndex} className="calc-row">
                            {row.map((key) => (
                              <button
                                key={key}
                                type="button"
                                className="key calc-key"
                                onClick={() => handleKey(key)}
                              >
                                {key}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return createPortal(layer, document.body);
}
