import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useState, type KeyboardEvent } from "react";
import { match } from "ts-pattern";

type Layout = "address" | "text";
type Case = "lower" | "upper" | "symbols";

type Key =
  | { readonly kind: "char"; readonly char: string }
  | { readonly kind: "insert"; readonly text: string }
  | { readonly kind: "case"; readonly to: Case; readonly label: string }
  | { readonly kind: "space" }
  | { readonly kind: "delete" }
  | { readonly kind: "submit" };

const chars = (row: string): Key[] => row.split("").map((char) => ({ kind: "char", char }));

const letters: Record<Exclude<Case, "symbols">, string[]> = {
  lower: ["1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm._@"],
  upper: ["1234567890", "QWERTYUIOP", "ASDFGHJKL-", "ZXCVBNM._@"],
};
const symbols = ["1234567890", "!#$%&*()+=", "?/:;'\"<>[]", "~^`|\\{},._"];

function grid(layout: Layout, letterCase: Case): Key[][] {
  if (layout === "address") {
    return [
      ...["1234567890", "qwertyuiop", "asdfghjkl:", "zxcvbnm.-/"].map(chars),
      [
        { kind: "insert", text: "http://" },
        { kind: "insert", text: ":8096" },
        { kind: "insert", text: ".local" },
        { kind: "delete" },
        { kind: "submit" },
      ],
    ];
  }
  const rows = letterCase === "symbols" ? symbols : letters[letterCase];
  return [
    ...rows.map(chars),
    [
      letterCase === "upper"
        ? { kind: "case", to: "lower", label: "abc" }
        : { kind: "case", to: "upper", label: "Shift" },
      letterCase === "symbols"
        ? { kind: "case", to: "lower", label: "abc" }
        : { kind: "case", to: "symbols", label: "#+=" },
      { kind: "space" },
      { kind: "delete" },
      { kind: "submit" },
    ],
  ];
}

function keyLabel(key: Key, submitLabel: string): string {
  return match(key)
    .with({ kind: "char" }, (k) => k.char)
    .with({ kind: "insert" }, (k) => k.text)
    .with({ kind: "case" }, (k) => k.label)
    .with({ kind: "space" }, () => "Space")
    .with({ kind: "delete" }, () => "Delete")
    .with({ kind: "submit" }, () => submitLabel)
    .exhaustive();
}

function spokenLabel(key: Key, submitLabel: string): string {
  return match(key)
    .with({ kind: "char", char: " " }, () => "space")
    .with({ kind: "case", to: "symbols" }, () => "#+= symbols")
    .otherwise(() => keyLabel(key, submitLabel));
}

interface KeyCapProps {
  readonly focusKey: string;
  readonly label: string;
  readonly spoken: string;
  readonly wide: boolean;
  readonly primary: boolean;
  readonly onPress: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

function KeyCap({ focusKey, label, spoken, wide, primary, onPress, onKeyDown }: KeyCapProps) {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={spoken}
      onClick={onPress}
      onKeyDown={onKeyDown}
      className={`focus-mark flex h-[4rem] min-w-0 items-center justify-center focus-visible:bg-paper focus-visible:text-ink ${
        wide ? "col-span-2 text-body stretch-semicondensed" : "text-heading"
      } ${primary ? "hairline border-2 bg-ink-raised font-[780] stretch-wide" : "bg-ink-raised font-[620]"}`}
    >
      {label}
    </button>
  );
}

/** The focus key of the keyboard's first letter, for screens that open with the keyboard focused. */
export const firstKey = (focusKey: string): string => `${focusKey}-1-0`;

export interface KeyboardProps {
  readonly layout: Layout;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly submitLabel: string;
  readonly focusKey: string;
}

/**
 * A d-pad keyboard, so an owner with only a gamepad can type an address or a password.
 * A physical keyboard types into the field above it instead.
 */
export function Keyboard({
  layout,
  value,
  onChange,
  onSubmit,
  submitLabel,
  focusKey,
}: KeyboardProps) {
  const [letterCase, setLetterCase] = useState<Case>("lower");
  const { ref, focusKey: context } = useFocusable<object, HTMLFieldSetElement>({
    focusKey,
    // Without listed directions norigin holds every edge and the board traps focus. Up must reach
    // the field (and a physical keyboard with it) and left the servers found; nothing lies right of
    // or below the board, so only those edges hold.
    isFocusBoundary: true,
    focusBoundaryDirections: ["right", "down"],
    saveLastFocusedChild: true,
  });
  const rows = grid(layout, letterCase);

  const press = (key: Key): void => {
    match(key)
      .with({ kind: "char" }, (k) => onChange(value + k.char))
      .with({ kind: "insert" }, (k) => onChange(value + k.text))
      .with({ kind: "case" }, (k) => setLetterCase(k.to))
      .with({ kind: "space" }, () => onChange(`${value} `))
      .with({ kind: "delete" }, () => onChange(value.slice(0, -1)))
      .with({ kind: "submit" }, () => onSubmit())
      .exhaustive();
  };

  // A physical keyboard used while a key has focus still types: Backspace deletes rather than
  // leaving the step, and a character is added rather than lost. Stopping it here keeps it from the
  // input hub on the window, which would read Backspace as Back. Space is left to the hub: there,
  // as everywhere else, it is Select, and presses the focused key.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Backspace") onChange(value.slice(0, -1));
    else if (event.key.length === 1 && event.key !== " ") onChange(value + event.key);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <FocusContext.Provider value={context}>
      <fieldset
        ref={ref}
        aria-label="On-screen keyboard"
        className="m-0 grid min-w-0 grid-cols-10 gap-3 border-0 p-0"
      >
        {rows.flatMap((row, r) =>
          row.map((key, c) => (
            <KeyCap
              key={`${r}-${c}`}
              focusKey={`${focusKey}-${r}-${c}`}
              label={keyLabel(key, submitLabel)}
              spoken={spokenLabel(key, submitLabel)}
              wide={key.kind !== "char"}
              primary={key.kind === "submit"}
              onPress={() => press(key)}
              onKeyDown={onKeyDown}
            />
          )),
        )}
      </fieldset>
    </FocusContext.Provider>
  );
}

/** The text field the keyboard writes into; a physical keyboard types here directly. */
export function EntryField({
  label,
  value,
  masked,
  focusKey,
  onChange,
  onSubmit,
}: {
  readonly label: string;
  readonly value: string;
  readonly masked: boolean;
  readonly focusKey: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  const { ref } = useFocusable<object, HTMLInputElement>({ focusKey });
  return (
    <label className="flex flex-col gap-2">
      <span className="text-caption font-[600] tracking-[0.12em] text-paper-dim uppercase stretch-condensed">
        {label}
      </span>
      <input
        ref={ref}
        type={masked ? "password" : "text"}
        value={value}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          // The field owns this Enter: the hub must not also read it as Select, or it presses
          // whatever the next step focuses (its first key) in the same keystroke.
          event.preventDefault();
          event.stopPropagation();
          onSubmit();
        }}
        className="focus-mark h-[5rem] w-full focus-visible:transform-none border-0 border-b-2 border-paper-faint bg-transparent text-title font-[640] text-paper stretch-semicondensed focus-visible:border-paper focus-visible:bg-ink-raised"
      />
    </label>
  );
}
