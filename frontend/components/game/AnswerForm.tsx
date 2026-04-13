"use client";

/**
 * AnswerForm.tsx — 5-category answer input form
 *
 * Renders one input per category (Person, Place, Thing, Animal, Food).
 * Each input:
 *  - Shows a Hugeicons category icon on the left
 *  - Validates that the first letter matches the round letter in real-time
 *  - Shows a red border + error if the first letter is wrong
 *  - Shows a green tick when filled and valid
 *  - Empty answers are allowed (score 0 for that category)
 *
 * On submit:
 *  - Trims all answers
 *  - Calls onSubmit([person, place, thing, animal, food])
 *  - Parent (game page) handles hash generation + contract write
 *
 * The form auto-focuses the first input on mount so mobile players
 * can start typing immediately after the LetterReveal animation ends.
 */

import {
  ChickenThighsIcon,
  ForkIcon,
  Location01Icon,
  PackageIcon,
  Tick01Icon,
  UserCircle02Icon,
} from "@hugeicons/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { CATEGORY_LABELS, Category } from "@/lib/contract";
import { cn, validateAnswer } from "@/lib/utils";

// ── Category metadata ─────────────────────────────────────────────────────────
type CategoryMeta = {
  category:    Category;
  label:       string;
  placeholder: string;
  icon:        React.FC<{ size?: number | string; className?: string }>;
};

const CATEGORIES: CategoryMeta[] = [
  {
    category:    Category.PERSON,
    label:       CATEGORY_LABELS[Category.PERSON],
    placeholder: "A person's name",
    icon:        UserCircle02Icon,
  },
  {
    category:    Category.PLACE,
    label:       CATEGORY_LABELS[Category.PLACE],
    placeholder: "A city, country or place",
    icon:        Location01Icon,
  },
  {
    category:    Category.THING,
    label:       CATEGORY_LABELS[Category.THING],
    placeholder: "Any object or thing",
    icon:        PackageIcon,
  },
  {
    category:    Category.ANIMAL,
    label:       CATEGORY_LABELS[Category.ANIMAL],
    placeholder: "An animal",
    icon:        ChickenThighsIcon,
  },
  {
    category:    Category.FOOD,
    label:       CATEGORY_LABELS[Category.FOOD],
    placeholder: "A food or drink",
    icon:        ForkIcon,
  },
];

// ── Single input row ──────────────────────────────────────────────────────────
type InputRowProps = {
  meta:       CategoryMeta;
  value:      string;
  letter:     string;
  onChange:   (val: string) => void;
  onEnter:    () => void;  // focus next field
  inputRef:   React.RefObject<HTMLInputElement>;
  disabled:   boolean;
};

