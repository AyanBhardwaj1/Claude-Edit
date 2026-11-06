"use client";
import { useId } from "react";
import { EFFORT, EFFORTS, type Effort } from "@/lib/effort";

/** Fast / Balanced / Best quality as one radio group (native radios: arrow keys move, Tab leaves the group). */
export function EffortPicker({ value, onChange, legend, time }: { value: Effort; onChange: (e: Effort) => void; legend: string;
  time?: (e: Effort) => string | null }) {
  const id = useId();
  return (
    <fieldset className="effort" role="radiogroup" aria-labelledby={`${id}-l`}>
      <legend id={`${id}-l`} className="label">{legend}</legend>
      <div className="effort-opts">
        {EFFORTS.map((e) => {
          const t = time?.(e);
          return (
            <label key={e} className="effort-opt">
              <input type="radio" className="sr-only" name={`${id}-effort`} value={e} checked={value === e} onChange={() => onChange(e)}
                aria-describedby={`${id}-${e}`} />
              <span className="eo-name"><span className="eo-dot" aria-hidden="true" />{EFFORT[e].label}</span>
              <span id={`${id}-${e}`} className="eo-sub">
                {t && <span className="eo-time">{t}</span>}
                <span className="eo-line">{EFFORT[e].line}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