function InputRow({
  meta,
  value,
  letter,
  onChange,
  onEnter,
  inputRef,
  disabled,
}: InputRowProps) {
  const trimmed  = value.trim();
  const isEmpty  = trimmed === "";
  const isValid  = isEmpty || validateAnswer(trimmed, letter);
  const isFilled = !isEmpty && isValid;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter();
    }
  }

  return (
    <div className="space-y-1">
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        <meta.icon size={13} className="text-[#9B9B9B]" />
        <label className="text-xs font-medium text-[#9B9B9B] uppercase tracking-wider">
          {meta.label}
        </label>
        {/* Valid tick */}
        <AnimatePresence>
          {isFilled && (
            <motion.span
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="ml-auto"
            >
              <Tick01Icon size={13} className="text-[#008751]" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Input */}
      <div className="relative">
        {/* Letter badge — shows expected first letter inside the input */}
        <div className={cn(
          "absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-xs font-bold shrink-0 select-none",
          isValid
            ? "bg-[#008751]/15 text-[#008751]"
            : "bg-[#E03E3E]/15 text-[#E03E3E]"
        )}>
          {letter}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={meta.placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={40}
          className={cn(
            "input pl-10 pr-9",
            // override border based on validation state
            !isEmpty && !isValid && "input-error",
            isFilled && "border-[#008751]/40 focus:border-[#008751]",
          )}
        />

        {/* Character count — appears when > 20 chars */}
        {value.length > 20 && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#9B9B9B] pointer-events-none tabular-nums">
            {value.length}/40
          </span>
        )}
      </div>

      {/* Inline error */}
      <AnimatePresence>
        {!isEmpty && !isValid && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="text-xs text-[#E03E3E] overflow-hidden"
          >
            Must start with &quot;{letter}&quot;
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//                           MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type AnswerFormProps = {
  /** The round letter — e.g. "M". All non-empty answers must start with this. */
  letter:          string;
  /** Called with [person, place, thing, animal, food] when player submits */
  onSubmit:        (answers: [string, string, string, string, string]) => void;
  /** True while wallet confirm or tx confirmation is pending */
  isPending:       boolean;
  /** Contract / wallet error to display beneath the submit button */
  error:           string | null;
  /** Unix timestamp (seconds) when the commit window closes — auto-submits at deadline */
  commitDeadline?: number;
  /** True once commit deadline has passed — disables inputs, shows time-up banner */
  deadlinePassed?: boolean;
};

export default function AnswerForm({
  letter,
  onSubmit,
  isPending,
  error,
  commitDeadline,
  deadlinePassed = false,
}: AnswerFormProps) {
  const [values, setValues] = useState<string[]>(["", "", "", "", ""]);

  // Refs for each input — used to programmatically focus next on Enter
  const inputRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  // Keep a ref to the latest answers so the auto-submit timeout always reads
  // current values even if the component re-renders after the timeout was set.
  const latestValuesRef = useRef(values);
  useEffect(() => { latestValuesRef.current = values; }, [values]);

  // Keep a ref to the latest onSubmit so we don't need it as an effect dep.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);

  // Auto-submit — fires once at the deadline using a ref flag so it can never
  // be cancelled by a re-render or unmount caused by phase.deadlinePassed
  // ticking at the same millisecond as the timeout.
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!commitDeadline) return;
    const fire = () => {
      if (autoSubmittedRef.current) return;
      autoSubmittedRef.current = true;
      const trimmed = latestValuesRef.current.map((v) => v.trim()) as [
        string, string, string, string, string
      ];
      onSubmitRef.current(trimmed);
    };
    const msLeft = commitDeadline * 1000 - Date.now();
    if (msLeft <= 0) { fire(); return; }
    const t = setTimeout(fire, msLeft);
    return () => clearTimeout(t);
  // Only re-run if the deadline itself changes (new round). Never on isPending
  // or onSubmit changes — those are handled via refs above.
  }, [commitDeadline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus first input when the form mounts
  useEffect(() => {
    const t = setTimeout(() => {
      inputRefs[0].current?.focus();
    }, 100);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setValue(idx: number, val: string) {
    setValues((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  }

  function focusNext(idx: number) {
    if (idx < 4) {
      inputRefs[idx + 1].current?.focus();
    } else {
      // Last field — blur to trigger mobile keyboard dismiss
      inputRefs[4].current?.blur();
    }
  }

  // Validation
  const filledCount = values.filter((v) => v.trim() !== "").length;

  const hasInvalidAnswer = values.some((v) => {
    const t = v.trim();
    return t !== "" && !validateAnswer(t, letter);
  });

  // Disable everything once the window closes (auto-submit has already fired)
  const isLocked  = deadlinePassed || autoSubmittedRef.current;
  const canSubmit = !hasInvalidAnswer && !isPending && !isLocked;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const trimmed = values.map((v) => v.trim()) as [
      string, string, string, string, string
    ];

    onSubmit(trimmed);
  }

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="card p-5 space-y-4"
    >
      {/* Time-up / auto-submitting banner */}
      {isLocked && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[#DFAB01]/10 border border-[#DFAB01]/20 text-xs text-[#DFAB01]">
          <span className="w-2 h-2 rounded-full bg-[#DFAB01] animate-pulse shrink-0" />
          {isPending
            ? "Locking in your answers on-chain…"
            : "Time's up — answers auto-submitted."}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-white">Your answers</h3>
          <p className="text-xs text-[#9B9B9B]">
            All answers must start with{" "}
            <span className="text-[#008751] font-bold">{letter}</span>.
            Empty answers score 0.
          </p>
        </div>
        {/* Fill progress */}
        <div className="flex gap-1 shrink-0">
          {CATEGORIES.map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1.5 h-4 rounded-full transition-colors duration-200",
                i < filledCount ? "bg-[#008751]" : "bg-[#2D2D2D]"
              )}
            />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="divider" />

      {/* Inputs */}
      <div className="space-y-3">
        {CATEGORIES.map((meta, idx) => (
          <InputRow
            key={meta.category}
            meta={meta}
            value={values[idx]}
            letter={letter}
            onChange={(val) => setValue(idx, val)}
            onEnter={() => focusNext(idx)}
            inputRef={inputRefs[idx]}
            disabled={isPending || isLocked}
          />
        ))}
      </div>

      {/* Submit */}
      <div className="space-y-2 pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary w-full"
        >
          {isPending ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Locking in answers…
            </>
          ) : isLocked ? (
            "Answers submitted"
          ) : hasInvalidAnswer ? (
            "Fix invalid answers first"
          ) : filledCount === 0 ? (
            "Submit empty answers"
          ) : (
            <>
              Lock In {filledCount} Answer{filledCount !== 1 ? "s" : ""}
              <span className="ml-auto text-xs opacity-60">Enter ↵</span>
            </>
          )}
        </button>

        {/* Error from contract write */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="text-xs text-[#E03E3E] overflow-hidden"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Empty answer warning */}
        {filledCount < 5 && filledCount > 0 && !isPending && (
          <p className="text-xs text-[#9B9B9B] text-center">
            {5 - filledCount} empty answer{5 - filledCount !== 1 ? "s" : ""} will score 0 pts
          </p>
        )}
      </div>
    </motion.form>
  );
}
